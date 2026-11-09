/**
 * Local vault - encrypts this device's caches (localStorage / IndexedDB) at rest.
 *
 * The server has always only seen ciphertext (zero-knowledge sync); this closes
 * the *device* side: chat history, Memory/Documents/Projects and preferences
 * (incl. the `alwaysRedact` PII list) are sealed with a key derived from the
 * Master Key before they touch disk, so another OS user, a disk backup, or a
 * different browser profile account can't read them. The Master Key itself lives
 * only in memory/sessionStorage (see quonCrypto.persistMasterKey).
 *
 * The cache key is set on unlock (authStore.setMasterKey -> deriveLocalCacheKey)
 * and cleared on logout. Before the key exists nothing is read from or written
 * to disk - stores start empty and hydrate as soon as the key arrives; writes
 * without a key are skipped (fail soft; the server sync stays the durable copy).
 *
 * Sealed values are tagged with the `enc1:` / `{enc1: ...}` envelope so legacy
 * plaintext caches are recognized, loaded once, and re-written sealed (migration).
 */

import { decryptBytes, decryptJSON, encryptBytes, encryptJSON } from "./crypto/quonCrypto";

const PREFIX = "enc1:";

let cacheKey: Uint8Array | null = null;
let waiters: Array<() => void> = [];

/** Install the cache key (called on unlock with KDF(MK, "quonloc0")). Wakes up
 *  every store that deferred its disk load until the key existed. */
export function setLocalCacheKey(key: Uint8Array): void {
  cacheKey = key;
  const wake = waiters;
  waiters = [];
  for (const w of wake) w();
}

/** Drop the cache key (logout / account switch). In-flight waiters stay pending
 *  until the next unlock - a locked/anonymous app never reads the caches. */
export function clearLocalCacheKey(): void {
  cacheKey = null;
}

export function hasLocalCacheKey(): boolean {
  return cacheKey !== null;
}

/** Resolves once a cache key is available (immediately when already unlocked). */
export function whenLocalCacheKey(): Promise<void> {
  if (cacheKey) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

/** Seal a value for local persistence: `enc1:<base64(secretbox)>`, or null when
 *  no key is available (caller must then skip the write - never store plaintext). */
export function sealLocal(value: unknown): string | null {
  if (!cacheKey) return null;
  try {
    return PREFIX + encryptJSON(value, cacheKey);
  } catch {
    return null;
  }
}

/** True when a stored string is a sealed envelope (vs. a legacy plaintext cache). */
export function isSealedLocal(raw: string): boolean {
  return raw.startsWith(PREFIX);
}

/** Open a sealed envelope. Null when there is no key, the value isn't sealed, or
 *  it was sealed under a different account's key (treat as absent/corrupt). */
export function openLocal<T>(raw: string): T | null {
  if (!cacheKey || !isSealedLocal(raw)) return null;
  try {
    return decryptJSON<T>(raw.slice(PREFIX.length), cacheKey);
  } catch {
    return null;
  }
}

/** Binary siblings of sealLocal/openLocal, for payloads that are raw bytes
 *  (locally cached document originals). Same contract - no key -> no plaintext
 *  write, wrong key / tampered -> null - but without the JSON+base64 detour,
 *  which would ~2.5x the memory for multi-megabyte files. */
export function sealLocalBytes(bytes: Uint8Array): Uint8Array | null {
  if (!cacheKey) return null;
  try {
    return encryptBytes(bytes, cacheKey);
  } catch {
    return null;
  }
}

export function openLocalBytes(sealed: Uint8Array): Uint8Array | null {
  if (!cacheKey) return null;
  try {
    return decryptBytes(sealed, cacheKey);
  } catch {
    return null;
  }
}
