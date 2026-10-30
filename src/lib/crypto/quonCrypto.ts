/**
 * Client-side zero-knowledge crypto for QUON (libsodium + BIP39).
 *
 * Everything sensitive happens here, in the browser. The server only ever
 * receives a high-entropy `authToken`, the doubly-wrapped Master Key, and public
 * KDF salts/params — never the password, the recovery phrase, or the Master Key.
 *
 * Key schedule (Bitwarden-style separation of auth ⟂ encryption):
 *
 *   masterPwKey = Argon2id(password, kdfSalt)
 *   authToken   = KDF(masterPwKey, "quonauth")   → sent to the server (verifier)
 *   pwWrapKey   = KDF(masterPwKey, "quonwrap")   → never leaves the browser
 *   MK          = random(32)                      → the Master Key
 *   wrap_pw     = secretbox(MK, pwWrapKey)
 *   recKey      = Argon2id(bip39Seed, recSalt)
 *   recWrapKey  = KDF(recKey, "quonwrap")
 *   wrap_rec    = secretbox(MK, recWrapKey)
 *   bioWrapKey  = KDF(prfOutput, "quonbio0")       → prfOutput = WebAuthn PRF, held
 *   wrap_bio    = secretbox(MK, bioWrapKey)          in device secure hardware only
 *   chatKey     = KDF(MK, "quonchat")             → encrypts each chat blob
 *   idWrapKey   = KDF(MK, "quonidk0")              → wraps the X25519 identity
 *                                                    private key (shared projects)
 */

import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic as bip39Validate,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
// NOTE: the *sumo* build is required — the standard `libsodium-wrappers` omits
// the password-hashing API (crypto_pwhash / Argon2id) we use for key derivation.
import { deflateSync, inflateSync } from "fflate";
import _sodium from "libsodium-wrappers-sumo";

export interface KdfParams {
  alg: "argon2id";
  ops: number;
  mem: number;
  v: number;
}

export interface RegistrationMaterial {
  authToken: string;
  kdfSalt: string;
  kdfParams: KdfParams;
  wrapPw: string;
  recSalt: string;
  wrapRec: string;
  mnemonic: string;
}

// Argon2id cost. 64 MiB / 3 passes: strong against offline brute force yet
// tolerable on a phone. Persisted in kdfParams so future logins reproduce it.
const PROD_KDF: KdfParams = { alg: "argon2id", ops: 3, mem: 64 * 1024 * 1024, v: 1 };
// Test-harness-only lightweight params (e2e logs in ~130 times; production
// Argon2 costs would dominate the suite). DOUBLE-gated: import.meta.env.DEV is
// compile-time false in production builds, so the light path is structurally
// unreachable there. Params are stored per user at registration, so accounts
// created light stay consistent at login (harness DBs are throwaway anyway).
const LIGHT_KDF: KdfParams = { alg: "argon2id", ops: 1, mem: 8 * 1024 * 1024, v: 1 };
const DEFAULT_KDF: KdfParams =
  import.meta.env.DEV && import.meta.env.VITE_QUON_TEST_KDF === "light" ? LIGHT_KDF : PROD_KDF;

const CTX_AUTH = "quonauth"; // exactly 8 bytes (crypto_kdf context)
const CTX_WRAP = "quonwrap";
const CTX_CHAT = "quonchat";
const CTX_MEMORY = "quonmem0"; // E2E key for the `memory` sync collection
const CTX_DOCS = "quondoc0"; //   E2E key for the `documents` sync collection
const CTX_PROJECTS = "quonprj0"; // E2E key for the `projects` sync collection
const CTX_ORIGINALS = "quonorg0"; // E2E key for the `originals` sync collection (file bytes)
const CTX_LOCAL = "quonloc0"; // at-rest key for this device's localStorage/IndexedDB caches
const CTX_IDENTITY = "quonidk0"; // wrap key for the account's X25519 identity private key
const CTX_PREFS = "quonprf0"; // E2E key for the `prefs` sync collection (UI prefs + redact lists)
const CTX_BIO = "quonbio0"; // wrap key derived from a WebAuthn PRF output (biometric unlock)
const CTX_JOBS = "quonjob0"; // E2E key for the `jobs` sync collection (client-runmode agents + runs)

let sodium: typeof _sodium;
let readyPromise: Promise<void> | null = null;

async function ready(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await _sodium.ready;
      sodium = _sodium;
    })();
  }
  return readyPromise;
}

// --- base64 (ORIGINAL = standard +/ with padding, matches Python base64) ---
const b64 = (b: Uint8Array) => sodium.to_base64(b, sodium.base64_variants.ORIGINAL);
const unb64 = (s: string) => sodium.from_base64(s, sodium.base64_variants.ORIGINAL);

// --- primitives -----------------------------------------------------------
async function pwhash(
  password: string | Uint8Array,
  salt: Uint8Array,
  p: KdfParams,
): Promise<Uint8Array> {
  const pw = typeof password === "string" ? sodium.from_string(password) : password;
  return sodium.crypto_pwhash(32, pw, salt, p.ops, p.mem, sodium.crypto_pwhash_ALG_ARGON2ID13);
}

function kdf(key: Uint8Array, ctx: string, subkeyId = 1): Uint8Array {
  return sodium.crypto_kdf_derive_from_key(32, subkeyId, ctx, key);
}

function wrap(secret: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(secret, nonce, key);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return out;
}

function unwrap(blob: Uint8Array, key: Uint8Array): Uint8Array {
  const n = sodium.crypto_secretbox_NONCEBYTES;
  return sodium.crypto_secretbox_open_easy(blob.slice(n), blob.slice(0, n), key);
}

// --- registration ---------------------------------------------------------
/** Build all key material for a new account. Returns the wire material (to POST
 *  to /auth/register) plus the in-memory Master Key to keep for this session. */
export async function buildRegistration(
  password: string,
): Promise<{ material: RegistrationMaterial; masterKey: Uint8Array }> {
  await ready();
  const kdfSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const params = DEFAULT_KDF;
  const masterPwKey = await pwhash(password, kdfSalt, params);

  const masterKey = sodium.randombytes_buf(32);
  const wrapPw = wrap(masterKey, kdf(masterPwKey, CTX_WRAP));

  const mnemonic = generateMnemonic(wordlist, 128); // 12 words
  const recSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const recKey = await pwhash(mnemonicToSeedSync(mnemonic), recSalt, params);
  const wrapRec = wrap(masterKey, kdf(recKey, CTX_WRAP));

  return {
    material: {
      authToken: b64(kdf(masterPwKey, CTX_AUTH)),
      kdfSalt: b64(kdfSalt),
      kdfParams: params,
      wrapPw: b64(wrapPw),
      recSalt: b64(recSalt),
      wrapRec: b64(wrapRec),
      mnemonic,
    },
    masterKey,
  };
}

// --- recovery rotation ------------------------------------------------------
/**
 * Fresh recovery material for an UNLOCKED account (Master Key in memory): a new
 * 12-word phrase and the MK re-wrapped under it. The old phrase stops opening
 * anything the moment the server swaps rec_salt/wrap_rec.
 *
 * `params` MUST be the account's STORED kdf_params (from /auth/keymaterial),
 * not DEFAULT_KDF: the server keeps ONE kdf_params column shared by the
 * password and recovery derivations, so deriving the new recovery key with
 * different params would make a later recovery derive the wrong key.
 */
export async function buildRecoveryRotation(
  masterKey: Uint8Array,
  params: KdfParams,
): Promise<{ mnemonic: string; recSalt: string; wrapRec: string }> {
  await ready();
  const mnemonic = generateMnemonic(wordlist, 128); // 12 words
  const recSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const recKey = await pwhash(mnemonicToSeedSync(mnemonic), recSalt, params);
  return { mnemonic, recSalt: b64(recSalt), wrapRec: b64(wrap(masterKey, kdf(recKey, CTX_WRAP))) };
}

// --- login ----------------------------------------------------------------
/** Derive the authToken (sent to the server) and the local password-wrap key. */
export async function deriveAuth(
  password: string,
  kdfSalt: string,
  params: KdfParams,
): Promise<{ authToken: string; pwWrapKey: Uint8Array }> {
  await ready();
  const masterPwKey = await pwhash(password, unb64(kdfSalt), params);
  return { authToken: b64(kdf(masterPwKey, CTX_AUTH)), pwWrapKey: kdf(masterPwKey, CTX_WRAP) };
}

/** Unwrap the Master Key from the password-wrapped blob returned by /auth/login. */
export function unlockMasterKey(wrapPw: string, pwWrapKey: Uint8Array): Uint8Array {
  return unwrap(unb64(wrapPw), pwWrapKey);
}

// --- recovery -------------------------------------------------------------
export function isValidMnemonic(mnemonic: string): boolean {
  return bip39Validate(mnemonic.trim().toLowerCase(), wordlist);
}

/** Recover the Master Key from the recovery phrase (password-reset entry point). */
export async function recoverMasterKey(
  mnemonic: string,
  recSalt: string,
  wrapRec: string,
  params: KdfParams,
): Promise<Uint8Array> {
  await ready();
  const recKey = await pwhash(
    mnemonicToSeedSync(mnemonic.trim().toLowerCase()),
    unb64(recSalt),
    params,
  );
  return unwrap(unb64(wrapRec), kdf(recKey, CTX_WRAP));
}

/** Re-wrap an existing Master Key under a new password (keeps data decryptable). */
export async function rewrapForPassword(
  masterKey: Uint8Array,
  password: string,
): Promise<{ authToken: string; kdfSalt: string; kdfParams: KdfParams; wrapPw: string }> {
  await ready();
  const kdfSalt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const params = DEFAULT_KDF;
  const masterPwKey = await pwhash(password, kdfSalt, params);
  return {
    authToken: b64(kdf(masterPwKey, CTX_AUTH)),
    kdfSalt: b64(kdfSalt),
    kdfParams: params,
    wrapPw: b64(wrap(masterKey, kdf(masterPwKey, CTX_WRAP))),
  };
}

// --- biometric unlock (WebAuthn PRF) ---------------------------------------
// A third wrap of the Master Key, parallel to wrap_pw/wrap_rec. The 32-byte
// PRF output comes from the device's secure hardware (webauthnBio.ts) and is
// released only after on-device biometric verification — the derived wrap key
// therefore never exists anywhere the server (or a DB attacker) can reach.

/** Wrap key from a WebAuthn PRF output (32 bytes of authenticator-held entropy). */
export async function deriveBioWrapKey(prfOutput: Uint8Array): Promise<Uint8Array> {
  await ready();
  return kdf(prfOutput, CTX_BIO);
}

/** wrap_bio for PUT /auth/bio: nonce‖secretbox(MK) under the PRF-derived key. */
export async function wrapMasterKeyForBio(
  masterKey: Uint8Array,
  bioWrapKey: Uint8Array,
): Promise<string> {
  await ready();
  return b64(wrap(masterKey, bioWrapKey));
}

/** Unwrap the Master Key from the biometric wrap. Throws on any mismatch
 *  (wrong PRF output, tampered blob) — fail closed, no partial plaintext. */
export async function unlockMasterKeyBio(
  wrapBio: string,
  bioWrapKey: Uint8Array,
): Promise<Uint8Array> {
  await ready();
  return unwrap(unb64(wrapBio), bioWrapKey);
}

// --- blob encryption (per zero-knowledge sync collection) -----------------
export function deriveChatKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_CHAT);
}

/** E2E key for the `memory` collection (facts/notes synced as ciphertext). */
export function deriveMemoryKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_MEMORY);
}

/** E2E key for the `documents` collection (doc chunks synced as ciphertext). */
export function deriveDocsKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_DOCS);
}

/** E2E key for the `projects` collection (project name/instruction as ciphertext). */
export function deriveProjectsKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_PROJECTS);
}

/** E2E key for the `originals` collection (original document bytes, encrypted
 *  whole and synced as chunked ciphertext blobs `orig:<docId>:<i>`). */
export function deriveOriginalsKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_ORIGINALS);
}

/** E2E key for the `prefs` collection — cross-device UI preferences (protection
 *  level, active model, reasoning) AND the always/never-redact lists. Those lists
 *  are the user's own PII, so like chats they are synced as ciphertext only; the
 *  server never sees them in the clear. */
export function derivePrefsKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_PREFS);
}

/** E2E key for the `jobs` collection — client-runmode agents (a prompt over the
 *  user's own docs/memory) and their Runs (status/progress/result). The spec IS
 *  private content, so it is synced as ciphertext only; the server relays opaque
 *  blobs and never runs or reads these (unlike the server-side web-watch, whose
 *  query is public metadata in the `agents` table). */
export function deriveJobsKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_JOBS);
}

/** Key for encrypting this device's local caches (chat history, Memory/Documents
 *  in IndexedDB, preferences) at rest. Distinct from the sync-collection keys so
 *  local blobs and server blobs are never interchangeable. */
export function deriveLocalCacheKey(masterKey: Uint8Array): Uint8Array {
  return kdf(masterKey, CTX_LOCAL);
}

/* --- Compressed payload frame (v2) ------------------------------------------
 *
 * Chat JSON is extremely repetitive — German prose, the same `[PERSON_1]`
 * placeholders over and over, RAG context echoing document text. Deflate gets
 * ~9× on it, which is what keeps a long conversation clear of the relay's 4 MiB
 * per-blob cap and of WebKit's ~5 MB localStorage quota.
 *
 *   v1 (legacy): secretbox( utf8(JSON) )
 *   v2 (new):    secretbox( 0x00 | ver | len:u32le | deflate(utf8(JSON)) | pad )
 *
 * The marker is IN-BAND and therefore covered by the secretbox MAC — unlike the
 * `content_ver` column, which is server-mutable metadata. It is unambiguous
 * because `JSON.stringify` can only ever begin with `{ [ " -` , a digit, or
 * t/f/n — every one of them ≥ 0x20, so a leading 0x00 cannot occur in v1.
 * Cost on the legacy path: one byte comparison.
 *
 * Compression happens BEFORE encryption and entirely client-side, so the
 * zero-knowledge invariant is untouched — the server still only ever sees
 * opaque ciphertext.
 *
 * On CRIME/BREACH: those need attacker-chosen plaintext sharing a compression
 * context with a secret, an observable length, and thousands of adaptive
 * probes. Here every blob is compressed independently, per user, per item, on
 * the store's own debounce — there is no oracle an attacker can drive. The
 * server already sees blob lengths today; compression would merely refine that
 * existing leak into "length at entropy H", so we pad to PAD_TO buckets and
 * remove the finer-grained leak that was already there.
 *
 * Why fflate and not the native CompressionStream: the READ side has to work
 * everywhere. `DecompressionStream` is absent from WKWebView on macOS < 13.3,
 * and tauri.conf.json still targets 10.15 — a phone writing a v2 blob would be
 * silently unreadable on that laptop, surfacing as "my chats are missing"
 * because collectionSync's pull skips undecodable items. fflate is synchronous,
 * so encryptJSON/decryptJSON keep their signatures and none of their six
 * call sites change. */
const FRAME_MARKER = 0x00;
const FRAME_V2 = 0x02;
const FRAME_HEADER = 6; // marker | version | u32 length
/** Below this there is nothing to win, and staying v1 keeps small items
 *  (prefs, jobs, projects) readable by clients that predate this format. */
const COMPRESS_MIN_BYTES = 4096;
/** Pad the frame to a multiple of this so the ciphertext length reveals only a
 *  bucket. Negligible against blobs already ≥ COMPRESS_MIN_BYTES. */
const PAD_TO = 1024;

function frame(json: Uint8Array): Uint8Array {
  const body = deflateSync(json);
  const total = Math.ceil((FRAME_HEADER + body.length) / PAD_TO) * PAD_TO;
  const out = new Uint8Array(total); // zero-filled → padding is implicit
  out[0] = FRAME_MARKER;
  out[1] = FRAME_V2;
  new DataView(out.buffer).setUint32(2, body.length, true);
  out.set(body, FRAME_HEADER);
  return out;
}

function unframe(plain: Uint8Array): Uint8Array {
  if (plain.length < FRAME_HEADER || plain[0] !== FRAME_MARKER) return plain; // v1
  if (plain[1] !== FRAME_V2) {
    // A newer format from a newer client. Fail closed and loudly rather than
    // hand back bytes that will mis-parse into a plausible-looking object.
    throw new Error(`unsupported payload frame version ${plain[1]}`);
  }
  const len = new DataView(plain.buffer, plain.byteOffset, plain.byteLength).getUint32(2, true);
  return inflateSync(plain.subarray(FRAME_HEADER, FRAME_HEADER + len));
}

export function encryptJSON(value: unknown, key: Uint8Array): string {
  const json = sodium.from_string(JSON.stringify(value));
  const payload = json.length >= COMPRESS_MIN_BYTES ? frame(json) : json;
  return b64(wrap(payload, key));
}

export function decryptJSON<T>(ciphertextB64: string, key: Uint8Array): T {
  return JSON.parse(sodium.to_string(unframe(unwrap(unb64(ciphertextB64), key)))) as T;
}

/** Encrypt raw bytes → `nonce ‖ secretbox`. Binary sibling of encryptJSON for
 *  large payloads (locally cached document originals) where the JSON + base64
 *  round-trip would roughly triple the allocation for megabytes of data. */
export function encryptBytes(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  return wrap(bytes, key);
}

export function decryptBytes(sealed: Uint8Array, key: Uint8Array): Uint8Array {
  return unwrap(sealed, key);
}

/** Standard base64 (`+/` with padding — the sync wire format, matching Python's
 *  base64). Like the other non-async helpers here, callable only after unlock
 *  (libsodium is initialized by then). */
export function bytesToBase64(bytes: Uint8Array): string {
  return b64(bytes);
}

export function base64ToBytes(s: string): Uint8Array {
  return unb64(s);
}

// --- shared projects: account identity + project keys ----------------------
// Each account gets one X25519 identity keypair: the public key is stored by
// the server (POST /auth/identity), the private key is wrapped under the Master
// Key (CTX "quonidk0", same nonce‖secretbox construction as the wrapped MK) so
// the server holds it opaquely and hands it back on login/me. A shared project's
// content key (PK) is random — derived from NO member's Master Key — and travels
// between members only as a libsodium sealed box to the recipient's identity
// public key. Like the other non-async helpers here, callable only after unlock.

export interface IdentityKeypair {
  pub: Uint8Array;
  priv: Uint8Array;
}

/** Fresh X25519 identity keypair for this account (crypto_box). */
export function generateIdentityKeypair(): IdentityKeypair {
  const kp = sodium.crypto_box_keypair();
  return { pub: kp.publicKey, priv: kp.privateKey };
}

/** Wrap the identity private key under the Master Key for server-side storage
 *  (`identity_priv_wrapped`). Returns base64 for the wire. */
export function wrapIdentityPriv(priv: Uint8Array, masterKey: Uint8Array): string {
  return b64(wrap(priv, kdf(masterKey, CTX_IDENTITY)));
}

/** Unwrap the identity private key returned by login/me. Throws when the blob
 *  wasn't wrapped under this Master Key (fail closed, never partial bytes). */
export function openIdentityPriv(wrapped: string, masterKey: Uint8Array): Uint8Array {
  return unwrap(unb64(wrapped), kdf(masterKey, CTX_IDENTITY));
}

/** Fresh random content key for ONE shared project — every blob of that project
 *  is encrypted under it, so membership (not any account's MK) controls access. */
export function generateProjectKey(): Uint8Array {
  return sodium.randombytes_buf(32);
}

/** Seal bytes (a project key) to a member's identity public key. Anonymous
 *  sender construction (crypto_box_seal): only the matching private key opens it,
 *  so the grant row the server stores is opaque ciphertext to the server. */
export function sealToIdentity(bytes: Uint8Array, pub: Uint8Array): Uint8Array {
  return sodium.crypto_box_seal(bytes, pub);
}

/** Open a sealed box addressed to our identity keypair. Throws when it was
 *  sealed to a different identity or tampered with (fail closed). */
export function openSealedFromIdentity(
  cipher: Uint8Array,
  pub: Uint8Array,
  priv: Uint8Array,
): Uint8Array {
  return sodium.crypto_box_seal_open(cipher, pub, priv);
}

// RFC 4648 base32 alphabet — 8 chars encode exactly the 40 hash bits below.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Short safety fingerprint of an identity public key for member display and
 *  out-of-band comparison: the first 40 bits of BLAKE2b(pub) as 8 base32 chars
 *  (e.g. "K7QMXA3Z"). Deterministic. NOT a substitute for real verification —
 *  Shared Projects v1 is trust-on-first-use (see plan §3, documented limit). */
export function identityFingerprint(pub: Uint8Array): string {
  const h = sodium.crypto_generichash(32, pub, null);
  let acc = 0;
  let bits = 0;
  let out = "";
  for (let i = 0; i < 5; i++) {
    // 5 bytes = 40 bits = exactly 8 × 5-bit base32 symbols, no padding.
    acc = (acc << 8) | h[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += B32_ALPHABET[(acc >> bits) & 31];
    }
  }
  return out;
}

// --- master-key persistence within a tab (survives reload, not close) -----
const MK_SESSION_KEY = "quon_mk_v1";

export async function persistMasterKey(masterKey: Uint8Array): Promise<void> {
  await ready();
  try {
    sessionStorage.setItem(MK_SESSION_KEY, b64(masterKey));
  } catch {
    /* sessionStorage unavailable (private mode) — MK stays in memory only */
  }
}

export async function loadPersistedMasterKey(): Promise<Uint8Array | null> {
  await ready();
  try {
    const raw = sessionStorage.getItem(MK_SESSION_KEY);
    return raw ? unb64(raw) : null;
  } catch {
    return null;
  }
}

export function clearPersistedMasterKey(): void {
  try {
    sessionStorage.removeItem(MK_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export async function ensureReady(): Promise<void> {
  return ready();
}
