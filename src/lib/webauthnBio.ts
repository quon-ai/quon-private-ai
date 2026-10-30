/**
 * WebAuthn helpers for biometric unlock (Face ID / Touch ID / fingerprint).
 *
 * PRF-only by design: the wrap key for the Master Key is derived from the
 * authenticator's PRF output, which lives in the device's secure hardware and
 * is released only after on-device user verification. Devices/browsers without
 * the PRF extension (e.g. iOS < 18) are NOT offered a weaker fallback — the
 * feature simply isn't available there (fail honest, zero-knowledge intact).
 *
 * Raw WebAuthn API on purpose (no @simplewebauthn dependency): there is no
 * server ceremony to encode/verify — the session cookie is the auth factor and
 * the PRF ceremony is purely key release, so the whole surface is one create()
 * and one get(). rp.id is deliberately never set: it defaults to the effective
 * domain, which works for app.quon.example.com and localhost dev alike (a future
 * domain move fails honest → password fallback → re-enroll).
 *
 * Note on synced passkeys (iCloud Keychain / Google Password Manager): the
 * credential and its PRF secret may sync across the user's own devices. That
 * stays within the same-user trust domain; other devices still lack the local
 * enrollment marker, so nothing surfaces there unless the user enrolls.
 */

/** User canceled / dismissed the platform prompt — callers reset silently. */
export class BioCancelledError extends Error {
  constructor() {
    super("biometric prompt was cancelled");
    this.name = "BioCancelledError";
  }
}

/** The authenticator lacks PRF support — feature not available, fail honest. */
export class BioPrfUnavailableError extends Error {
  constructor() {
    super("this authenticator does not support the PRF extension");
    this.name = "BioPrfUnavailableError";
  }
}

// --- base64url (unpadded), standalone — usable before sodium init ----------
export function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  // Explicit ArrayBuffer backing so the result satisfies DOM BufferSource
  // (allowCredentials[].id) under TS 5.7's generic Uint8Array types.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Secure context + WebAuthn API present. */
export function webauthnAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "PublicKeyCredential" in window;
}

/** Face ID / Touch ID / fingerprint (a user-verifying PLATFORM authenticator)
 *  exists on this device. False on any error — feature hides, never breaks. */
export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!webauthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// The PRF extension isn't in TS's lib.dom yet across our toolchain — minimal
// local shapes for the two calls we make.
interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

function extensionResults(cred: PublicKeyCredential): PrfExtensionResults {
  return cred.getClientExtensionResults() as PrfExtensionResults;
}

function isCancel(err: unknown): boolean {
  // Chrome/Safari signal user dismissal (and timeouts) as NotAllowedError.
  return err instanceof DOMException && err.name === "NotAllowedError";
}

/** Create the platform passkey for this device and report whether it supports
 *  PRF. PRF *results* are deliberately not requested here — several platforms
 *  (notably iOS) only return them on get(), so enrollment is create-then-get. */
export async function createBioCredential(
  userId: string,
  email: string,
): Promise<{ credentialId: string; prfEnabled: boolean }> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "QUON" }, // rp.id omitted — effective domain (see header)
        user: {
          id: new TextEncoder().encode(userId),
          name: email,
          displayName: email,
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 }, // ES256
          { type: "public-key", alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        attestation: "none",
        extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancel(err)) throw new BioCancelledError();
    throw err;
  }
  if (!cred) throw new BioCancelledError();
  const prfEnabled = extensionResults(cred).prf?.enabled === true;
  return { credentialId: cred.id, prfEnabled };
}

/** Run the PRF evaluation for an enrolled credential and return the 32-byte
 *  output. Triggers the platform biometric prompt. Must be called within a
 *  user gesture (Safari requires transient activation for get()). */
export async function evalPrf(credentialId: string, prfSalt: Uint8Array): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [
          { type: "public-key", id: b64urlToBytes(credentialId), transports: ["internal"] },
        ],
        userVerification: "required",
        extensions: {
          prf: { eval: { first: prfSalt } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isCancel(err)) throw new BioCancelledError();
    throw err;
  }
  if (!cred) throw new BioCancelledError();
  const first = extensionResults(cred).prf?.results?.first;
  if (!first) throw new BioPrfUnavailableError();
  return new Uint8Array(first);
}
