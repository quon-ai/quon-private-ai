import { describe, expect, it } from "vitest";
import { combineDocuments } from "./attachAll";

describe("combineDocuments", () => {
  it("keeps all documents in full when they fit the budget", () => {
    const { text, truncated } = combineDocuments(
      [
        { name: "a.pdf", text: "Angebot A: 12000 EUR" },
        { name: "b.pdf", text: "Angebot B: 11500 EUR" },
      ],
      50000,
    );
    expect(truncated).toBe(false);
    expect(text).toContain("=== Document: a.pdf ===\nAngebot A: 12000 EUR");
    expect(text).toContain("=== Document: b.pdf ===\nAngebot B: 11500 EUR");
  });

  it("short docs keep their full text; surplus goes to the long ones", () => {
    const short = "kurz";
    const long = "x".repeat(10000);
    const budget = 1000;
    const { text, truncated } = combineDocuments(
      [
        { name: "long.pdf", text: long },
        { name: "short.md", text: short },
      ],
      budget,
    );
    expect(truncated).toBe(true);
    expect(text).toContain(`=== Document: short.md ===\n${short}`);
    // the long doc got everything the short one didn't need
    const longBody = text.split("=== Document: long.pdf ===\n")[1].split("\n\n")[0];
    expect(longBody.length).toBeGreaterThan(budget / 2 - 100);
    expect(text.length).toBeLessThanOrEqual(budget);
  });

  it("never exceeds the budget", () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({
      name: `doc${i}.pdf`,
      text: "y".repeat(20000),
    }));
    const { text, truncated } = combineDocuments(docs, 50000);
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(50000);
    // every doc is still represented
    for (let i = 0; i < 5; i++) expect(text).toContain(`=== Document: doc${i}.pdf ===`);
  });

  it("skips empty documents and handles the empty list", () => {
    expect(combineDocuments([], 1000)).toEqual({ text: "", truncated: false });
    const { text } = combineDocuments(
      [
        { name: "empty.txt", text: "   " },
        { name: "real.txt", text: "content" },
      ],
      1000,
    );
    expect(text).not.toContain("empty.txt");
    expect(text).toContain("real.txt");
  });
});
