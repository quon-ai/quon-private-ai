/**
 * The v2 compressed payload frame.
 *
 * This is a WIRE FORMAT change on end-to-end-encrypted blobs, so the tests that
 * matter are the compatibility ones: blobs written by clients that predate this
 * must still decrypt, and a v2 blob must never mis-parse into a plausible object
 * on a client that can't read it — it has to fail closed.
 *
 * `encryptBytes`/`decryptBytes` use the same nonce‖secretbox `wrap`/`unwrap` as
 * `encryptJSON`, so they let these tests build a genuine v1 blob (and act as a
 * v1-only reader) without exporting the module's internals.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  decryptBytes,
  decryptJSON,
  deriveChatKey,
  encryptBytes,
  encryptJSON,
  ensureReady,
} from "./quonCrypto";

const KEY = () => deriveChatKey(new Uint8Array(32).fill(7));
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Exactly what encryptJSON produced before the frame existed. */
function legacyBlob(value: unknown, key: Uint8Array): string {
  return b64(encryptBytes(utf8(JSON.stringify(value)), key));
}

/** German-ish, repetitive — the shape real chat JSON has. */
function bulky(n: number) {
  const words = "Vertrag Kündigung Mietverhältnis Frist Betrag [PERSON_1] Rechnung".split(" ");
  let s = "";
  while (s.length < n) s += words[s.length % words.length] + " ";
  return { note: s.slice(0, n), nested: { again: s.slice(0, n) } };
}

beforeAll(async () => {
  await ensureReady();
});

describe("backward compatibility", () => {
  it("reads a v1 blob written before the frame existed", () => {
    const key = KEY();
    for (const value of [
      bulky(50_000),
      { small: "x" },
      [1, 2, 3],
      "plain string",
      42,
      true,
      null,
    ]) {
      expect(decryptJSON(legacyBlob(value, key), key)).toEqual(value);
    }
  });

  it("decodes v1 payloads starting with every legal JSON first byte", () => {
    // The marker relies on JSON never beginning with a byte < 0x20.
    const key = KEY();
    for (const value of [{ a: 1 }, [0], "s", 7, -3, true, false, null]) {
      const first = JSON.stringify(value)[0];
      expect(first.charCodeAt(0)).toBeGreaterThanOrEqual(0x20);
      expect(decryptJSON(legacyBlob(value, key), key)).toEqual(value);
    }
  });
});

describe("v2 round trip", () => {
  it("compresses a large payload and reads it back exactly", () => {
    const key = KEY();
    const value = bulky(200_000);
    expect(decryptJSON(encryptJSON(value, key), key)).toEqual(value);
  });

  it("actually shrinks the blob", () => {
    const key = KEY();
    const value = bulky(200_000);
    expect(encryptJSON(value, key).length).toBeLessThan(legacyBlob(value, key).length / 3);
  });

  it("leaves small payloads as v1 so old clients keep reading them", () => {
    // Below the threshold there is nothing to win, and prefs/jobs/projects stay
    // universally readable.
    const key = KEY();
    const small = { protectionLevel: "local", model: "gemini" };
    const mine = encryptJSON(small, key);
    // A v1-only reader (pre-frame decode path) must still understand it.
    expect(JSON.parse(new TextDecoder().decode(decryptBytes(fromB64(mine), key)))).toEqual(small);
  });

  it("pads the plaintext into buckets so the length leaks less", () => {
    // Two payloads of noticeably different size must be able to land on the same
    // ciphertext length — that is the point of padding.
    const key = KEY();
    const lengths = new Set<number>();
    for (let extra = 0; extra < 400; extra += 40) {
      lengths.add(fromB64(encryptJSON(bulky(20_000 + extra), key)).length);
    }
    expect(lengths.size).toBeLessThan(400 / 40);
  });
});

describe("fail closed", () => {
  it("a v1-only reader rejects a v2 blob rather than mis-parsing it", () => {
    // An un-updated device must get a hard failure (collectionSync skips the
    // item) — never a partial or plausible-looking object.
    const key = KEY();
    const v2 = encryptJSON(bulky(200_000), key);
    expect(() => JSON.parse(new TextDecoder().decode(decryptBytes(fromB64(v2), key)))).toThrow();
  });

  it("rejects an unknown future frame version", () => {
    const key = KEY();
    const framed = new Uint8Array(64);
    framed[0] = 0x00;
    framed[1] = 0x7f; // some future format
    expect(() => decryptJSON(b64(encryptBytes(framed, key)), key)).toThrow(/frame version/);
  });

  it("still fails on a tampered blob", () => {
    const key = KEY();
    const raw = fromB64(encryptJSON(bulky(200_000), key));
    raw[raw.length - 1] ^= 0xff;
    expect(() => decryptJSON(b64(raw), key)).toThrow();
  });

  it("fails with the wrong key", () => {
    const blob = encryptJSON(bulky(200_000), KEY());
    const other = deriveChatKey(new Uint8Array(32).fill(9));
    expect(() => decryptJSON(blob, other)).toThrow();
  });
});

function fromB64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64"));
}
