import { describe, expect, it, vi } from "vitest";

// extract.ts drags in pdf.js + mammoth at module scope (browser-only APIs);
// the pure helpers under test don't need either.
vi.mock("./pdfjs", () => ({ pdfjs: {} }));
vi.mock("mammoth", () => ({ default: {} }));

import { MAX_OCR_PAGES, noTextReason, pageNeedsOcr } from "./extract";

describe("pageNeedsOcr (scanned-page heuristic)", () => {
  it("flags an empty or whitespace-only text layer", () => {
    expect(pageNeedsOcr("")).toBe(true);
    expect(pageNeedsOcr("   \n\t  ")).toBe(true);
  });

  it("flags residue like page numbers / stamps (< 30 non-ws chars)", () => {
    expect(pageNeedsOcr("Seite 3 von 12")).toBe(true);
    expect(pageNeedsOcr("- 4 -")).toBe(true);
  });

  it("keeps a real (even terse) text page", () => {
    expect(pageNeedsOcr("Sehr geehrte Damen und Herren, hiermit kündige ich.")).toBe(false);
  });

  it("whitespace does not count toward the threshold", () => {
    // 29 letters padded with lots of whitespace still needs OCR.
    expect(pageNeedsOcr("a ".repeat(29))).toBe(true);
  });
});

it("OCR page cap is bounded (guards against tab-stalling giant scans)", () => {
  expect(MAX_OCR_PAGES).toBeGreaterThan(0);
  expect(MAX_OCR_PAGES).toBeLessThanOrEqual(100);
});

describe("noTextReason (scanned-PDF diagnostics)", () => {
  it("reports an engine-start failure when OCR threw on a scanned PDF", () => {
    expect(noTextReason({ scannedPages: 3, ocrPages: 0, ocrError: "fetch failed" })).toMatch(
      /couldn't start.*fetch failed/,
    );
  });
  it("reports an empty OCR read when the engine ran but found nothing", () => {
    expect(noTextReason({ scannedPages: 3, ocrPages: 0 })).toMatch(/found no readable text/);
  });
  it("falls back to the generic message for a non-scan empty file", () => {
    expect(noTextReason({ scannedPages: 0 })).toBe("No extractable text in this file");
  });
});
