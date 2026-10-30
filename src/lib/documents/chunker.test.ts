import { describe, expect, it } from "vitest";

import { chunkText } from "./chunker";

const MAX = 512;
const OVERLAP = 64;
// A chunk may carry the previous chunk's overlap tail + a separator on top of a
// full max-size segment: maxChars + overlap + 1.
const HARD_LIMIT = MAX + OVERLAP + 1;

describe("chunkText", () => {
  it("returns [] for empty / whitespace input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t  ")).toEqual([]);
  });

  it("keeps small text as a single chunk with index 0", () => {
    const chunks = chunkText("Just a short note.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ text: "Just a short note.", index: 0 });
  });

  it("bounds chunk size even with NO sentence/paragraph breaks (the OOM regression)", () => {
    // A table/data dump: one long run with no '.', '!', '?', or blank lines.
    const noBreaks = "col1\tval1 ".repeat(2000); // ~18k chars, single 'paragraph'
    const chunks = chunkText(noBreaks);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(HARD_LIMIT);
  });

  it("bounds chunk size for normal prose and a table-like run", () => {
    for (const input of [
      "This is a sentence. ".repeat(300),
      Array.from({ length: 500 }, (_, i) => `R${i} A B C D E F`).join("  "),
    ]) {
      const chunks = chunkText(input);
      expect(chunks.length).toBeGreaterThan(0);
      for (const c of chunks) {
        expect(c.text.length).toBeLessThanOrEqual(HARD_LIMIT);
        expect(c.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("assigns sequential indices and preserves all the content", () => {
    const chunks = chunkText("Alpha bravo charlie. ".repeat(200));
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    // Every word survives somewhere (overlap may duplicate, never drop).
    const joined = chunks.map((c) => c.text).join(" ");
    expect(joined).toContain("Alpha");
    expect(joined).toContain("charlie");
  });

  it("respects a custom maxChars", () => {
    const chunks = chunkText("word ".repeat(400), 100, 0);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
  });
});
