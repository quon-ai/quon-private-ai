import { describe, expect, it } from "vitest";

import { cosine, topK, topKMulti } from "./vector";

describe("cosine", () => {
  it("is 1 for identical direction, 0 for orthogonal", () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1); // same direction, different magnitude
  });

  it("returns 0 for mismatched length, empty, or zero vectors", () => {
    expect(cosine([1, 2], [1, 2, 3])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("topK", () => {
  const items = [
    { id: "a", v: [1, 0] },
    { id: "b", v: [0.9, 0.1] },
    { id: "c", v: [0, 1] },
    { id: "missing", v: undefined },
    { id: "wrongdim", v: [1, 0, 0] },
  ];
  const embOf = (i: (typeof items)[number]) => i.v;

  it("ranks by similarity, descending, and respects k", () => {
    const ranked = topK([1, 0], items, embOf, 2);
    expect(ranked.map((r) => r.item.id)).toEqual(["a", "b"]);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it("skips items with missing or mismatched-length embeddings", () => {
    const ranked = topK([1, 0], items, embOf, 10);
    const ids = ranked.map((r) => r.item.id);
    expect(ids).not.toContain("missing");
    expect(ids).not.toContain("wrongdim");
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("topKMulti (max-pool over query clauses)", () => {
  const embOf = (i: { v?: number[] }) => i.v;

  it("scores each item by its best-matching query vector", () => {
    const items = [{ id: "x", v: [1, 0] }];
    // One probe matches x, the other is orthogonal — the match should win.
    const ranked = topKMulti(
      [
        [0, 1],
        [1, 0],
      ],
      items,
      embOf,
      1,
    );
    expect(ranked[0].score).toBeCloseTo(1);
  });

  it("recovers a focused clause that the diluted whole-message buries", () => {
    // Memory points along [1,0]. The full message is the average of the on-topic
    // clause [1,0] and an off-topic clause [0,1] → [0.71,0.71] (cos ≈ 0.71).
    const memory = [{ id: "m", v: [1, 0] }];
    const full = [Math.SQRT1_2, Math.SQRT1_2];
    const clauseOn = [1, 0];
    const clauseOff = [0, 1];

    const diluted = topK(full, memory, embOf, 1)[0].score;
    const pooled = topKMulti([full, clauseOn, clauseOff], memory, embOf, 1)[0].score;

    expect(diluted).toBeCloseTo(Math.SQRT1_2); // ~0.71, dragged down by filler
    expect(pooled).toBeCloseTo(1); // the on-topic clause is recovered
    expect(pooled).toBeGreaterThan(diluted);
  });

  it("does not invent matches — unrelated clauses stay low", () => {
    const memory = [{ id: "m", v: [1, 0] }];
    // All probes are orthogonal-ish to the memory → best stays near 0.
    const pooled = topKMulti(
      [
        [0, 1],
        [0, 1],
      ],
      memory,
      embOf,
      1,
    )[0].score;
    expect(pooled).toBeCloseTo(0);
  });
});
