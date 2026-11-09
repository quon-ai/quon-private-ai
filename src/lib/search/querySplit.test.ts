import { describe, expect, it } from "vitest";

import { splitQuery } from "./querySplit";

describe("splitQuery", () => {
  it("returns the full message first, then its clauses", () => {
    const out = splitQuery("Weißt du wo ich lebe und hast du das berücksichtigt?");
    expect(out[0]).toBe("Weißt du wo ich lebe und hast du das berücksichtigt?");
    // The focused clause is isolated so it can match on its own.
    expect(out).toContain("Weißt du wo ich lebe");
    expect(out.some((p) => /berücksichtigt/i.test(p))).toBe(true);
  });

  it("splits on commas, sentence terminators, and conjunctions (DE + EN)", () => {
    expect(splitQuery("Wo wohne ich, und magst du Pizza?")).toEqual(
      expect.arrayContaining(["Wo wohne ich", "magst du Pizza"]),
    );
    expect(splitQuery("Where do I live? Also, what time is it?")).toEqual(
      expect.arrayContaining(["Where do I live", "what time is it"]),
    );
  });

  it("does not split inside words that merely contain a conjunction", () => {
    // "gesund"/"rundum" contain "und" but aren't whitespace-flanked.
    const out = splitQuery("Ich bin gesund und rundum zufrieden");
    expect(out).toContain("Ich bin gesund");
    expect(out).toContain("rundum zufrieden");
    expect(out).not.toContain("ges"); // no mid-word split
  });

  it("drops pure-stopword fragments and de-duplicates", () => {
    const out = splitQuery("und und, Hallo");
    // "und"/"und" carry no topical signal -> only the full string + "Hallo".
    expect(out).toContain("Hallo");
    expect(out.filter((p) => p === "und")).toHaveLength(0);
    // No duplicates.
    expect(new Set(out).size).toBe(out.length);
  });

  it("caps the number of probes", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Thema${i}`).join(", ");
    expect(splitQuery(long).length).toBeLessThanOrEqual(8);
  });

  it("returns [] for empty/whitespace input", () => {
    expect(splitQuery("")).toEqual([]);
    expect(splitQuery("   ")).toEqual([]);
  });
});
