/**
 * Gating logic for the local originals cache: which files get their bytes kept
 * for the viewer's layout mode (renderable type + non-empty + under the cap).
 * The IndexedDB round-trip itself is browser-only and fail-soft (idbStore).
 */
import { describe, expect, it } from "vitest";

import {
  MAX_ORIGINAL_BYTES,
  originalKind,
  saveOriginal,
  shouldStoreOriginal,
} from "./originalStore";

describe("originalKind", () => {
  it("detects PDF by extension or mime", () => {
    expect(originalKind("application/pdf", "report.PDF")).toBe("pdf");
    expect(originalKind("application/pdf", "noext")).toBe("pdf");
    expect(originalKind("", "scan.pdf")).toBe("pdf");
  });

  it("detects DOCX by extension or mime", () => {
    expect(originalKind("", "Letter.DOCX")).toBe("docx");
    expect(
      originalKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "noext",
      ),
    ).toBe("docx");
  });

  it("detects HTML by extension or mime (rendered via the sanitizer)", () => {
    expect(originalKind("text/html", "noext")).toBe("html");
    expect(originalKind("", "Page.HTML")).toBe("html");
    expect(originalKind("", "page.htm")).toBe("html");
    expect(originalKind("application/xhtml+xml", "page.xhtml")).toBe("html");
  });

  it("detects Markdown by extension or mime (rendered from extracted text)", () => {
    expect(originalKind("text/markdown", "noext")).toBe("md");
    expect(originalKind("", "README.md")).toBe("md");
    expect(originalKind("", "notes.markdown")).toBe("md");
  });

  it("detects photos (OCR scans) by extension or mime", () => {
    expect(originalKind("image/jpeg", "noext")).toBe("image");
    expect(originalKind("", "scan.JPG")).toBe("image");
    expect(originalKind("", "photo.jpeg")).toBe("image");
    expect(originalKind("image/png", "shot.png")).toBe("image");
    expect(originalKind("image/heic", "IMG_0001.HEIC")).toBe("image");
    expect(originalKind("image/webp", "pic.webp")).toBe("image");
  });

  it("has no layout view for plain-text formats (extracted text is the original)", () => {
    expect(originalKind("text/plain", "notes.txt")).toBeNull();
    expect(originalKind("application/json", "data.json")).toBeNull();
    expect(originalKind("text/csv", "table.csv")).toBeNull();
    expect(originalKind("text/xml", "feed.xml")).toBeNull();
  });
});

describe("shouldStoreOriginal", () => {
  it("accepts a renderable file under the cap", () => {
    expect(shouldStoreOriginal("application/pdf", "a.pdf", 5 * 1024 * 1024)).toBe(true);
    expect(shouldStoreOriginal("", "b.docx", 1024)).toBe(true);
    expect(shouldStoreOriginal("text/html", "page.html", 1024)).toBe(true);
  });

  it("keeps no bytes for markdown: its rendered view works from extracted text", () => {
    expect(shouldStoreOriginal("text/markdown", "readme.md", 1024)).toBe(false);
  });

  it("keeps photo bytes: for OCR scans the photo is the source of truth", () => {
    expect(shouldStoreOriginal("image/jpeg", "scan.jpg", 3 * 1024 * 1024)).toBe(true);
    expect(shouldStoreOriginal("image/png", "brief.png", 1024)).toBe(true);
  });

  it("skips files over the cap (graceful fallback to text view)", () => {
    expect(shouldStoreOriginal("application/pdf", "big.pdf", MAX_ORIGINAL_BYTES + 1)).toBe(false);
    expect(shouldStoreOriginal("application/pdf", "edge.pdf", MAX_ORIGINAL_BYTES)).toBe(true);
  });

  it("skips empty files and non-renderable types", () => {
    expect(shouldStoreOriginal("application/pdf", "empty.pdf", 0)).toBe(false);
    expect(shouldStoreOriginal("text/plain", "notes.txt", 1024)).toBe(false);
  });
});

describe("saveOriginal result (drives the too-big surfacing at ingest)", () => {
  // File-like stubs: saveOriginal reads type/name/size before touching bytes,
  // so the over-cap and skip paths never call arrayBuffer.
  const fileLike = (name: string, type: string, size: number) =>
    ({ name, type, size }) as unknown as File;

  it("reports 'toobig' for an over-cap renderable file", async () => {
    expect(
      await saveOriginal("d1", fileLike("big.pdf", "application/pdf", MAX_ORIGINAL_BYTES + 1)),
    ).toBe("toobig");
  });

  it("reports 'skipped' (silently) for non-renderable or empty files", async () => {
    expect(await saveOriginal("d2", fileLike("notes.txt", "text/plain", 1024))).toBe("skipped");
    expect(await saveOriginal("d3", fileLike("empty.pdf", "application/pdf", 0))).toBe("skipped");
    expect(await saveOriginal("d4", fileLike("readme.md", "text/markdown", 1024))).toBe("skipped");
  });
});
