/**
 * Manifest handling on DocItem (`original` - the pointer other devices use to
 * lazily fetch synced original bytes): set/clear semantics, the no-op guard
 * (must not bump updatedAt or re-push), and the delete-detail event that lets
 * originalSync tombstone a deleted document's chunks. Pure store logic -
 * IndexedDB is absent in node and the store fails soft to memory-only.
 */
import { describe, expect, it, vi } from "vitest";

import {
  deleteDocument,
  documentSyncStore,
  getDocument,
  onDocumentDeleted,
  setDocumentOriginal,
  upsertDocument,
  type DocItem,
} from "./documentStore";

function makeDoc(id: string): DocItem {
  return {
    id,
    filename: `${id}.pdf`,
    mime: "application/pdf",
    status: "ready",
    chunks: [{ index: 0, text: "hello" }],
    createdAt: 1000,
    updatedAt: 1000,
  };
}

describe("setDocumentOriginal", () => {
  it("attaches the manifest, bumps updatedAt and fires a sync push", () => {
    upsertDocument(makeDoc("m1"));
    const pushed = vi.fn();
    const off = documentSyncStore.onChange(pushed);

    setDocumentOriginal("m1", { size: 123, chunkCount: 2 });
    off();

    const doc = getDocument("m1")!;
    expect(doc.original).toEqual({ size: 123, chunkCount: 2 });
    expect(doc.updatedAt).toBeGreaterThan(1000);
    expect(pushed).toHaveBeenCalledTimes(1);
    expect(pushed.mock.calls[0][0].original).toEqual({ size: 123, chunkCount: 2 });
  });

  it("is a no-op for an identical manifest (no updatedAt bump, no re-push)", () => {
    upsertDocument({ ...makeDoc("m2"), original: { size: 9, chunkCount: 1 } });
    const before = getDocument("m2")!.updatedAt;
    const pushed = vi.fn();
    const off = documentSyncStore.onChange(pushed);

    setDocumentOriginal("m2", { size: 9, chunkCount: 1 });
    off();

    expect(getDocument("m2")!.updatedAt).toBe(before);
    expect(pushed).not.toHaveBeenCalled();
  });

  it("clears the manifest with undefined", () => {
    upsertDocument({ ...makeDoc("m3"), original: { size: 9, chunkCount: 1 } });
    setDocumentOriginal("m3", undefined);
    expect(getDocument("m3")!.original).toBeUndefined();
  });

  it("ignores unknown document ids", () => {
    const pushed = vi.fn();
    const off = documentSyncStore.onChange(pushed);
    setDocumentOriginal("nope", { size: 1, chunkCount: 1 });
    off();
    expect(pushed).not.toHaveBeenCalled();
  });
});

describe("onDocumentDeleted (delete-detail event)", () => {
  it("delivers the full pre-delete item so chunk tombstones know chunkCount", () => {
    upsertDocument({ ...makeDoc("m4"), original: { size: 50, chunkCount: 3 } });
    const seen: DocItem[] = [];
    const off = onDocumentDeleted((d) => seen.push(d));

    deleteDocument("m4");
    off();

    expect(getDocument("m4")).toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0].id).toBe("m4");
    expect(seen[0].original).toEqual({ size: 50, chunkCount: 3 });
  });

  it("does not fire for unknown ids", () => {
    const cb = vi.fn();
    const off = onDocumentDeleted(cb);
    deleteDocument("never-existed");
    off();
    expect(cb).not.toHaveBeenCalled();
  });
});
