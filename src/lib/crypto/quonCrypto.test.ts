/**
 * Roundtrip + tamper tests for the zero-knowledge key schedule. This is QUON's
 * trust anchor — until now it was only exercised indirectly via the E2E auth
 * flow. These lock the core invariants: the password path and the recovery path
 * unlock the SAME Master Key, a wrong password cannot, ciphertext survives a
 * JSON roundtrip, and any tampering fails closed (throws — never a partial
 * plaintext). Argon2id is genuinely run (64 MiB / 3 ops), so allow a long timeout.
 */
import { describe, expect, it } from "vitest";

import {
  buildRegistration,
  decryptJSON,
  deriveAuth,
  deriveBioWrapKey,
  deriveChatKey,
  encryptJSON,
  ensureReady,
  generateIdentityKeypair,
  generateProjectKey,
  identityFingerprint,
  isValidMnemonic,
  openIdentityPriv,
  openSealedFromIdentity,
  buildRecoveryRotation,
  recoverMasterKey,
  rewrapForPassword,
  sealToIdentity,
  unlockMasterKey,
  unlockMasterKeyBio,
  wrapIdentityPriv,
  wrapMasterKeyForBio,
} from "./quonCrypto";

const PW = "correct horse battery staple";
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe("quonCrypto key schedule", () => {
  it("password login unwraps the same Master Key that registration created", async () => {
    const { material, masterKey } = await buildRegistration(PW);
    const { authToken, pwWrapKey } = await deriveAuth(PW, material.kdfSalt, material.kdfParams);
    // Auth token is deterministic from the password + salt (server verifier).
    expect(authToken).toBe(material.authToken);
    const unlocked = unlockMasterKey(material.wrapPw, pwWrapKey);
    expect(eq(unlocked, masterKey)).toBe(true);
  }, 20000);

  it("a wrong password derives a different auth token and cannot unwrap the MK", async () => {
    const { material } = await buildRegistration(PW);
    const wrong = await deriveAuth("wrong password", material.kdfSalt, material.kdfParams);
    expect(wrong.authToken).not.toBe(material.authToken);
    // The wrong wrap key must fail the secretbox auth tag, never yield plaintext.
    expect(() => unlockMasterKey(material.wrapPw, wrong.pwWrapKey)).toThrow();
  }, 20000);

  it("the recovery phrase unwraps the same Master Key as the password", async () => {
    const { material, masterKey } = await buildRegistration(PW);
    expect(isValidMnemonic(material.mnemonic)).toBe(true);
    const recovered = await recoverMasterKey(
      material.mnemonic,
      material.recSalt,
      material.wrapRec,
      material.kdfParams,
    );
    expect(eq(recovered, masterKey)).toBe(true);
  }, 20000);

  it("recovery rotation: the NEW phrase unwraps the MK, the OLD one is dead", async () => {
    const { material, masterKey } = await buildRegistration(PW);
    const rotation = await buildRecoveryRotation(masterKey, material.kdfParams);
    expect(isValidMnemonic(rotation.mnemonic)).toBe(true);
    expect(rotation.mnemonic).not.toBe(material.mnemonic);

    // New phrase + new material → the same Master Key (kdfParams MUST be the
    // stored ones — the server keeps one params column for both derivations).
    const recovered = await recoverMasterKey(
      rotation.mnemonic,
      rotation.recSalt,
      rotation.wrapRec,
      material.kdfParams,
    );
    expect(eq(recovered, masterKey)).toBe(true);

    // The OLD phrase cannot open the NEW wrap (rotation invalidates it).
    await expect(
      recoverMasterKey(material.mnemonic, rotation.recSalt, rotation.wrapRec, material.kdfParams),
    ).rejects.toThrow();
  }, 30000);

  it("encryptJSON → decryptJSON round-trips under a Master-Key-derived subkey", async () => {
    const { masterKey } = await buildRegistration(PW);
    const key = deriveChatKey(masterKey);
    const value = { role: "user", content: "Anna Müller, IBAN DE89…", n: 42 };
    const restored = decryptJSON<typeof value>(encryptJSON(value, key), key);
    expect(restored).toEqual(value);
  }, 20000);

  it("a single flipped bit in the ciphertext fails closed (throws, no partial plaintext)", async () => {
    const { masterKey } = await buildRegistration(PW);
    const key = deriveChatKey(masterKey);
    const ct = encryptJSON({ secret: "top" }, key);
    // Mutate one base64 char deep in the body (past the nonce) → auth tag fails.
    const bytes = Array.from(atob(ct), (c) => c.charCodeAt(0));
    bytes[bytes.length - 3] ^= 0x01;
    const tampered = btoa(String.fromCharCode(...bytes));
    expect(() => decryptJSON(tampered, key)).toThrow();
  }, 20000);

  it("re-wrapping under a new password keeps the SAME Master Key and preserves recovery", async () => {
    const { material, masterKey } = await buildRegistration(PW);
    const NEW_PW = "a different passphrase entirely";
    const rewrapped = await rewrapForPassword(masterKey, NEW_PW);

    // New password unlocks the same MK...
    const np = await deriveAuth(NEW_PW, rewrapped.kdfSalt, rewrapped.kdfParams);
    expect(np.authToken).toBe(rewrapped.authToken);
    expect(eq(unlockMasterKey(rewrapped.wrapPw, np.pwWrapKey), masterKey)).toBe(true);

    // ...and the original recovery phrase still works (wrap_rec is untouched).
    const recovered = await recoverMasterKey(
      material.mnemonic,
      material.recSalt,
      material.wrapRec,
      material.kdfParams,
    );
    expect(eq(recovered, masterKey)).toBe(true);
  }, 30000);
});

// Shared Projects primitives. No Argon2 needed — a Master Key is just 32 random
// bytes, so generateProjectKey() doubles as a fast MK stand-in (same shape).
describe("shared-projects crypto (identity keypair + sealed project keys)", () => {
  it("identity priv wrap → open round-trips under the same Master Key; a wrong MK fails closed", async () => {
    await ensureReady();
    const mk = generateProjectKey();
    const { pub, priv } = generateIdentityKeypair();
    expect(pub).toHaveLength(32); // X25519
    expect(priv).toHaveLength(32);

    const wrapped = wrapIdentityPriv(priv, mk);
    expect(eq(openIdentityPriv(wrapped, mk), priv)).toBe(true);

    // A different Master Key must fail the secretbox auth tag, never yield bytes.
    const otherMk = generateProjectKey();
    expect(() => openIdentityPriv(wrapped, otherMk)).toThrow();
  });

  it("seal → open round-trips a project key; the wrong identity cannot open it", async () => {
    await ensureReady();
    const alice = generateIdentityKeypair();
    const pk = generateProjectKey();
    expect(pk).toHaveLength(32);

    const sealed = sealToIdentity(pk, alice.pub);
    // Sealed boxes are ephemeral-key + nonce derived — never the plaintext.
    expect(sealed.length).toBeGreaterThan(pk.length);
    expect(eq(openSealedFromIdentity(sealed, alice.pub, alice.priv), pk)).toBe(true);

    // Mallory's keypair (or a tampered box) must fail closed.
    const mallory = generateIdentityKeypair();
    expect(() => openSealedFromIdentity(sealed, mallory.pub, mallory.priv)).toThrow();
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] ^= 0x01;
    expect(() => openSealedFromIdentity(tampered, alice.pub, alice.priv)).toThrow();
  });

  it("identityFingerprint is stable, 8 base32 chars, and differs across keys", async () => {
    await ensureReady();
    const a = generateIdentityKeypair();
    const b = generateIdentityKeypair();
    const fp = identityFingerprint(a.pub);
    expect(fp).toMatch(/^[A-Z2-7]{8}$/);
    expect(identityFingerprint(a.pub)).toBe(fp); // deterministic
    expect(identityFingerprint(b.pub)).not.toBe(fp);
  });
});

// PRF outputs and Master Keys are both 32 random bytes — generateProjectKey()
// doubles as a fast stand-in for each (no Argon2 in these tests, same as the
// shared-projects suite above).
describe("biometric-unlock wrap (WebAuthn PRF)", () => {
  it("round-trips the Master Key from a fake 32-byte PRF output", async () => {
    await ensureReady();
    const masterKey = generateProjectKey();
    const prfOutput = new Uint8Array(32).fill(7);

    const bioWrapKey = await deriveBioWrapKey(prfOutput);
    const wrapBio = await wrapMasterKeyForBio(masterKey, bioWrapKey);
    // Ciphertext, never the plaintext key.
    expect(wrapBio).not.toContain(Buffer.from(masterKey).toString("base64"));

    const recovered = await unlockMasterKeyBio(wrapBio, bioWrapKey);
    expect(eq(recovered, masterKey)).toBe(true);
  });

  it("fails closed on a wrong PRF output and on a tampered blob", async () => {
    await ensureReady();
    const masterKey = generateProjectKey();
    const right = await deriveBioWrapKey(new Uint8Array(32).fill(7));
    const wrong = await deriveBioWrapKey(new Uint8Array(32).fill(8));
    const wrapBio = await wrapMasterKeyForBio(masterKey, right);

    await expect(unlockMasterKeyBio(wrapBio, wrong)).rejects.toThrow();

    const bytes = Buffer.from(wrapBio, "base64");
    bytes[bytes.length - 1] ^= 0x01;
    await expect(unlockMasterKeyBio(bytes.toString("base64"), right)).rejects.toThrow();
  });

  it("derives distinct wrap keys for distinct PRF outputs", async () => {
    await ensureReady();
    const a = await deriveBioWrapKey(new Uint8Array(32).fill(1));
    const b = await deriveBioWrapKey(new Uint8Array(32).fill(2));
    expect(eq(a, b)).toBe(false);
  });
});
