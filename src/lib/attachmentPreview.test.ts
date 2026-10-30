import { describe, expect, it } from "vitest";

import { keepUploadBytes, mergeRedactTerms, previewSourceFor } from "./attachmentPreview";

describe("previewSourceFor", () => {
  it("a single library document opens the DocItem itself (durable redaction)", () => {
    expect(previewSourceFor({ name: "a.pdf", text: "x", docIds: ["d1"] })).toEqual({
      kind: "library",
      docId: "d1",
    });
  });

  it("a fresh upload is ad-hoc and carries its bytes and mime", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(
      previewSourceFor({ name: "u.pdf", text: "hello", mime: "application/pdf", bytes }),
    ).toEqual({
      kind: "adhoc",
      filename: "u.pdf",
      mime: "application/pdf",
      text: "hello",
      bytes,
      redactTerms: [],
    });
  });

  it("a combined multi-document attachment is ad-hoc even when every part is a library doc", () => {
    const src = previewSourceFor({
      name: "3 documents",
      text: "=== a ===",
      combined: true,
      docIds: ["d1", "d2", "d3"],
    });
    expect(src.kind).toBe("adhoc");
  });

  it("a Paperless pull is ad-hoc (never stored in QUON) and keeps its per-send terms", () => {
    const src = previewSourceFor({
      name: "invoice.pdf",
      text: "t",
      source: "paperless",
      redactTerms: ["ACME"],
    });
    expect(src).toMatchObject({ kind: "adhoc", redactTerms: ["ACME"], mime: "text/plain" });
  });
});

describe("keepUploadBytes", () => {
  it("keeps the bytes the viewer renders from, not text/markdown", () => {
    expect(keepUploadBytes("application/pdf", "a.pdf", 1000)).toBe(true);
    expect(keepUploadBytes("text/plain", "a.txt", 1000)).toBe(false);
    expect(keepUploadBytes("text/markdown", "a.md", 1000)).toBe(false);
  });
});

describe("mergeRedactTerms", () => {
  it("unions case-insensitively, trims, drops empties, keeps first spelling and order", () => {
    expect(mergeRedactTerms(["Alpha", " beta "], ["alpha", "", "Gamma", "BETA"])).toEqual([
      "Alpha",
      "beta",
      "Gamma",
    ]);
  });

  it("with nothing to merge returns an empty list", () => {
    expect(mergeRedactTerms([], [])).toEqual([]);
  });
});
