import { beforeEach, describe, expect, it, vi } from "vitest";

// No network in tests: scrub + relay are mocked; stores, dedup and cursors run
// for real, in memory.
vi.mock("./quonApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quonApi")>();
  return { ...actual, scrubText: vi.fn(), chatComplete: vi.fn() };
});

// The embedder is a browser Web Worker — deterministic stub instead.
vi.mock("./embedding/embedder", () => ({
  EMBED_MODEL: "test-embed",
  EMBED_DIM: 3,
  embedText: vi.fn(async () => [1, 0, 0]),
  embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
  isEmbedderReady: () => true,
  isEmbedderLoading: () => false,
  onEmbedderReady: () => () => {},
  warmEmbedder: () => {},
}));

import { resetDocuments, upsertDocument, type DocItem } from "./documentStore";
import { resetMemory } from "./memoryStore";
import {
  getAllMemorySuggestions,
  getSweepCursor,
  resetMemorySuggestions,
  resetSweepCursors,
} from "./memorySuggestionStore";
import { chatComplete, scrubText, type ScrubResult } from "./quonApi";
import {
  DOCUMENT_EXTRACTION_SYSTEM_PROMPT,
  MAX_DOC_CHARS,
  MAX_FACTS_PER_DOC,
  MAX_FACT_CHARS,
  MIN_DOC_CHARS,
  buildDocumentExcerpt,
  filterDocumentCandidates,
  pendingDocumentSweepCount,
  runDocumentMemorySweep,
} from "./memoryFromDocuments";
import type { ExtractedCandidate } from "./memoryExtract";

const scrubMock = vi.mocked(scrubText);
const chatMock = vi.mocked(chatComplete);

const sweepOpts = { scope: undefined, model: "test/model" };

function scrubResult(
  scrubbed: string,
  entities: Array<{ placeholder: string; value: string }> = [],
): ScrubResult {
  return {
    scrubbed,
    original_length: scrubbed.length,
    scrubbed_length: scrubbed.length,
    entities: entities.map((e) => ({ ...e, type: "PERSON", confidence: 0.9 })),
    metadata: {
      model_used: "test",
      processing_time_ms: 1,
      fallback_mode: false,
      language_detected: "de",
    },
  };
}

/** A ready document with enough text to be worth analysing. */
function readyDoc(id: string, overrides: Partial<DocItem> = {}): DocItem {
  return {
    id,
    filename: `${id}.pdf`,
    mime: "application/pdf",
    status: "ready",
    chunks: [],
    fullText: "Mietvertrag zwischen den Parteien. ".repeat(10),
    createdAt: 0,
    updatedAt: 7,
    ...overrides,
  };
}

function cand(p: Partial<ExtractedCandidate>): ExtractedCandidate {
  return { kind: "fact", key: "Employer", text: "Works at ACME.", tags: [], ...p };
}

/**
 * The post-filter is the GUARANTEE behind "only take what's really relevant" —
 * the prompt is only a request. These tests pin the shapes a document must not
 * be able to push into the review queue no matter what the model replies.
 */
describe("filterDocumentCandidates", () => {
  it("keeps short keyed facts", () => {
    const out = filterDocumentCandidates([
      cand({ key: "Landlord", text: "Rents from Anna Berger.", tags: ["wohnen"] }),
    ]);
    expect(out).toEqual([
      { kind: "fact", key: "Landlord", text: "Rents from Anna Berger.", tags: ["wohnen"] },
    ]);
  });

  it("drops unkeyed entries — a document must not produce free-form notes", () => {
    // This is the summary shape ("the letter says …") the sweep exists to avoid.
    const out = filterDocumentCandidates([
      cand({ kind: "note", key: undefined, text: "The letter confirms the contract." }),
    ]);
    expect(out).toEqual([]);
  });

  it("drops paragraph-length text (a summary wearing a key)", () => {
    const out = filterDocumentCandidates([cand({ text: "x".repeat(MAX_FACT_CHARS + 1) })]);
    expect(out).toEqual([]);
  });

  it("keeps only the first of several variants of the same key slot", () => {
    const out = filterDocumentCandidates([
      cand({ key: "Rent", text: "Pays 1200 EUR." }),
      cand({ key: "rent", text: "Monthly rent is 1200 EUR." }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("Pays 1200 EUR.");
  });

  it("caps how much a single document may contribute", () => {
    const many = Array.from({ length: MAX_FACTS_PER_DOC + 4 }, (_, i) =>
      cand({ key: `Key ${i}`, text: `Fact ${i}.` }),
    );
    expect(filterDocumentCandidates(many)).toHaveLength(MAX_FACTS_PER_DOC);
  });

  it("normalizes everything it keeps to kind:'fact' with a trimmed key", () => {
    const out = filterDocumentCandidates([cand({ kind: "note", key: "  Insurer  " })]);
    expect(out[0].kind).toBe("fact");
    expect(out[0].key).toBe("Insurer");
  });
});

describe("buildDocumentExcerpt", () => {
  it("passes a short document through untouched", () => {
    expect(buildDocumentExcerpt("  Kurzer Brief.  ")).toEqual({
      text: "Kurzer Brief.",
      truncated: false,
    });
  });

  it("keeps the head within budget and reports the truncation", () => {
    const long = "a".repeat(MAX_DOC_CHARS + 5000);
    const out = buildDocumentExcerpt(long);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(MAX_DOC_CHARS);
  });

  it("cuts at a late paragraph boundary, not mid-sentence", () => {
    // Boundary inside the last quarter of the budget → honoured.
    const head = "x".repeat(MAX_DOC_CHARS - 100);
    const out = buildDocumentExcerpt(
      `${head}\n\ntail that must not be cut mid-word ${"y".repeat(5000)}`,
    );
    expect(out.text).toBe(head);
  });

  it("ignores an early boundary that would throw away most of the budget", () => {
    const early = "x".repeat(100);
    const out = buildDocumentExcerpt(`${early}\n\n${"y".repeat(MAX_DOC_CHARS * 2)}`);
    expect(out.text.length).toBeGreaterThan(MAX_DOC_CHARS * 0.9);
  });
});

describe("runDocumentMemorySweep", () => {
  beforeEach(() => {
    resetDocuments();
    resetMemory();
    resetMemorySuggestions();
    resetSweepCursors();
    scrubMock.mockReset();
    chatMock.mockReset();
  });

  it("extracts, re-hydrates locally, records provenance and analyses once per version", async () => {
    upsertDocument(readyDoc("d1", { filename: "Mietvertrag.pdf" }));
    scrubMock.mockResolvedValue(
      scrubResult("Vermieter ist [PERSON_1].", [
        { placeholder: "[PERSON_1]", value: "Anna Berger" },
      ]),
    );
    chatMock.mockResolvedValue({
      answer: '[{"key":"Vermieter","text":"Mietet von [PERSON_1].","tags":["wohnen"]}]',
      model: "test/model",
    });

    const res = await runDocumentMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 1, failed: 0, suggestions: 1, autoMerged: 0 });

    // The relay only ever saw the SCRUBBED text…
    expect(chatMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "Vermieter ist [PERSON_1]." },
      ],
      "test/model",
      true,
      undefined,
    );
    // …the queued suggestion is re-hydrated on-device and knows its document.
    const sug = getAllMemorySuggestions()[0];
    expect(sug.text).toBe("Mietet von Anna Berger.");
    expect(sug.sourceDocId).toBe("d1");
    expect(sug.sourceSessionId).toBeUndefined();
    expect(getSweepCursor("d1")).toBe(7);

    // Re-run: same version → no relay call at all.
    chatMock.mockClear();
    scrubMock.mockClear();
    expect(await runDocumentMemorySweep(sweepOpts)).toEqual({
      analyzed: 0,
      failed: 0,
      suggestions: 0,
      autoMerged: 0,
    });
    expect(scrubMock).not.toHaveBeenCalled();

    // A re-ingest (new updatedAt) makes it pending again.
    upsertDocument(readyDoc("d1", { filename: "Mietvertrag.pdf", updatedAt: 9 }));
    expect(pendingDocumentSweepCount(undefined)).toBe(1);
  });

  it("fails closed when scrubbing fails: no relay call, cursor untouched", async () => {
    upsertDocument(readyDoc("d1"));
    scrubMock.mockRejectedValue(new Error("scrubber unreachable"));

    const res = await runDocumentMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 0, failed: 1, suggestions: 0, autoMerged: 0 });
    expect(chatMock).not.toHaveBeenCalled();
    expect(getSweepCursor("d1")).toBeUndefined();
  });

  it("does not advance the cursor on a malformed reply", async () => {
    upsertDocument(readyDoc("d1"));
    scrubMock.mockResolvedValue(scrubResult("scrubbed"));
    chatMock.mockResolvedValue({ answer: "Ich habe nichts gefunden.", model: "m" });

    expect(await runDocumentMemorySweep(sweepOpts)).toEqual({
      analyzed: 0,
      failed: 1,
      suggestions: 0,
      autoMerged: 0,
    });
    expect(getSweepCursor("d1")).toBeUndefined();
  });

  it("applies the quality gate to what the model returns — summaries never reach the queue", async () => {
    upsertDocument(readyDoc("d1"));
    scrubMock.mockResolvedValue(scrubResult("scrubbed"));
    // A model ignoring the prompt: an unkeyed summary plus one real fact.
    chatMock.mockResolvedValue({
      answer: JSON.stringify([
        { kind: "note", text: "Das Schreiben bestätigt die Kündigung zum Quartalsende." },
        { key: "Krankenkasse", text: "Versichert bei der TK.", tags: ["gesundheit"] },
      ]),
      model: "m",
    });

    const res = await runDocumentMemorySweep(sweepOpts);
    expect(res.suggestions).toBe(1);
    expect(getAllMemorySuggestions()[0].key).toBe("Krankenkasse");
  });

  it("skips documents that are not ready, too short, or out of scope", async () => {
    upsertDocument(readyDoc("processing", { status: "processing" }));
    upsertDocument(readyDoc("short", { fullText: "x".repeat(MIN_DOC_CHARS - 1) }));
    upsertDocument(readyDoc("other-project", { projectId: "p2" }));

    expect(pendingDocumentSweepCount(undefined)).toBe(0);
    expect(pendingDocumentSweepCount("p2")).toBe(1);
    expect(await runDocumentMemorySweep(sweepOpts)).toEqual({
      analyzed: 0,
      failed: 0,
      suggestions: 0,
      autoMerged: 0,
    });
    expect(scrubMock).not.toHaveBeenCalled();
  });
});

describe("DOCUMENT_EXTRACTION_SYSTEM_PROMPT", () => {
  it("tells the model that returning nothing is the expected answer", () => {
    // The single most important line for precision: without it a model invents
    // facts to fill the array, and every document yields noise.
    expect(DOCUMENT_EXTRACTION_SYSTEM_PROMPT).toMatch(/\[\] is the correct, expected answer/);
  });

  it("names the caps it shares with the post-filter", () => {
    expect(DOCUMENT_EXTRACTION_SYSTEM_PROMPT).toContain(String(MAX_FACTS_PER_DOC));
    expect(DOCUMENT_EXTRACTION_SYSTEM_PROMPT).toContain(String(MAX_FACT_CHARS));
  });

  it("pins the placeholder rule — the scrubbed text is all the model ever sees", () => {
    expect(DOCUMENT_EXTRACTION_SYSTEM_PROMPT).toMatch(/EXACTLY as written/);
  });
});
