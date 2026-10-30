import { describe, expect, it } from "vitest";

import {
  ABS_FLOOR,
  capPreservingRelevance,
  NO_ANCHOR_SIM_FLOOR,
  RECENCY_WINDOW_MS,
  STRICT_SIM_FLOOR,
  queryTermSet,
  rerankAndGate,
} from "./rerank";

const hit = (item: string, score: number) => ({ item, score });
const id = (s: string) => s;

describe("rerankAndGate", () => {
  it("drops a no-keyword item far below the top (the finance false-positive)", () => {
    const q = queryTermSet("ab wann omnio biotic");
    const out = rerankAndGate(
      [
        hit("Ich nehme Omni Biotic zur Darmsanierung", 0.43),
        hit("Mein Gehalt und Sparkonto bei der Sparkasse", 0.27),
      ],
      q,
      id,
      3,
    );
    expect(out).toHaveLength(1);
    expect(out[0].item).toContain("Omni Biotic");
  });

  it("injects nothing when nothing is strongly relevant", () => {
    const q = queryTermSet("ab wann omnio biotic");
    const out = rerankAndGate(
      [hit("Mein Gehalt und Sparkonto", 0.27), hit("Vorschlag kleines Auto Mutter", 0.24)],
      q,
      id,
      3,
    );
    expect(out).toEqual([]);
  });

  it("lexical boost rescues a strong keyword match with middling cosine", () => {
    const q = queryTermSet("omnio biotic darm");
    // cosine 0.30 alone is below the floor; full keyword coverage lifts it over.
    const out = rerankAndGate([hit("biotic darm probiotikum", 0.3)], q, id, 3);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBeGreaterThanOrEqual(ABS_FLOOR);
  });

  // Regression: the Talbach false positive. A travel query pulled 3 microbiome
  // chunks at blended ~0.40 — same-language (German↔German) cosine inflation
  // with ZERO keyword overlap. Un-anchored mid-cosine hits must be dropped.
  it("drops zero-overlap candidates at ~0.40 cosine (same-language noise)", () => {
    const q = queryTermSet("was kann man in talbach mit einem kind machen");
    const out = rerankAndGate(
      [
        hit("Ferritin 27 µg/l Referenz aufbauen Bakterien", 0.41),
        hit("Faecalibacterium prausnitzii 9,958% Butyratbildner", 0.4),
        hit("Sekretorisches IgA im Stuhl: 406,6 µg/ml", 0.4),
      ],
      q,
      id,
      3,
    );
    expect(out).toEqual([]);
  });

  it("keeps a mid-cosine candidate that shares a query keyword", () => {
    const q = queryTermSet("was sagt mein befund zu ferritin");
    const out = rerankAndGate([hit("Ferritin 27 µg/l Referenz", 0.38)], q, id, 3);
    expect(out).toHaveLength(1);
  });

  it("keeps a zero-overlap candidate with genuinely high cosine (paraphrase/cross-language)", () => {
    // e.g. German query vs an English memory: no shared tokens, but a true
    // semantic match scores well above NO_ANCHOR_SIM_FLOOR.
    const q = queryTermSet("wo wohne ich");
    const out = rerankAndGate(
      [hit("My home address is in Berlin", NO_ANCHOR_SIM_FLOOR + 0.05)],
      q,
      id,
      3,
    );
    expect(out).toHaveLength(1);
  });

  it("an un-anchored noise hit must not set the relative bar for anchored hits", () => {
    // Noise at 0.48 (dropped by the anchor rule) must not push the floor above
    // an anchored 0.36 real hit via the REL_MARGIN mechanism.
    const q = queryTermSet("ferritin einnahme");
    const out = rerankAndGate(
      [hit("Völlig anderes Thema ohne Überlappung", 0.48), hit("Ferritin morgens nüchtern", 0.36)],
      q,
      id,
      3,
    );
    expect(out.map((r) => r.item)).toEqual(["Ferritin morgens nüchtern"]);
  });

  describe("strict candidates (long notes via strictOf)", () => {
    const strictAll = () => true;

    it("requires BOTH an anchor and cosine ≥ STRICT_SIM_FLOOR", () => {
      const q = queryTermSet("ferritin befund");
      // Anchored but below the strict cosine floor → out.
      expect(
        rerankAndGate(
          [hit("Ferritin Referenz", STRICT_SIM_FLOOR - 0.05)],
          q,
          id,
          3,
          undefined,
          strictAll,
        ),
      ).toEqual([]);
      // High cosine but no anchor → out.
      expect(
        rerankAndGate(
          [hit("ganz anderes thema", NO_ANCHOR_SIM_FLOOR + 0.1)],
          q,
          id,
          3,
          undefined,
          strictAll,
        ),
      ).toEqual([]);
      // Anchor + high cosine → in.
      expect(
        rerankAndGate(
          [hit("Ferritin Referenz", STRICT_SIM_FLOOR + 0.05)],
          q,
          id,
          3,
          undefined,
          strictAll,
        ),
      ).toHaveLength(1);
    });

    it("normal candidates are unaffected by strictOf marking others", () => {
      const q = queryTermSet("ferritin befund");
      // Both anchored at the same sub-strict cosine: the strict candidate is
      // dropped (base < STRICT_SIM_FLOOR), the normal one passes the blended gate.
      const base = STRICT_SIM_FLOOR - 0.05;
      const out = rerankAndGate(
        [hit("note: Ferritin lang", base), hit("fact: Ferritin kurz", base)],
        q,
        id,
        3,
        undefined,
        (s) => s.startsWith("note:"),
      );
      expect(out.map((r) => r.item)).toEqual(["fact: Ferritin kurz"]);
    });
  });

  it("returns [] for no hits and respects finalK", () => {
    expect(rerankAndGate([], queryTermSet("x"), id, 3)).toEqual([]);
    const q = queryTermSet("darm biotic");
    const many = [
      hit("darm biotic a", 0.6),
      hit("darm biotic b", 0.59),
      hit("darm biotic c", 0.58),
      hit("darm biotic d", 0.57),
    ];
    expect(rerankAndGate(many, q, id, 2)).toHaveLength(2);
  });
});

describe("rerankAndGate — pinned bypass (opt-in via pinnedOf)", () => {
  const pinnedFlag = (item: { pinned?: boolean }) => !!item.pinned;

  it("without pinnedOf, behaviour is byte-identical to before (default undefined)", () => {
    const q = queryTermSet("darm biotic");
    const hits = [hit("darm biotic a", 0.6), hit("darm biotic b", 0.59)];
    expect(rerankAndGate(hits, q, id, 3)).toEqual(
      rerankAndGate(hits, q, id, 3, undefined, undefined),
    );
  });

  it("a pinned candidate is included even with a query that shares zero keywords and low cosine", () => {
    const q = queryTermSet("wie wird das wetter morgen");
    const items = [
      { text: "Notfallkontakt: Nadine, +49 176 12345678", pinned: true },
      { text: "Völlig anderes irrelevantes Thema", pinned: false },
    ];
    // Both scored far below every floor — only the pinned one should survive.
    const hits = items.map((it) => ({ item: it, score: 0.05 }));
    const out = rerankAndGate(hits, q, (it) => it.text, 3, undefined, undefined, pinnedFlag);
    expect(out).toHaveLength(1);
    expect(out[0].item.text).toContain("Notfallkontakt");
  });

  it("a pinned candidate's own (low or high) score never moves top/floor for non-pinned candidates", () => {
    const q = queryTermSet("ferritin befund");
    const items = [
      { text: "pinned unrelated", pinned: true },
      { text: "Ferritin spp. Referenz", pinned: false }, // anchored, real hit
    ];
    const hits = [
      { item: items[0], score: 0.99 }, // would otherwise inflate `top` and tighten the floor
      { item: items[1], score: 0.32 }, // qualifies on its own via the anchor + ABS_FLOOR
    ];
    const out = rerankAndGate(hits, q, (it) => it.text, 3, undefined, undefined, pinnedFlag);
    expect(out.map((r) => r.item.text)).toEqual(
      expect.arrayContaining(["pinned unrelated", "Ferritin spp. Referenz"]),
    );
  });

  it("pinned candidates are placed ahead of relevance-ranked ones so finalK can't crowd them out", () => {
    const q = queryTermSet("darm biotic sanierung");
    const items = [
      { text: "darm biotic sanierung eins", pinned: false },
      { text: "darm biotic sanierung zwei", pinned: false },
      { text: "darm biotic sanierung drei", pinned: false },
      { text: "pinned fact, zero overlap otherwise", pinned: true },
    ];
    const hits = [
      { item: items[0], score: 0.6 },
      { item: items[1], score: 0.59 },
      { item: items[2], score: 0.58 },
      { item: items[3], score: 0.01 },
    ];
    // finalK smaller than the total qualified count: without the pinned
    // priority, the 3 highly-relevant hits would fill every slot.
    const out = rerankAndGate(hits, q, (it) => it.text, 2, undefined, undefined, pinnedFlag);
    expect(out.map((r) => r.item.pinned)).toContain(true);
  });

  it("P5 crowd-out fix: ≥3 pinned items no longer block ALL relevance retrieval (finalK=3)", () => {
    // The reproduced bug: [...pinned, ...rest].slice(0, finalK) with 3 pinned
    // items and finalK=3 (the real MEMORY_K) left ZERO room for a genuinely
    // relevant, non-pinned hit — pinning a 3rd fact silently disabled ALL
    // topical retrieval forever.
    const q = queryTermSet("ferritin befund");
    const items = [
      { text: "pinned one", pinned: true },
      { text: "pinned two", pinned: true },
      { text: "pinned three", pinned: true },
      { text: "Ferritin spp. Referenz relevant hit", pinned: false },
    ];
    const hits = [
      { item: items[0], score: 0.01 },
      { item: items[1], score: 0.01 },
      { item: items[2], score: 0.01 },
      { item: items[3], score: 0.4 }, // anchored, clears every floor on its own
    ];
    const out = rerankAndGate(hits, q, (it) => it.text, 3, undefined, undefined, pinnedFlag);
    expect(out.map((r) => r.item.text)).toContain("Ferritin spp. Referenz relevant hit");
    // Still room for 2 of the 3 pinned facts (finalK - 1).
    expect(out.filter((r) => r.item.pinned)).toHaveLength(2);
  });

  it("pinned bypasses the strict tier too (a fact marked pinned AND strict still gets in)", () => {
    const q = queryTermSet("völlig andere frage");
    const item = { text: "pinned strict item, no anchor at all", pinned: true, strict: true };
    const out = rerankAndGate(
      [{ item, score: 0.02 }],
      q,
      (it) => it.text,
      3,
      undefined,
      (it) => it.strict,
      pinnedFlag,
    );
    expect(out).toHaveLength(1);
  });
});

describe("capPreservingRelevance (shared crowd-out guard, re-applied by rag.ts's final cap)", () => {
  const pinnedFlag = (item: { pinned?: boolean }) => !!item.pinned;

  it("reserves at least one slot for a relevance survivor even when pinned fills the rest", () => {
    const sorted = [
      { item: { text: "p1", pinned: true }, score: 0.9 },
      { item: { text: "p2", pinned: true }, score: 0.9 },
      { item: { text: "p3", pinned: true }, score: 0.9 },
      { item: { text: "relevant", pinned: false }, score: 0.5 },
    ];
    const out = capPreservingRelevance(sorted, 3, pinnedFlag);
    expect(out.map((r) => r.item.text)).toContain("relevant");
    expect(out).toHaveLength(3);
  });

  it("pinned fills every slot when there are NO non-pinned survivors", () => {
    const sorted = [
      { item: { text: "p1", pinned: true }, score: 0.9 },
      { item: { text: "p2", pinned: true }, score: 0.9 },
    ];
    const out = capPreservingRelevance(sorted, 3, pinnedFlag);
    expect(out).toHaveLength(2);
  });
});

describe("rerankAndGate — recency bonus (opt-in via recencyOf)", () => {
  const now = Date.now();
  const daysAgo = (n: number) => now - n * 24 * 60 * 60 * 1000;

  it("without recencyOf, scores/order are byte-identical to the no-recency path (document search)", () => {
    const q = queryTermSet("darm biotic");
    const hits = [hit("darm biotic a", 0.6), hit("darm biotic b", 0.59)];
    const withoutRecency = rerankAndGate(hits, q, id, 3);
    // Passing undefined explicitly (a caller that never opts in) must behave the same.
    expect(rerankAndGate(hits, q, id, 3, undefined)).toEqual(withoutRecency);
    // 0.6/0.59 base cosine + LEX_BOOST(0.2) full keyword coverage on both.
    expect(withoutRecency.map((r) => r.score)).toEqual([0.8, 0.79]);
  });

  it("a fresh item beats an equal-similarity stale item once qualified", () => {
    const q = queryTermSet("omnio biotic");
    const items = [
      { key: "stale", text: "biotic omnio note", updatedAt: daysAgo(180) },
      { key: "fresh", text: "biotic omnio note", updatedAt: daysAgo(0) },
    ];
    const hits = items.map((it) => ({ item: it, score: 0.35 })); // identical cosine, above floor
    const out = rerankAndGate(
      hits,
      q,
      (it) => it.text,
      3,
      (it) => it.updatedAt,
    );
    expect(out.map((r) => r.item.key)).toEqual(["fresh", "stale"]);
    expect(out[0].score).toBeGreaterThan(out[1].score);
  });

  it("a sub-floor item stays out regardless of freshness, even one recency alone would cross", () => {
    // Score is JUST under ABS_FLOOR — if recency were (wrongly) applied before the
    // floor check, a same-day item would gain the full +0.05 bonus and clear it.
    // The floor must be evaluated on cosine+lexical only, so this must still be excluded.
    const q = queryTermSet("x");
    const items = [
      { key: "sub-floor-fresh", updatedAt: daysAgo(0) },
      { key: "above-floor", updatedAt: daysAgo(180) },
    ];
    const hits = [
      { item: items[0], score: ABS_FLOOR - 0.01 },
      { item: items[1], score: ABS_FLOOR + 0.05 },
    ];
    const out = rerankAndGate(
      hits,
      q,
      () => "",
      3,
      (it) => it.updatedAt,
    );
    expect(out.map((r) => r.item.key)).toEqual(["above-floor"]);
  });

  it("recency bonus decays linearly to 0 at RECENCY_WINDOW_MS and beyond", () => {
    const q = queryTermSet("x");
    const items = [
      { key: "at-window", updatedAt: now - RECENCY_WINDOW_MS },
      { key: "beyond-window", updatedAt: now - RECENCY_WINDOW_MS * 2 },
    ];
    const hits = items.map((it) => ({ item: it, score: ABS_FLOOR }));
    const out = rerankAndGate(
      hits,
      q,
      () => "",
      3,
      (it) => it.updatedAt,
    );
    // Both at/beyond the window get zero bonus — scores stay at the floor, tied.
    expect(out.map((r) => r.score)).toEqual([ABS_FLOOR, ABS_FLOOR]);
  });
});
