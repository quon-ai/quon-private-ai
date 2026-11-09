/**
 * Push planning: the logic that decides whether a collection keeps syncing or
 * wedges.
 *
 * The bug these lock in: the relay rejects a blob over 4 MiB - and a batch over
 * 500 changes - with a WHOLE-REQUEST 413 (`quon-scrubber-service/sync.py:249`,
 * `:264`). The client caught that with a bare `catch` that re-queued everything,
 * so one oversized chat re-sent the same doomed payload forever and its entire
 * collection stopped syncing, silently. A long RAG-heavy chat reaches the cap
 * easily: every user turn persists `rag.context` plus each source's snippet.
 */
import { describe, expect, it } from "vitest";

import { MAX_BLOB_BYTES, PUSH_BATCH_SIZE, b64Bytes, planPush } from "./collectionSync";
import type { BlobIn } from "./api/syncApi";

/** A blob whose ciphertext base64-decodes to exactly `bytes` - the boundary
 *  cases are the point, so the helper must not round to a 3-byte group. */
function blob(id: string, bytes: number): BlobIn {
  const groups = Math.ceil(bytes / 3);
  const pad = (3 - (bytes % 3)) % 3;
  return {
    collection: "chat",
    id,
    ciphertext: "A".repeat(groups * 4 - pad) + "=".repeat(pad),
    updated_at: 1,
  };
}

describe("b64Bytes", () => {
  it("matches the decoded length the server measures", () => {
    // The server base64-decodes before comparing, so the cap is on decoded bytes.
    expect(b64Bytes("")).toBe(0);
    expect(b64Bytes("QUJD")).toBe(3); // "ABC"
    expect(b64Bytes("QUJDRA==")).toBe(4); // "ABCD"
    expect(b64Bytes("QUJDREU=")).toBe(5); // "ABCDE"
  });

  it("agrees with a real round trip", () => {
    for (const s of ["a", "ab", "abc", "abcd", "hello world", "ü".repeat(20)]) {
      const bytes = new TextEncoder().encode(s);
      const b64 = btoa(String.fromCharCode(...bytes));
      expect(b64Bytes(b64)).toBe(bytes.length);
    }
  });
});

describe("planPush", () => {
  it("keeps every batch within the relay's change cap", () => {
    const changes = Array.from({ length: 1250 }, (_, i) => blob(`c${i}`, 10));
    const { batches, oversized } = planPush(changes);

    expect(oversized).toEqual([]);
    expect(batches.length).toBe(Math.ceil(1250 / PUSH_BATCH_SIZE));
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(PUSH_BATCH_SIZE);
    // Nothing dropped, nothing duplicated.
    expect(batches.flat().map((c) => c.id)).toEqual(changes.map((c) => c.id));
  });

  it("quarantines an oversized blob instead of batching it", () => {
    const big = blob("huge-chat", MAX_BLOB_BYTES + 1024);
    const { batches, oversized } = planPush([blob("a", 10), big, blob("b", 10)]);

    expect(oversized.map((o) => o.change.id)).toEqual(["huge-chat"]);
    expect(oversized[0].bytes).toBeGreaterThan(MAX_BLOB_BYTES);
    // ...and the healthy siblings still go out. This is the whole fix: one
    // impossible blob must not stop the rest of the collection.
    expect(batches.flat().map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("passes a blob that sits exactly on the cap", () => {
    const { batches, oversized } = planPush([blob("edge", MAX_BLOB_BYTES)]);
    expect(oversized).toEqual([]);
    expect(batches.flat().map((c) => c.id)).toEqual(["edge"]);
  });

  it("produces no batches when everything is oversized", () => {
    const { batches, oversized } = planPush([blob("x", MAX_BLOB_BYTES * 2)]);
    expect(batches).toEqual([]);
    expect(oversized.length).toBe(1);
  });

  it("handles an empty push", () => {
    expect(planPush([])).toEqual({ batches: [], oversized: [] });
  });

  it("treats a tombstone (empty ciphertext) as sendable", () => {
    const tombstone: BlobIn = {
      collection: "chat",
      id: "gone",
      ciphertext: "",
      updated_at: 1,
      deleted: true,
    };
    const { batches, oversized } = planPush([tombstone]);
    expect(oversized).toEqual([]);
    expect(batches.flat()).toEqual([tombstone]);
  });
});
