import { describe, expect, it } from "vitest";

import { isUploadCandidate } from "./originalSync";
import type { DocItem } from "@/lib/documentStore";

/**
 * Regression for the connector-original cross-device-sync bug: uploadOriginal
 * (and the rescan) early-returned on `doc.source`, so a Dropbox/folder import
 * kept its original bytes locally but NEVER uploaded → the layout view was
 * missing on every OTHER device. The originals-roundtrip e2e only ever covered
 * a MANUAL upload (source absent), so the sourced branch was never exercised.
 * This asserts the fix directly: a source must NOT block the upload.
 */
function doc(over: Partial<DocItem>): DocItem {
  return {
    id: "d1",
    filename: "vertrag.pdf",
    mime: "application/pdf",
    status: "ready",
    chunks: [],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  } as DocItem;
}

describe("isUploadCandidate", () => {
  it("uploads a CONNECTOR-imported doc (a source must not block it) — the bug", () => {
    expect(isUploadCandidate(doc({ source: { connector: "dropbox", ref: "/a.pdf" } }))).toBe(true);
  });

  it("uploads a manual upload too", () => {
    expect(isUploadCandidate(doc({}))).toBe(true);
  });

  it("skips not-ready, already-uploaded, or missing docs", () => {
    expect(isUploadCandidate(doc({ status: "processing" }))).toBe(false);
    expect(isUploadCandidate(doc({ status: "failed" }))).toBe(false);
    expect(isUploadCandidate(doc({ original: { size: 10, chunkCount: 1 } }))).toBe(false);
    expect(isUploadCandidate(undefined)).toBe(false);
  });
});
