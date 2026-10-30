/**
 * Pure chunking helpers for synced original-document bytes.
 *
 * The original file is encrypted WHOLE (one nonce‖secretbox ciphertext) and the
 * ciphertext is split into fixed-size chunks so each sync blob stays under the
 * server's 4 MiB per-blob cap. Chunks are addressed `orig:<docId>:<index>` in
 * the `originals` collection; reassembly is strict byte concatenation in index
 * order — decryption then authenticates the whole file, so a missing/corrupt
 * chunk fails closed (viewer falls back to the extracted-text view).
 *
 * Dependency-free on purpose: unit-testable without libsodium or a DOM.
 */

/** Ciphertext bytes per chunk. 3 MiB leaves headroom under the server's 4 MiB
 *  per-blob cap even after the ~4/3 base64 expansion is decoded away. */
export const ORIG_CHUNK_BYTES = 3 * 1024 * 1024;

/** Sync collection holding the chunked original ciphertext. */
export const ORIGINALS_COLLECTION = "originals";

/** Blob id of one ciphertext chunk. */
export function originalChunkId(docId: string, index: number): string {
  return `orig:${docId}:${index}`;
}

/** How many chunks a ciphertext of `byteLength` splits into (≥ 1). */
export function chunkCountFor(byteLength: number, chunkBytes = ORIG_CHUNK_BYTES): number {
  return Math.max(1, Math.ceil(byteLength / chunkBytes));
}

/** Split bytes into ≤`chunkBytes` slices (subarray views — no copies). */
export function chunkBytes(bytes: Uint8Array, chunkBytes = ORIG_CHUNK_BYTES): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let off = 0; off < bytes.length; off += chunkBytes) {
    out.push(bytes.subarray(off, Math.min(off + chunkBytes, bytes.length)));
  }
  return out.length ? out : [bytes];
}

/** Inverse of chunkBytes: concatenate chunks in array order. */
export function assembleChunks(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
