/**
 * Chunking/reassembly for synced original bytes: the split->concat round-trip
 * must be byte-exact for every size shape (single chunk, exact multiple,
 * remainder), since decryption authenticates the reassembled whole file - any
 * ordering or boundary bug would (correctly) fail closed into the text view.
 */
import { describe, expect, it } from "vitest";

import {
  assembleChunks,
  chunkBytes,
  chunkCountFor,
  ORIG_CHUNK_BYTES,
  originalChunkId,
  ORIGINALS_COLLECTION,
} from "./originalChunks";

function pattern(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) % 256;
  return b;
}

describe("chunkBytes / assembleChunks", () => {
  it("round-trips byte-exactly across size shapes", () => {
    const cs = 8;
    for (const n of [1, 7, 8, 9, 16, 17, 1000]) {
      const input = pattern(n);
      const chunks = chunkBytes(input, cs);
      expect(chunks.length).toBe(chunkCountFor(n, cs));
      expect(assembleChunks(chunks)).toEqual(input);
    }
  });

  it("respects the chunk-size bound (all full except possibly the last)", () => {
    const chunks = chunkBytes(pattern(21), 8);
    expect(chunks.map((c) => c.length)).toEqual([8, 8, 5]);
  });

  it("produces a single chunk for empty input (degenerate, never synced)", () => {
    const chunks = chunkBytes(new Uint8Array(0), 8);
    expect(chunks.length).toBe(1);
    expect(assembleChunks(chunks).length).toBe(0);
  });

  it("uses the 3 MiB default, under the server's 4 MiB per-blob cap", () => {
    expect(ORIG_CHUNK_BYTES).toBe(3 * 1024 * 1024);
    expect(ORIG_CHUNK_BYTES).toBeLessThan(4 * 1024 * 1024);
    const chunks = chunkBytes(pattern(ORIG_CHUNK_BYTES + 1));
    expect(chunks.length).toBe(2);
  });

  it("order matters for reassembly (documents the strict-order contract)", () => {
    const input = pattern(16);
    const [a, b] = chunkBytes(input, 8);
    expect(assembleChunks([b, a])).not.toEqual(input);
  });
});

describe("chunkCountFor", () => {
  it("is >= 1 and matches ceil(n / chunk)", () => {
    expect(chunkCountFor(0, 8)).toBe(1);
    expect(chunkCountFor(8, 8)).toBe(1);
    expect(chunkCountFor(9, 8)).toBe(2);
    expect(chunkCountFor(24, 8)).toBe(3);
  });
});

describe("originalChunkId", () => {
  it("addresses chunks as orig:<docId>:<index> in the originals collection", () => {
    expect(ORIGINALS_COLLECTION).toBe("originals");
    expect(originalChunkId("doc_123_ab", 0)).toBe("orig:doc_123_ab:0");
    expect(originalChunkId("doc_123_ab", 7)).toBe("orig:doc_123_ab:7");
  });

  it("stays within the server's 128-char blob-id budget for realistic ids", () => {
    // createDocumentId() -> `doc_<epoch-ms>_<5 chars>` (~22 chars).
    const id = originalChunkId(`doc_${Date.now()}_abcde`, 999);
    expect(id.length).toBeLessThanOrEqual(128);
  });
});
