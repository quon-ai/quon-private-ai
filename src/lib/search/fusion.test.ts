import { describe, expect, it } from "vitest";

import { RRF_K, rrfFuse } from "./fusion";

const rank = (items: string[]) => items.map((item) => ({ item }));
const id = (s: string) => s;

describe("rrfFuse", () => {
  it("an item ranked #1 in every ranking wins", () => {
    const out = rrfFuse([rank(["a", "b", "c"]), rank(["a", "c", "b"])], id);
    expect(out[0]).toBe("a");
  });

  it("an item present in only ONE ranking still surfaces — the hybrid-retrieval guarantee", () => {
    // This is the mechanism the income-bug fix relies on: an item the vector
    // ranking places far down (or not at all) can still enter via a strong
    // lexical-only ranking.
    const vectorRanking = rank(["x", "y", "z"]); // "einkommen-note" absent — poor cosine
    const lexicalRanking = rank(["einkommen-note"]); // top of the lexical ranking
    const out = rrfFuse([vectorRanking, lexicalRanking], id);
    expect(out).toContain("einkommen-note");
  });

  it("combines ranks additively — an item ranked well in BOTH beats one ranked #1 in only one", () => {
    const out = rrfFuse(
      [
        rank(["solo", "both"]), // "both" is #2 here
        rank(["both", "other"]), // "both" is #1 here
      ],
      id,
    );
    // "both": 1/(k+2) + 1/(k+1); "solo": 1/(k+1) + 0
    const bothScore = 1 / (RRF_K + 2) + 1 / (RRF_K + 1);
    const soloScore = 1 / (RRF_K + 1);
    expect(bothScore).toBeGreaterThan(soloScore);
    expect(out[0]).toBe("both");
  });

  it("deduplicates by identity across rankings", () => {
    const out = rrfFuse([rank(["a", "b"]), rank(["a", "b"])], id);
    expect(out).toHaveLength(2);
  });

  it("returns [] for empty rankings", () => {
    expect(rrfFuse([], id)).toEqual([]);
    expect(rrfFuse([[], []], id)).toEqual([]);
  });
});
