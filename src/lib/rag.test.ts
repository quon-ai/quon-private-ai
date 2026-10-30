import { beforeEach, describe, expect, it, vi } from "vitest";

// The embedder is a browser Web Worker — replace it with a deterministic stub so
// retrieveContext's vector step is controllable in tests (see below).
vi.mock("./embedding/embedder", () => ({
  EMBED_MODEL: "test-embed",
  EMBED_DIM: 3,
  embedText: vi.fn(async () => [1, 0, 0]),
  embedBatch: vi.fn(async () => [[1, 0, 0]]),
  isEmbedderReady: () => true,
  isEmbedderLoading: () => false,
  onEmbedderReady: () => () => {},
  warmEmbedder: () => {},
}));

import { EMBED_MODEL, embedBatch } from "./embedding/embedder";
import {
  dedupeByItem,
  hasRetrievableContext,
  hasScopedContext,
  inScope,
  memoryChunksInScope,
  retrieveContext,
} from "./rag";
import { getMemoryItem, resetMemory, upsertMemoryItem } from "./memoryStore";

beforeEach(() => {
  vi.mocked(embedBatch).mockClear();
});

describe("inScope (RAG project scoping)", () => {
  it("a global scope matches only items with no project", () => {
    const ok = inScope(undefined);
    expect(ok({})).toBe(true);
    expect(ok({ projectId: undefined })).toBe(true);
    expect(ok({ projectId: "p1" })).toBe(false);
  });

  it("a project scope matches only that project's items", () => {
    const ok = inScope("p1");
    expect(ok({ projectId: "p1" })).toBe(true);
    expect(ok({ projectId: "p2" })).toBe(false);
    expect(ok({})).toBe(false);
    expect(ok({ projectId: undefined })).toBe(false);
  });

  it("never mixes scopes when filtering a mixed set", () => {
    const items = [{ projectId: "p1" }, { projectId: "p2" }, {}, { projectId: "p1" }];
    expect(items.filter(inScope("p1"))).toHaveLength(2);
    expect(items.filter(inScope("p2"))).toHaveLength(1);
    expect(items.filter(inScope(undefined))).toHaveLength(1);
  });
});

describe("hasScopedContext (presence gate, embed-agnostic)", () => {
  it("sees an in-scope memory that is not embedded yet — unlike hasRetrievableContext", () => {
    resetMemory();
    upsertMemoryItem({
      id: "m1",
      kind: "note",
      text: "Key Stakeholders (PPOs): Sören and Malte.",
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    }); // no embedding → "not indexed yet"
    // The old gate would skip RAG entirely; the new presence gate runs it (retrieval
    // then embeds on-demand). This is the regression: a fresh memory must not be ignored.
    expect(hasRetrievableContext(undefined)).toBe(false);
    expect(hasScopedContext(undefined)).toBe(true);
  });

  it("respects project scope", () => {
    resetMemory();
    upsertMemoryItem({
      id: "m2",
      kind: "note",
      text: "x",
      tags: [],
      projectId: "p1",
      createdAt: 0,
      updatedAt: 0,
    });
    expect(hasScopedContext("p1")).toBe(true);
    expect(hasScopedContext(undefined)).toBe(false); // a project item is not in the global scope
  });
});

describe("memoryChunksInScope (memory chunking for retrieval)", () => {
  it("ranks over chunks, falls back to whole-item for legacy, skips stale model", () => {
    resetMemory();
    upsertMemoryItem({
      id: "a",
      kind: "fact",
      text: "full A text",
      tags: [],
      embModel: EMBED_MODEL,
      embedding: [1],
      chunks: [
        { text: "chunk a1", embedding: [1] },
        { text: "chunk a2", embedding: [2] },
      ],
      createdAt: 0,
      updatedAt: 0,
    });
    upsertMemoryItem({
      id: "b", // legacy: whole-item embedding, no chunks
      kind: "note",
      text: "whole B",
      tags: [],
      embModel: EMBED_MODEL,
      embedding: [3],
      createdAt: 0,
      updatedAt: 0,
    });
    upsertMemoryItem({
      id: "c", // stale model → excluded
      kind: "note",
      text: "stale C",
      tags: [],
      embModel: "old-model",
      embedding: [4],
      createdAt: 0,
      updatedAt: 0,
    });
    const texts = memoryChunksInScope(undefined).map((r) => r.text);
    expect(texts).toEqual(expect.arrayContaining(["chunk a1", "chunk a2", "whole B"]));
    expect(texts).not.toContain("full A text"); // chunked item exposes chunks, not the whole text
    expect(texts).not.toContain("stale C"); // wrong model → not comparable
  });

  it("respects project scope", () => {
    resetMemory();
    upsertMemoryItem({
      id: "p",
      kind: "note",
      text: "proj",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "proj chunk", embedding: [1] }],
      projectId: "p1",
      createdAt: 0,
      updatedAt: 0,
    });
    expect(memoryChunksInScope("p1").map((r) => r.text)).toContain("proj chunk");
    expect(memoryChunksInScope(undefined)).toHaveLength(0); // project item not in global scope
  });
});

describe("dedupeByItem (one slot per memory item)", () => {
  it("keeps only the best chunk per item, preserving shortlist order", () => {
    const h = (itemId: string, text: string, score: number) => ({ item: { itemId, text }, score });
    // Sorted best-first, as topKMulti returns it. Item "big" has 3 chunks — the
    // observed failure was all MEMORY_K slots filled by one pasted document.
    const out = dedupeByItem([
      h("big", "chunk 1", 0.41),
      h("big", "chunk 2", 0.4),
      h("other", "other chunk", 0.39),
      h("big", "chunk 3", 0.38),
    ]);
    expect(out.map((x) => x.item.text)).toEqual(["chunk 1", "other chunk"]);
  });
});

describe("retrieveContext (anchor rule + strict tier for long content)", () => {
  const vecAt = (cos: number) => [cos, Math.sqrt(1 - cos * cos), 0];

  it("a chunk at mid cosine with no keyword overlap is NOT injected; a fact with overlap is", async () => {
    resetMemory();
    // The Talbach regression: cosine 0.41 vs the query, zero shared tokens.
    upsertMemoryItem({
      id: "labreport",
      kind: "note",
      key: "Gesundheitsinformationen",
      text: "Ferritin 27 µg/l Referenz",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Ferritin 27 µg/l Referenz", embedding: vecAt(0.41) }],
      createdAt: 0,
      updatedAt: 0,
    });
    // Fact with a real keyword anchor at the same cosine — must still surface.
    upsertMemoryItem({
      id: "kidfact",
      kind: "fact",
      key: "Familie",
      text: "Unser Neffe ist 3,5 Jahre alt und liebt Erlebnispfade in Talbach.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [
        {
          text: "Unser Neffe ist 3,5 Jahre alt und liebt Erlebnispfade in Talbach.",
          embedding: vecAt(0.41),
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("was kann man in talbach mit einem kind machen", undefined);
    expect(res.sources.map((s) => s.title)).toEqual(["Familie"]);
    expect(res.text).not.toContain("Ferritin");
  });

  it("a LONG item needs high cosine even WITH a keyword anchor (strict tier)", async () => {
    resetMemory();
    // Item text > FACT_MAX_CHARS → strict tier. Its chunk shares a keyword with
    // the query ("ferritin") and sits at cosine 0.35 — enough for the
    // normal gate (blended clears ABS_FLOOR with the lexical boost), but below
    // STRICT_SIM_FLOOR (0.4) → must NOT be injected.
    const longText = "Ferritin 27 µg/l (Referenz 0,5–5) — Strategie ist Aufbau. ".repeat(6);
    upsertMemoryItem({
      id: "longreport",
      kind: "note",
      key: "Befund",
      text: longText,
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: longText.slice(0, 200), embedding: vecAt(0.35) }],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);
    const below = await retrieveContext("was sagt mein befund zu ferritin", undefined);
    expect(below.sources).toEqual([]);

    // Same item at cosine above the strict floor → injected.
    upsertMemoryItem({
      id: "longreport",
      kind: "note",
      key: "Befund",
      text: longText,
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: longText.slice(0, 200), embedding: vecAt(0.6) }],
      createdAt: 0,
      updatedAt: 0,
    });
    const above = await retrieveContext("was sagt mein befund zu ferritin", undefined);
    expect(above.sources.map((s) => s.title)).toEqual(["Befund"]);
  });

  it("surfaces an item via its anchor-bearing chunk even when another chunk has higher cosine", async () => {
    resetMemory();
    // Found live: the item's best-cosine chunk had NO keyword overlap (dropped
    // by the gate), while its second-best chunk carried the anchor. Deduping
    // before the gate picked the anchor-less chunk and lost the whole item —
    // the dedupe must run on the gated list instead.
    const longText = "x".repeat(400); // strict tier
    upsertMemoryItem({
      id: "labreport",
      kind: "note",
      key: "Gesundheitsinformationen", // no overlap with the query (as in the live case)
      text: longText,
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [
        { text: "VERLAUF: Kontrolle in drei Monaten geplant.", embedding: vecAt(0.55) }, // no anchor
        { text: "Ferritin 27 µg/l Referenz", embedding: vecAt(0.52) }, // anchor
      ],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);
    const res = await retrieveContext("was sagt mein befund zu ferritin", undefined);
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0].snippet).toContain("Ferritin");
  });

  it("one long item cannot fill every context slot with its own chunks", async () => {
    resetMemory();
    const longText = "Ein langer Reisebericht über Talbach und die Umgebung. ".repeat(10);
    upsertMemoryItem({
      id: "travelblog",
      kind: "note",
      key: "Reise",
      text: longText,
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [
        { text: "Talbach Erlebnispfad Bericht Teil 1", embedding: vecAt(0.7) },
        { text: "Talbach Erlebnispfad Bericht Teil 2", embedding: vecAt(0.68) },
        { text: "Talbach Erlebnispfad Bericht Teil 3", embedding: vecAt(0.66) },
      ],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);
    const res = await retrieveContext("was kann man in talbach machen", undefined);
    // Only the best chunk of the item — not three copies of it.
    expect(res.sources).toHaveLength(1);
    expect(res.sources[0].snippet).toContain("Teil 1");
  });
});

describe("retrieveContext (German compound anchoring + hybrid retrieval — the Einkommen bug)", () => {
  const vecAt = (cos: number) => [cos, Math.sqrt(1 - cos * cos), 0];

  it("a long note saying only 'Nettoeinkommen' IS retrieved for a query about 'Einkommen'", async () => {
    resetMemory();
    // Padded well past FACT_MAX_CHARS (300) so this hits the STRICT tier —
    // the actual production shape (a long saved note), not the short-fact
    // tier which would trivially pass via the plain floor. contentTerms only
    // splits on non-letters, so without the subword-anchor fix "einkommen"
    // and "nettoeinkommen" are different tokens and this item has ZERO
    // lexical anchor — gated out regardless of cosine (strict tier requires
    // an anchor, no cosine-only escape hatch). Cosine 0.45 is realistic for
    // this pairing per the browser-embedder calibration in rerank.ts
    // (related same-language ~0.31–0.58) — above STRICT_SIM_FLOOR (0.4) but
    // below NO_ANCHOR_SIM_FLOOR (0.55), so only the anchor rescues it.
    const longText =
      "Nettoeinkommen (beide berufstätig): Timo 95k € Brutto/32h, Nadine 70k € Brutto/32h. " +
      "Weitere Details zur Haushaltsplanung folgen hier, damit der Text lang genug ist, um über " +
      "die Kurzfassungsgrenze für Fakten hinauszugehen und wie eine echte gespeicherte Notiz zu " +
      "wirken, mit noch etwas mehr Kontext zur Budgetplanung der Familie in diesem Jahr.";
    expect(longText.length).toBeGreaterThan(300);
    upsertMemoryItem({
      id: "income",
      kind: "note",
      key: "Finanzen",
      text: longText,
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: longText, embedding: vecAt(0.45) }],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("prüfe wie mein Einkommen ist", undefined);
    expect(res.sources.map((s) => s.title)).toEqual(["Finanzen"]);
    expect(res.text).toContain("Nettoeinkommen");
  });

  it("guard: an UNRELATED long German note is still gated out for the Einkommen query (no false-positive hole)", async () => {
    resetMemory();
    // Same microbiome fixture used by the Talbach regression elsewhere in
    // this file — long, German, but shares no word/subword with
    // "einkommen"/"prüfe", so the subword-anchor rule must not touch it.
    const longText = "Ferritin 27 µg/l (Referenz 0,5–5) — Strategie ist Aufbau. ".repeat(6);
    upsertMemoryItem({
      id: "labreport",
      kind: "note",
      key: "Gesundheitsinformationen",
      text: longText,
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: longText.slice(0, 200), embedding: vecAt(0.41) }], // mid cosine, same-language noise band
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("prüfe wie mein Einkommen ist", undefined);
    expect(res.sources).toEqual([]);
  });

  it("hybrid retrieval: a strong lexical/subword match surfaces even when the item is NOT in a tight vector shortlist", async () => {
    resetMemory();
    // 20 unrelated items with better cosine than the real match, so a
    // vector-only shortlist (the pre-fix SHORTLIST_K=15 cap) would push the
    // real item out entirely before the lexical signal ever got a look.
    for (let i = 0; i < 20; i++) {
      upsertMemoryItem({
        id: `filler${i}`,
        kind: "note",
        key: `Filler ${i}`,
        text: `Belangloser Eintrag Nummer ${i} ohne Bezug.`,
        tags: [],
        embModel: EMBED_MODEL,
        chunks: [{ text: `Belangloser Eintrag Nummer ${i} ohne Bezug.`, embedding: vecAt(0.5) }],
        createdAt: i,
        updatedAt: i,
      });
    }
    // The real match: low cosine, but a strong subword anchor.
    upsertMemoryItem({
      id: "income-low-cosine",
      kind: "fact",
      key: "Finanzen",
      text: "Nettoeinkommen liegt aktuell bei rund 200k gemeinsam.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [
        { text: "Nettoeinkommen liegt aktuell bei rund 200k gemeinsam.", embedding: vecAt(0.32) },
      ],
      createdAt: 100,
      updatedAt: 100,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("wie ist mein Einkommen", undefined);
    expect(res.sources.map((s) => s.title)).toContain("Finanzen");
  });
});

describe("retrieveContext (curated synonym expansion — Phase 4a)", () => {
  const vecAt = (cos: number) => [cos, Math.sqrt(1 - cos * cos), 0];
  const incomeNoteText =
    "Nettoeinkommen (beide berufstätig): Timo 95k € Brutto/32h, Nadine 70k € Brutto/32h. " +
    "Weitere Details zur Haushaltsplanung folgen hier, damit der Text lang genug ist, um über " +
    "die Kurzfassungsgrenze für Fakten hinauszugehen und wie eine echte gespeicherte Notiz zu " +
    "wirken, mit noch etwas mehr Kontext zur Budgetplanung der Familie in diesem Jahr.";

  it("a PURE-SYNONYM query ('Gehalt', zero shared token with 'Nettoeinkommen') still retrieves the note", async () => {
    resetMemory();
    expect(incomeNoteText.toLowerCase()).not.toContain("gehalt"); // confirms zero literal overlap
    expect(incomeNoteText.length).toBeGreaterThan(300); // strict tier — the real production shape
    upsertMemoryItem({
      id: "income",
      kind: "note",
      key: "Finanzen",
      text: incomeNoteText,
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: incomeNoteText, embedding: vecAt(0.45) }],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("wie hoch ist unser Gehalt", undefined);
    expect(res.sources.map((s) => s.title)).toEqual(["Finanzen"]);
  });

  it("guard: 'Wohnung' (apartment) is NOT pulled in by an 'Adresse' query (rejected cluster stays rejected)", async () => {
    resetMemory();
    upsertMemoryItem({
      id: "apartment",
      kind: "fact",
      key: "Wohnung",
      text: "Unsere Wohnung ist gerade ziemlich chaotisch, wir müssen dringend aufräumen.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [
        {
          text: "Unsere Wohnung ist gerade ziemlich chaotisch, wir müssen dringend aufräumen.",
          embedding: vecAt(0.3), // below every floor on its own — only a false anchor could rescue it
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("wie lautet meine Adresse", undefined);
    expect(res.sources).toEqual([]);
  });

  it("guard: 'Hausnummer' (address) is NOT pulled in by a 'Rufnummer' query (rejected bare-Nummer cluster)", async () => {
    resetMemory();
    upsertMemoryItem({
      id: "housenumber",
      kind: "fact",
      key: "Adresse",
      text: "Hausnummer 42 in der Bahnhofstraße.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Hausnummer 42 in der Bahnhofstraße.", embedding: vecAt(0.3) }],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("wie ist deine Rufnummer", undefined);
    expect(res.sources).toEqual([]);
  });
});

describe("retrieveContext (pinned facts — always a candidate)", () => {
  it("a pinned short fact is injected even for a completely unrelated query", async () => {
    resetMemory();
    upsertMemoryItem({
      id: "pinnedfact",
      kind: "fact",
      key: "Notfallkontakt",
      text: "Notfallkontakt: Nadine, +49 176 12345678.",
      tags: [],
      pinned: true,
      embModel: EMBED_MODEL,
      chunks: [{ text: "Notfallkontakt: Nadine, +49 176 12345678.", embedding: [-1, 0, 0] }], // cosine -1: maximally dissimilar
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("was kann man heute Abend kochen", undefined);
    expect(res.sources.map((s) => s.title)).toEqual(["Notfallkontakt"]);
  });

  it("pinning a LONG note does not bypass the strict tier (pinning can't force-inject arbitrary pastes)", async () => {
    resetMemory();
    const longText = "Belangloser langer Text ohne jeden Bezug zur Frage. ".repeat(10);
    expect(longText.length).toBeGreaterThan(300);
    upsertMemoryItem({
      id: "pinnedlong",
      kind: "note",
      key: "PastedDoc",
      text: longText,
      tags: [],
      pinned: true,
      embModel: EMBED_MODEL,
      chunks: [{ text: longText.slice(0, 200), embedding: [-1, 0, 0] }],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("was kann man heute Abend kochen", undefined);
    expect(res.sources).toEqual([]);
  });
});

describe("retrieveContext (tags feed the lexical boost)", () => {
  it("a query matching only a tag surfaces an item cosine alone would miss", async () => {
    resetMemory();
    // Both items get the SAME mediocre cosine (0.15, mocked below) against the
    // query — below ABS_FLOOR (0.30) even with a perfect lexical match on
    // ordinary text. Only "tagged" carries the query word as a tag; "untagged"
    // has no lexical signal at all, so it must stay below the gate.
    upsertMemoryItem({
      id: "tagged",
      kind: "fact",
      key: "Renewal",
      text: "Comes up every year.",
      tags: ["contract"],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Comes up every year.", embedding: [0.15, Math.sqrt(1 - 0.15 * 0.15), 0] }],
      createdAt: 0,
      updatedAt: 0,
    });
    upsertMemoryItem({
      id: "untagged",
      kind: "fact",
      key: "Other",
      text: "Something unrelated entirely.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [
        { text: "Something unrelated entirely.", embedding: [0.15, Math.sqrt(1 - 0.15 * 0.15), 0] },
      ],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("contract", undefined);
    expect(res.sources.map((s) => s.title)).toEqual(["Renewal"]);
    expect(res.text).toContain("Comes up every year.");
  });
});

describe("P5: lifecycle — superseded/archived items are excluded from retrieval", () => {
  it("memoryChunksInScope skips non-active items", () => {
    resetMemory();
    upsertMemoryItem({
      id: "active",
      kind: "fact",
      text: "still current",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "still current", embedding: [1] }],
      createdAt: 0,
      updatedAt: 0,
    });
    upsertMemoryItem({
      id: "superseded",
      kind: "fact",
      text: "old value",
      status: "superseded",
      supersededBy: "active",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "old value", embedding: [1] }],
      createdAt: 0,
      updatedAt: 0,
    });
    upsertMemoryItem({
      id: "archived",
      kind: "fact",
      text: "tucked away",
      status: "archived",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "tucked away", embedding: [1] }],
      createdAt: 0,
      updatedAt: 0,
    });
    const texts = memoryChunksInScope(undefined).map((r) => r.text);
    expect(texts).toEqual(["still current"]);
  });

  it("hasScopedContext ignores a scope that only has non-active memory", () => {
    resetMemory();
    upsertMemoryItem({
      id: "gone",
      kind: "note",
      text: "x",
      status: "archived",
      tags: [],
      createdAt: 0,
      updatedAt: 0,
    });
    expect(hasScopedContext(undefined)).toBe(false);
  });

  it("retrieveContext never surfaces a superseded item, even at perfect cosine", async () => {
    resetMemory();
    upsertMemoryItem({
      id: "old",
      kind: "fact",
      key: "Adresse",
      text: "Hamburg",
      status: "superseded",
      supersededBy: "new",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Hamburg", embedding: [1, 0, 0] }],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);
    const res = await retrieveContext("wie lautet meine Adresse", undefined);
    expect(res.sources).toEqual([]);
  });
});

describe("P5: pinned crowd-out fix, end-to-end through retrieveContext", () => {
  it("3 pinned facts no longer block a genuinely relevant hit (MEMORY_K=3)", async () => {
    resetMemory();
    const vecAt = (cos: number) => [cos, Math.sqrt(1 - cos * cos), 0];
    for (const label of ["one", "two", "three"]) {
      upsertMemoryItem({
        id: `pinned-${label}`,
        kind: "fact",
        key: `Pinned ${label}`,
        text: `Pinned fact ${label}, unrelated to the query.`,
        tags: [],
        pinned: true,
        embModel: EMBED_MODEL,
        chunks: [{ text: `Pinned fact ${label}, unrelated to the query.`, embedding: [-1, 0, 0] }],
        createdAt: 0,
        updatedAt: 0,
      });
    }
    upsertMemoryItem({
      id: "relevant",
      kind: "fact",
      key: "Familie",
      text: "Unser Neffe liebt Erlebnispfade in Talbach.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Unser Neffe liebt Erlebnispfade in Talbach.", embedding: vecAt(0.5) }],
      createdAt: 0,
      updatedAt: 0,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("was kann man in talbach mit einem kind machen", undefined);
    expect(res.sources.map((s) => s.title)).toContain("Familie");
    expect(res.pinnedCrowdedOut).toBeGreaterThan(0); // at least one pin lost its slot
  });
});

describe("P5: staleness date suffix ('Stand MM/YYYY')", () => {
  const SIX_MONTHS_MS = 200 * 24 * 60 * 60 * 1000;

  it("adds a date suffix for an item untouched for > ~6 months", async () => {
    resetMemory();
    const oldTs = Date.now() - SIX_MONTHS_MS;
    upsertMemoryItem({
      id: "stale",
      kind: "fact",
      key: "Finanzen",
      text: "Nettoeinkommen 200k gemeinsam.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Nettoeinkommen 200k gemeinsam.", embedding: [1, 0, 0] }],
      createdAt: oldTs,
      updatedAt: oldTs,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);
    const res = await retrieveContext("wie ist mein Nettoeinkommen", undefined);
    expect(res.text).toMatch(/Stand \d{2}\/\d{4}/);
    expect(res.text).toContain("Nettoeinkommen 200k gemeinsam.");
  });

  it("no date suffix for a recently-updated item", async () => {
    resetMemory();
    upsertMemoryItem({
      id: "fresh",
      kind: "fact",
      key: "Finanzen",
      text: "Nettoeinkommen 200k gemeinsam.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Nettoeinkommen 200k gemeinsam.", embedding: [1, 0, 0] }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);
    const res = await retrieveContext("wie ist mein Nettoeinkommen", undefined);
    expect(res.text).not.toMatch(/Stand \d{2}\/\d{4}/);
  });

  it("lastConfirmedAt (not just updatedAt) counts as 'touched' — suppresses the suffix", async () => {
    resetMemory();
    const oldTs = Date.now() - SIX_MONTHS_MS;
    upsertMemoryItem({
      id: "confirmed",
      kind: "fact",
      key: "Finanzen",
      text: "Nettoeinkommen 200k gemeinsam.",
      tags: [],
      embModel: EMBED_MODEL,
      chunks: [{ text: "Nettoeinkommen 200k gemeinsam.", embedding: [1, 0, 0] }],
      lastConfirmedAt: Date.now(),
      createdAt: oldTs,
      updatedAt: oldTs,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);
    const res = await retrieveContext("wie ist mein Nettoeinkommen", undefined);
    expect(res.text).not.toMatch(/Stand \d{2}\/\d{4}/);
  });
});

describe("P5: CHAR_BUDGET truncation drops the matching source (grounding-chip honesty)", () => {
  it("a truncated-away line's source is not listed as used", async () => {
    resetMemory();
    // One item whose text alone comfortably exceeds the 1600 CHAR_BUDGET when
    // combined with a second short item — one of the two lines cannot fit and
    // must be truncated away ALONG WITH its source entry.
    const big = "Großer Eintrag mit vielen Details zur Wohnsituation. ".repeat(35);
    expect(big.length).toBeGreaterThan(1600);
    upsertMemoryItem({
      id: "big",
      kind: "fact",
      key: "Alpha",
      text: big,
      tags: [],
      pinned: true, // guarantees inclusion regardless of relevance ranking
      embModel: EMBED_MODEL,
      chunks: [{ text: big, embedding: [1, 0, 0] }],
      createdAt: 0,
      updatedAt: 0,
    });
    upsertMemoryItem({
      id: "small",
      kind: "fact",
      key: "Beta",
      text: "Kleiner Eintrag.",
      tags: [],
      pinned: true,
      embModel: EMBED_MODEL,
      chunks: [{ text: "Kleiner Eintrag.", embedding: [1, 0, 0] }],
      createdAt: 1,
      updatedAt: 1,
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    const res = await retrieveContext("wohnsituation", undefined);
    // Only ONE of the two pinned items' text can fit under CHAR_BUDGET.
    expect(res.sources).toHaveLength(1);
    // The kept source is actually present verbatim in `text` — no source
    // lists content that got cut.
    for (const s of res.sources) expect(res.text).toContain(s.snippet.slice(0, 50));
  });
});

describe("P5: usage tracking — retrieveContext touches lastUsedAt/useCount", () => {
  it("bumps lastUsedAt/useCount on an item that made it into the injected context", async () => {
    resetMemory();
    upsertMemoryItem({
      id: "used",
      kind: "fact",
      key: "Notfallkontakt",
      text: "Notfallkontakt: Nadine.",
      tags: [],
      pinned: true,
      embModel: EMBED_MODEL,
      chunks: [{ text: "Notfallkontakt: Nadine.", embedding: [-1, 0, 0] }],
      createdAt: 1,
      updatedAt: 1, // a real (non-falsy) timestamp — upsertMemoryItem treats 0 as "unset"
    });
    vi.mocked(embedBatch).mockResolvedValue([[1, 0, 0]]);

    expect(getMemoryItem("used")?.useCount ?? 0).toBe(0);
    await retrieveContext("irrelevant query", undefined);
    expect(getMemoryItem("used")?.useCount).toBe(1);
    expect(getMemoryItem("used")?.lastUsedAt).toBeGreaterThan(0);
    // Usage must never bump updatedAt (see touchMemoryUsage's doc comment).
    expect(getMemoryItem("used")?.updatedAt).toBe(1);
  });
});
