/**
 * Local vault (at-rest cache encryption) — the invariants the stores rely on:
 * no key → no plaintext write (sealLocal null), sealed values only open under
 * the same key, and deferred loads wake up exactly when the key arrives.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { ensureReady } from "./crypto/quonCrypto";
import {
  clearLocalCacheKey,
  hasLocalCacheKey,
  isSealedLocal,
  openLocal,
  openLocalBytes,
  sealLocal,
  sealLocalBytes,
  setLocalCacheKey,
  whenLocalCacheKey,
} from "./localVault";

function key(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

beforeEach(async () => {
  await ensureReady();
  clearLocalCacheKey();
});

describe("sealLocal / openLocal", () => {
  it("refuses to seal without a key (never plaintext to disk)", () => {
    expect(hasLocalCacheKey()).toBe(false);
    expect(sealLocal({ secret: "pii" })).toBeNull();
  });

  it("round-trips a value under the same key", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocal({ name: "Anna Müller", n: 42 });
    expect(sealed).not.toBeNull();
    expect(isSealedLocal(sealed!)).toBe(true);
    // The ciphertext must not contain the plaintext.
    expect(sealed).not.toContain("Anna");
    expect(openLocal<{ name: string; n: number }>(sealed!)).toEqual({
      name: "Anna Müller",
      n: 42,
    });
  });

  it("does not open under a different account's key", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocal({ secret: "of account A" })!;
    setLocalCacheKey(key(2));
    expect(openLocal(sealed)).toBeNull();
  });

  it("does not open after the key is cleared (logout)", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocal({ x: 1 })!;
    clearLocalCacheKey();
    expect(openLocal(sealed)).toBeNull();
  });

  it("treats legacy plaintext JSON as not-sealed (migration path)", () => {
    setLocalCacheKey(key(1));
    const legacy = JSON.stringify({ protectionLevel: "local" });
    expect(isSealedLocal(legacy)).toBe(false);
    expect(openLocal(legacy)).toBeNull();
  });

  it("returns null for a tampered envelope instead of throwing", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocal({ x: 1 })!;
    const tampered = sealed.slice(0, -4) + "AAAA";
    expect(openLocal(tampered)).toBeNull();
  });
});

describe("sealLocalBytes / openLocalBytes", () => {
  // %PDF magic + arbitrary binary — the shape the originals cache stores.
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 1, 2, 253, 254, 255]);

  it("refuses to seal without a key (never plaintext to disk)", () => {
    expect(sealLocalBytes(bytes)).toBeNull();
  });

  it("round-trips bytes under the same key, without plaintext in the envelope", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocalBytes(bytes);
    expect(sealed).not.toBeNull();
    // The ciphertext must not contain the plaintext (check the %PDF magic).
    const hay = Array.from(sealed!).join(",");
    expect(hay).not.toContain("37,80,68,70");
    expect(Array.from(openLocalBytes(sealed!)!)).toEqual(Array.from(bytes));
  });

  it("does not open under a different account's key", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocalBytes(bytes)!;
    setLocalCacheKey(key(2));
    expect(openLocalBytes(sealed)).toBeNull();
  });

  it("does not open after the key is cleared (logout)", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocalBytes(bytes)!;
    clearLocalCacheKey();
    expect(openLocalBytes(sealed)).toBeNull();
  });

  it("returns null for a tampered envelope instead of throwing", () => {
    setLocalCacheKey(key(1));
    const sealed = sealLocalBytes(bytes)!;
    sealed[sealed.length - 1] ^= 0xff;
    expect(openLocalBytes(sealed)).toBeNull();
  });
});

describe("whenLocalCacheKey", () => {
  it("resolves immediately when the key is already set", async () => {
    setLocalCacheKey(key(1));
    await expect(whenLocalCacheKey()).resolves.toBeUndefined();
  });

  it("stays pending until the key arrives, then wakes all waiters", async () => {
    let woken = 0;
    const a = whenLocalCacheKey().then(() => woken++);
    const b = whenLocalCacheKey().then(() => woken++);
    await new Promise((r) => setTimeout(r, 10));
    expect(woken).toBe(0); // still locked
    setLocalCacheKey(key(1));
    await Promise.all([a, b]);
    expect(woken).toBe(2);
  });
});
