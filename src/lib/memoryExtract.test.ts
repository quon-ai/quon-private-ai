import { beforeEach, describe, expect, it, vi } from "vitest";

// No network in tests: the scrub + relay calls are mocked; everything else
// (stores, dedup, cursors) runs for real, in memory.
vi.mock("./quonApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quonApi")>();
  return { ...actual, scrubText: vi.fn(), chatComplete: vi.fn() };
});

// The embedder is a browser Web Worker — replace it with a deterministic stub.
// Tests that need specific vectors override embedBatch per call.
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

import { embedBatch } from "./embedding/embedder";
import {
  ATTIC_AGE_MS,
  autoMergeExactDuplicates,
  buildTranscript,
  classifyCandidate,
  SIM_REDUNDANT,
  extractFromText,
  findAtticItems,
  findMemoryConflicts,
  nearDuplicatesForReview,
  MIN_NEW_USER_CHARS,
  parseExtractionReply,
  pendingSweepCount,
  runMemorySweep,
  SIM_SKIP,
  SIM_UPDATE,
} from "./memoryExtract";
import {
  getAllMemorySuggestions,
  getSweepCursor,
  resetMemorySuggestions,
  resetSweepCursors,
  setSweepCursor,
} from "./memorySuggestionStore";
import {
  getAllMemory,
  getMemoryItem,
  resetMemory,
  upsertMemoryItem,
  type MemoryItem,
} from "./memoryStore";
import { chatComplete, scrubText, type ScrubResult } from "./quonApi";
import { resetChatHistory, saveChatSession, type StoredChatMessage } from "./quonStore";

const scrubMock = vi.mocked(scrubText);
const chatMock = vi.mocked(chatComplete);

// Comfortably above MIN_NEW_USER_CHARS (~290 chars).
const LONG = "I work at Contoso in Berlin as a data engineer. ".repeat(6).trim();

function msg(id: number, role: "user" | "assistant", text: string): StoredChatMessage {
  return { id, role, text };
}

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
      language_detected: "en",
    },
  };
}

function memItem(id: string, embedding: number[], projectId?: string): MemoryItem {
  return {
    id,
    kind: "fact",
    text: `existing ${id}`,
    tags: [],
    embedding,
    dim: embedding.length,
    embModel: "test-embed", // = the mocked EMBED_MODEL
    projectId,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** Like `memItem`, but with a `key` + explicit `text` and `updatedAt` — for the
 *  P5 key-awareness/lifecycle tests below. `updatedAt` defaults to 1 (not 0 —
 *  `upsertMemoryItem` treats a falsy `updatedAt` as "unset" and substitutes
 *  `Date.now()`, which would defeat deterministic ordering assertions). */
function memItemWithKey(
  id: string,
  key: string,
  text: string,
  embedding: number[],
  overrides: Partial<MemoryItem> = {},
): MemoryItem {
  return {
    id,
    kind: "fact",
    key,
    text,
    tags: [],
    embedding,
    dim: embedding.length,
    embModel: "test-embed",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const sweepOpts = { scope: undefined, model: "test/model" };

beforeEach(() => {
  resetChatHistory();
  resetMemory();
  resetMemorySuggestions();
  resetSweepCursors();
  scrubMock.mockReset();
  chatMock.mockReset();
  vi.mocked(embedBatch).mockClear();
});

// ---------------------------------------------------------------------------

describe("parseExtractionReply (fail-safe JSON parsing)", () => {
  it("parses a plain JSON array", () => {
    const out = parseExtractionReply(
      '[{"kind":"fact","key":"Job","text":"Works at [ORG_1].","tags":["work"]}]',
    );
    expect(out).toEqual([{ kind: "fact", key: "Job", text: "Works at [ORG_1].", tags: ["work"] }]);
  });

  it("tolerates code fences and surrounding prose", () => {
    // No key on either → downgraded to "note" (see the key-required-for-fact test below).
    expect(parseExtractionReply('```json\n[{"text":"a"}]\n```')).toEqual([
      { kind: "note", key: undefined, text: "a", tags: [] },
    ]);
    expect(parseExtractionReply('Here you go: [{"text":"b"}] Hope that helps!')).toEqual([
      { kind: "note", key: undefined, text: "b", tags: [] },
    ]);
  });

  it("returns an empty array for [] (nothing memorable)", () => {
    expect(parseExtractionReply("[]")).toEqual([]);
  });

  it("returns null for malformed or non-array replies", () => {
    expect(parseExtractionReply("sorry, I cannot help with that")).toBeNull();
    expect(parseExtractionReply('[{"text": "unterminated')).toBeNull();
    expect(parseExtractionReply('{"text":"an object, not an array"}')).toBeNull();
  });

  it("drops entries without usable text and normalizes kind/tags", () => {
    const out = parseExtractionReply(
      '[{"text":""},{"notext":1},{"kind":"note","text":"n","tags":["a",2,"  b "]},{"kind":"bogus","key":"K","text":"f"}]',
    );
    expect(out).toEqual([
      { kind: "note", key: undefined, text: "n", tags: ["a", "b"] },
      { kind: "fact", key: "K", text: "f", tags: [] },
    ]);
  });

  it("downgrades a keyless kind:fact to kind:note instead of dropping it", () => {
    // A sloppy model reply omits the required key for a fact — still usable, just
    // relabeled, so the sweep doesn't lose a real memory over a formatting slip.
    const out = parseExtractionReply('[{"kind":"fact","text":"Prefers dark mode."}]');
    expect(out).toEqual([{ kind: "note", key: undefined, text: "Prefers dark mode.", tags: [] }]);
  });

  it("keeps kind:fact when a key is present", () => {
    const out = parseExtractionReply('[{"kind":"fact","key":"Theme","text":"Prefers dark mode."}]');
    expect(out).toEqual([{ kind: "fact", key: "Theme", text: "Prefers dark mode.", tags: [] }]);
  });
});

describe("classifyCandidate (dedup thresholds)", () => {
  it("thresholds are ordered sanely", () => {
    expect(SIM_SKIP).toBeGreaterThan(SIM_UPDATE);
  });

  it("creates when nothing comparable exists", () => {
    expect(classifyCandidate([1, 0, 0], undefined, [])).toEqual({ mode: "create" });
    // different dimension / missing embedding are not comparable
    expect(
      classifyCandidate([1, 0, 0], undefined, [{ id: "a", embedding: [1, 0] }, { id: "b" }]),
    ).toEqual({
      mode: "create",
    });
  });

  it("skips a near-identical fact (≥ SIM_SKIP) when there's no key to merge against", () => {
    expect(classifyCandidate([1, 0, 0], undefined, [{ id: "a", embedding: [1, 0, 0] }])).toEqual({
      mode: "skip",
    });
  });

  it("suggests an update in the middle band, referencing the best match", () => {
    // cos([1,0,0], [0.85, √(1−0.85²), 0]) = 0.85 → between SIM_UPDATE and SIM_SKIP
    const near = [0.85, Math.sqrt(1 - 0.85 * 0.85), 0];
    const far = [0.5, Math.sqrt(1 - 0.25), 0];
    expect(
      classifyCandidate([1, 0, 0], undefined, [
        { id: "far", embedding: far },
        { id: "near", embedding: near },
      ]),
    ).toEqual({ mode: "update", targetId: "near" });
  });

  it("creates below SIM_UPDATE", () => {
    const far = [0.5, Math.sqrt(1 - 0.25), 0];
    expect(classifyCandidate([1, 0, 0], undefined, [{ id: "a", embedding: far }])).toEqual({
      mode: "create",
    });
  });

  describe("key-aware forcing (P5 — the contradiction fix)", () => {
    it("forces 'update' against a key-matching ACTIVE item regardless of cosine", () => {
      // Far below SIM_UPDATE on cosine alone (would otherwise be "create"), but
      // the candidate's key normalizes to the same slot as the existing item —
      // e.g. "Adresse: Hamburg" (existing) vs. a freshly extracted
      // "Adresse: Berlin" (candidate): different content, LOW cosine, same slot.
      const far = [0.1, Math.sqrt(1 - 0.01), 0];
      expect(
        classifyCandidate([1, 0, 0], "Adresse", [{ id: "addr", key: "Adresse", embedding: far }]),
      ).toEqual({ mode: "update", targetId: "addr" });
    });

    it("key matching is case/whitespace-insensitive and synonym-aware", () => {
      const far = [0.1, Math.sqrt(1 - 0.01), 0];
      expect(
        classifyCandidate([1, 0, 0], "  adresse  ", [
          { id: "addr", key: "Adresse", embedding: far },
        ]),
      ).toEqual({ mode: "update", targetId: "addr" });
      // "Anschrift" is a curated synonym of "Adresse" (./search/synonyms).
      expect(
        classifyCandidate([1, 0, 0], "Anschrift", [{ id: "addr", key: "Adresse", embedding: far }]),
      ).toEqual({ mode: "update", targetId: "addr" });
    });

    it("auto-merges ('merge' mode) an exact-dup that is ALSO key-compatible", () => {
      expect(
        classifyCandidate([1, 0, 0], "Adresse", [
          { id: "addr", key: "Adresse", embedding: [1, 0, 0] }, // cosine 1.0 ≥ SIM_SKIP
        ]),
      ).toEqual({ mode: "merge", targetId: "addr" });
    });

    it("a candidate with NO key falls back to plain cosine classification", () => {
      expect(
        classifyCandidate([1, 0, 0], undefined, [
          { id: "addr", key: "Adresse", embedding: [1, 0, 0] },
        ]),
      ).toEqual({ mode: "skip" }); // no key → cosine-only path → ≥ SIM_SKIP → skip, not merge
    });

    it("an unrelated key never forces a match, however high the cosine", () => {
      expect(
        classifyCandidate([1, 0, 0], "Lieblingsfarbe", [
          { id: "addr", key: "Adresse", embedding: [1, 0, 0] },
        ]),
      ).toEqual({ mode: "skip" }); // falls through to cosine-only, which still applies
    });
  });
});

describe("buildTranscript (cursor-aware)", () => {
  const messages = [
    msg(1, "user", "old question"),
    msg(2, "assistant", "old answer"),
    msg(3, "user", "new question"),
    { ...msg(4, "assistant", "boom"), isError: true },
    msg(5, "assistant", "new answer"),
  ];

  it("includes everything without a cursor, skipping error bubbles", () => {
    const t = buildTranscript(messages);
    expect(t.text).toBe(
      "User: old question\n\nAssistant: old answer\n\nUser: new question\n\nAssistant: new answer",
    );
    expect(t.lastId).toBe(5);
    expect(t.newUserChars).toBe("old question".length + "new question".length);
  });

  it("only includes messages after the cursor", () => {
    const t = buildTranscript(messages, 2);
    expect(t.text).toBe("User: new question\n\nAssistant: new answer");
    expect(t.lastId).toBe(5);
    expect(t.newUserChars).toBe("new question".length);
  });

  it("reports nothing new when the cursor is at the end", () => {
    const t = buildTranscript(messages, 5);
    expect(t.lastId).toBeNull();
    expect(t.text).toBe("");
  });
});

describe("extractFromText (large-paste triage distillation)", () => {
  it("scrubs first, extracts over placeholders only, re-hydrates locally, queues without a session", async () => {
    scrubMock.mockResolvedValue(
      scrubResult("[PERSON_1] takes Ibuprofen every morning.", [
        { placeholder: "[PERSON_1]", value: "Timo" },
      ]),
    );
    chatMock.mockResolvedValue({
      answer:
        '[{"kind":"fact","key":"Medication","text":"[PERSON_1] takes Ibuprofen every morning.","tags":["health"]}]',
      model: "test/model",
    });

    const added = await extractFromText("Timo takes Ibuprofen every morning. …long report…", {
      scope: undefined,
      model: "test/model",
    });
    expect(added).toBe(1);
    // The relay only ever saw the SCRUBBED text.
    expect(chatMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "[PERSON_1] takes Ibuprofen every morning." },
      ],
      "test/model",
      true,
      undefined,
    );
    const sug = getAllMemorySuggestions()[0];
    expect(sug.text).toBe("Timo takes Ibuprofen every morning.");
    expect(sug.sourceSessionId).toBeUndefined(); // no source chat — pasted text
    expect(sug.mode).toBe("create");
  });

  it("throws on a malformed reply and on scrub failure (nothing reaches the relay unscrubbed)", async () => {
    scrubMock.mockResolvedValue(scrubResult("scrubbed"));
    chatMock.mockResolvedValue({ answer: "no json here", model: "m" });
    await expect(extractFromText("text", { scope: undefined, model: "m" })).rejects.toThrow();

    chatMock.mockClear();
    scrubMock.mockRejectedValue(new Error("scrubber unreachable"));
    await expect(extractFromText("text", { scope: undefined, model: "m" })).rejects.toThrow();
    expect(chatMock).not.toHaveBeenCalled(); // fail-closed: no unscrubbed relay call
  });
});

describe("pendingSweepCount (ambient discovery badge — no relay)", () => {
  it("counts only in-scope sessions with enough NEW user text past their cursor", () => {
    expect(pendingSweepCount(undefined)).toBe(0);

    saveChatSession("s1", [msg(1, "user", LONG), msg(2, "assistant", "noted")]);
    saveChatSession("s2", [msg(1, "user", "hi")]); // below MIN_NEW_USER_CHARS → not worth a run
    saveChatSession("p1s", [msg(1, "user", LONG)], { projectId: "p1" });

    // Strict scope (inScope is exact projectId equality): global counts only the
    // non-project session s1, NOT the trivial one and NOT the project session.
    expect(pendingSweepCount(undefined)).toBe(1);
    // Project scope sees only that project's session.
    expect(pendingSweepCount("p1")).toBe(1);

    // Advancing a session's cursor past its last message clears it from the count
    // (mirrors what a successful sweep does), so the badge drops after learning.
    setSweepCursor("s1", 2);
    expect(pendingSweepCount(undefined)).toBe(0);
    expect(pendingSweepCount("p1")).toBe(1);
  });

  it("counts a short but fact-dense single message (regression: 200-char gate dropped it)", () => {
    // The reported case: one health fact, ~100 chars — well under the old 200
    // threshold but a genuine fact worth learning.
    const fact =
      "Ich überlege die 5mg thc/CBD Pillen nur noch jede 2. Nacht zu nehmen, " +
      "weil ich sonst schlecht schlafe.";
    expect(fact.length).toBeGreaterThanOrEqual(MIN_NEW_USER_CHARS);
    expect(fact.length).toBeLessThan(200); // would have been skipped before the fix
    saveChatSession("health", [msg(1, "user", fact)], { projectId: "gesundheit" });
    expect(pendingSweepCount("gesundheit")).toBe(1);
  });
});

describe("runMemorySweep", () => {
  it("extracts, re-hydrates placeholders locally and advances the cursor", async () => {
    saveChatSession("s1", [msg(1, "user", LONG), msg(2, "assistant", "noted")]);
    scrubMock.mockResolvedValue(
      scrubResult("User: [PERSON_1] works at Contoso.", [
        { placeholder: "[PERSON_1]", value: "Anna Müller" },
      ]),
    );
    chatMock.mockResolvedValue({
      answer:
        '[{"kind":"fact","key":"Employer of [PERSON_1]","text":"[PERSON_1] works at Contoso in Berlin.","tags":["work"]}]',
      model: "test/model",
    });

    const res = await runMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 1, failed: 0, suggestions: 1, autoMerged: 0 });

    // The relay only ever saw the SCRUBBED transcript…
    expect(chatMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "User: [PERSON_1] works at Contoso." },
      ],
      "test/model",
      true,
      undefined,
    );
    // …while the queued suggestion is re-hydrated on-device.
    const sug = getAllMemorySuggestions()[0];
    expect(sug.text).toBe("Anna Müller works at Contoso in Berlin.");
    expect(sug.key).toBe("Employer of Anna Müller");
    expect(sug.mode).toBe("create");
    expect(sug.sourceSessionId).toBe("s1");
    expect(sug.projectId).toBeUndefined();
    expect(getSweepCursor("s1")).toBe(2);

    // Re-run: nothing new since the cursor → no relay call at all.
    chatMock.mockClear();
    scrubMock.mockClear();
    const res2 = await runMemorySweep(sweepOpts);
    expect(res2).toEqual({ analyzed: 0, failed: 0, suggestions: 0, autoMerged: 0 });
    expect(scrubMock).not.toHaveBeenCalled();
    expect(chatMock).not.toHaveBeenCalled();
  });

  it("does not advance the cursor on a malformed reply, and retries next run", async () => {
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockResolvedValue(scrubResult("scrubbed"));
    chatMock.mockResolvedValue({ answer: "I could not find any facts.", model: "m" });

    const res = await runMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 0, failed: 1, suggestions: 0, autoMerged: 0 });
    expect(getSweepCursor("s1")).toBeUndefined();

    // The model behaves on the retry → the same messages are processed now.
    chatMock.mockResolvedValue({ answer: '[{"text":"a durable fact"}]', model: "m" });
    const res2 = await runMemorySweep(sweepOpts);
    expect(res2).toEqual({ analyzed: 1, failed: 0, suggestions: 1, autoMerged: 0 });
    expect(getSweepCursor("s1")).toBe(1);
  });

  it("fails soft when scrubbing fails: no relay call, cursor untouched", async () => {
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockRejectedValue(new Error("scrubber unreachable"));

    const res = await runMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 0, failed: 1, suggestions: 0, autoMerged: 0 });
    // Zero-knowledge fail-closed: nothing may reach the relay unscrubbed.
    expect(chatMock).not.toHaveBeenCalled();
    expect(getSweepCursor("s1")).toBeUndefined();
  });

  it("skips trivial sessions (< MIN_NEW_USER_CHARS of new user text) without a relay call", async () => {
    expect("hi".length).toBeLessThan(MIN_NEW_USER_CHARS);
    saveChatSession("s1", [msg(1, "user", "hi"), msg(2, "assistant", "hello!")]);

    const res = await runMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 0, failed: 0, suggestions: 0, autoMerged: 0 });
    expect(scrubMock).not.toHaveBeenCalled();
    expect(getSweepCursor("s1")).toBeUndefined(); // still counts on the next run
  });

  it("drops candidates already known in the SAME scope (≥ SIM_SKIP)", async () => {
    upsertMemoryItem(memItem("g1", [1, 0, 0])); // global memory, identical vector
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock.mockResolvedValue({ answer: '[{"text":"already known fact"}]', model: "m" });

    const res = await runMemorySweep(sweepOpts); // global sweep
    expect(res.suggestions).toBe(0);
    expect(getAllMemorySuggestions()).toHaveLength(0);
    expect(getSweepCursor("s1")).toBe(1); // dedup-dropped is still a SUCCESSFUL sweep
  });

  it("scope isolation: a project candidate never matches global memory", async () => {
    upsertMemoryItem(memItem("g1", [1, 0, 0])); // GLOBAL item, identical vector
    saveChatSession("p1s", [msg(1, "user", LONG)], { projectId: "p1" });
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock.mockResolvedValue({ answer: '[{"text":"identical fact"}]', model: "m" });

    const res = await runMemorySweep({ ...sweepOpts, scope: "p1" });
    // Would be a skip if scopes mixed — must stay a "create" in the project.
    expect(res.suggestions).toBe(1);
    const sug = getAllMemorySuggestions()[0];
    expect(sug.mode).toBe("create");
    expect(sug.projectId).toBe("p1");
  });

  it("suggests an update for a near-match in scope, referencing the target item", async () => {
    upsertMemoryItem(memItem("g1", [0.85, Math.sqrt(1 - 0.85 * 0.85), 0])); // cos = 0.85
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock.mockResolvedValue({ answer: '[{"text":"a refined fact"}]', model: "m" });

    const res = await runMemorySweep(sweepOpts);
    expect(res.suggestions).toBe(1);
    const sug = getAllMemorySuggestions()[0];
    expect(sug.mode).toBe("update");
    expect(sug.targetId).toBe("g1");
    // The suggestion carries the target's CURRENT text too, so a review UI
    // can render a before/after diff without a second lookup.
    expect(sug.previousText).toBe("existing g1");
  });

  it("does not queue the same text twice across runs (pending-queue dedup)", async () => {
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock.mockResolvedValue({ answer: '[{"text":"the same fact"}]', model: "m" });
    await runMemorySweep(sweepOpts);
    expect(getAllMemorySuggestions()).toHaveLength(1);

    // A different session yields the same fact → not queued again.
    saveChatSession("s2", [msg(1, "user", LONG)]);
    const res2 = await runMemorySweep(sweepOpts);
    expect(res2.suggestions).toBe(0);
    expect(getAllMemorySuggestions()).toHaveLength(1);
  });

  it("P5: a key-matching candidate forces an 'update' suggestion even at LOW cosine (the contradiction case)", async () => {
    // "Adresse: Hamburg" (existing) vs. a freshly extracted "Adresse: Berlin"
    // (candidate) — different content, so cosine would normally be "create",
    // but same key ⇒ forced "update" (never both injected as memory).
    upsertMemoryItem(memItemWithKey("addr", "Adresse", "Hamburg", [0, 1, 0]));
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockResolvedValue(scrubResult("t"));
    // The default embedBatch mock always returns [1,0,0] — cosine 0 vs [0,1,0].
    chatMock.mockResolvedValue({
      answer: '[{"kind":"fact","key":"Adresse","text":"Berlin"}]',
      model: "m",
    });

    const res = await runMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 1, failed: 0, suggestions: 1, autoMerged: 0 });
    const sug = getAllMemorySuggestions()[0];
    expect(sug.mode).toBe("update");
    expect(sug.targetId).toBe("addr");
    expect(sug.previousText).toBe("Hamburg");
  });

  it("P5: an exact-dup + key-compatible candidate auto-merges WITHOUT the review queue", async () => {
    upsertMemoryItem(memItemWithKey("addr", "Adresse", "Berlin", [1, 0, 0])); // cosine 1.0 with the mocked candidate vector
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock.mockResolvedValue({
      answer: '[{"kind":"fact","key":"Adresse","text":"Berlin (bestätigt)"}]',
      model: "m",
    });

    const res = await runMemorySweep(sweepOpts);
    expect(res).toEqual({ analyzed: 1, failed: 0, suggestions: 0, autoMerged: 1 });
    expect(getAllMemorySuggestions()).toHaveLength(0); // never touched the review queue

    // The old item is superseded — REVERSIBLE, never deleted.
    const old = getMemoryItem("addr");
    expect(old?.status).toBe("superseded");
    expect(old && old.text).toBe("Berlin");

    // A new active item holds the merged/candidate text.
    const active = getAllMemory().find((m) => m.id !== "addr");
    expect(active?.text).toBe("Berlin (bestätigt)");
    expect(active?.status).toBeUndefined();
    expect(old?.supersededBy).toBe(active?.id);
  });

  it("P5: a SUPERSEDED item's key is never matched against (auto-merge/update both skip it)", async () => {
    upsertMemoryItem(
      memItemWithKey("addr-old", "Adresse", "Berlin", [1, 0, 0], { status: "superseded" }),
    );
    saveChatSession("s1", [msg(1, "user", LONG)]);
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock.mockResolvedValue({
      answer: '[{"kind":"fact","key":"Adresse","text":"Berlin"}]',
      model: "m",
    });

    const res = await runMemorySweep(sweepOpts);
    // No active item to match against at all → falls through to a plain "create".
    expect(res).toEqual({ analyzed: 1, failed: 0, suggestions: 1, autoMerged: 0 });
    expect(getAllMemorySuggestions()[0].mode).toBe("create");
  });
});

describe("findMemoryConflicts (P5)", () => {
  it("flags an active same-key pair with different text as a key conflict", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Adresse", "Hamburg", [1, 0, 0]));
    upsertMemoryItem(memItemWithKey("b", "Adresse", "Berlin", [0, 1, 0]));
    const { keyConflicts } = findMemoryConflicts(undefined);
    expect(keyConflicts).toHaveLength(1);
    expect(new Set([keyConflicts[0].a.id, keyConflicts[0].b.id])).toEqual(new Set(["a", "b"]));
  });

  it("does NOT flag a same-key pair with IDENTICAL text", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Adresse", "Berlin", [1, 0, 0]));
    upsertMemoryItem(memItemWithKey("b", "Adresse", "Berlin", [0, 1, 0]));
    expect(findMemoryConflicts(undefined).keyConflicts).toEqual([]);
  });

  it("does not flag a superseded item as part of a conflict", () => {
    resetMemory();
    upsertMemoryItem(
      memItemWithKey("a", "Adresse", "Hamburg", [1, 0, 0], { status: "superseded" }),
    );
    upsertMemoryItem(memItemWithKey("b", "Adresse", "Berlin", [0, 1, 0]));
    expect(findMemoryConflicts(undefined).keyConflicts).toEqual([]);
  });

  it("respects scope isolation", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Adresse", "Hamburg", [1, 0, 0], { projectId: "p1" }));
    upsertMemoryItem(memItemWithKey("b", "Adresse", "Berlin", [0, 1, 0])); // global
    expect(findMemoryConflicts("p1").keyConflicts).toEqual([]); // only one item in p1
    expect(findMemoryConflicts(undefined).keyConflicts).toEqual([]); // only one item global
  });

  it("flags near-identical ACTIVE items as near-duplicates (cosine ≥ SIM_SKIP)", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Notiz", "text a", [1, 0, 0]));
    upsertMemoryItem(memItemWithKey("b", "Anderes", "text b", [1, 0, 0])); // identical vector
    const { nearDuplicates } = findMemoryConflicts(undefined);
    expect(nearDuplicates).toHaveLength(1);
    expect(nearDuplicates[0].cosineScore).toBeGreaterThanOrEqual(SIM_SKIP);
  });

  it("does not flag dissimilar items as near-duplicates", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Notiz", "text a", [1, 0, 0]));
    upsertMemoryItem(memItemWithKey("b", "Anderes", "text b", [0, 1, 0]));
    expect(findMemoryConflicts(undefined).nearDuplicates).toEqual([]);
  });
});

describe("nearDuplicatesForReview", () => {
  /** Regression: two addresses under one key are BOTH a key conflict and a near
   *  duplicate (measured 0.87 on real text). The maintenance screen listed the
   *  pair twice, with the same "keep this version" buttons in both sections —
   *  the same question asked in two places. */
  it("drops a pair that is already a key conflict", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Wohnort", "Hamburg, Elbchaussee 1", [1, 0, 0]));
    upsertMemoryItem(memItemWithKey("b", "Wohnort", "Berlin, Kastanienallee 5", [1, 0, 0]));
    const found = findMemoryConflicts(undefined);
    // The raw analysis still reports both — autoMergeExactDuplicates needs it.
    expect(found.keyConflicts).toHaveLength(1);
    expect(found.nearDuplicates).toHaveLength(1);
    // What a human is shown: only the conflict.
    expect(nearDuplicatesForReview(found)).toEqual([]);
  });

  it("keeps a near-duplicate that is NOT a key conflict", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Notiz", "Ich jogge morgens", [1, 0, 0]));
    upsertMemoryItem(memItemWithKey("b", "Sport", "Ich laufe jeden Morgen", [1, 0, 0]));
    const found = findMemoryConflicts(undefined);
    expect(nearDuplicatesForReview(found)).toHaveLength(1);
  });

  /** The filter must not depend on which side of the pair each scan saw first. */
  it("matches a pair regardless of the order the two scans found it in", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("zzz", "Wohnort", "Hamburg", [1, 0, 0]));
    upsertMemoryItem(memItemWithKey("aaa", "Wohnort", "Berlin", [1, 0, 0]));
    const found = findMemoryConflicts(undefined);
    expect(found.nearDuplicates).toHaveLength(1);
    expect(nearDuplicatesForReview(found)).toEqual([]);
  });
});

describe("autoMergeExactDuplicates (P5 maintenance-scan auto-merge)", () => {
  it("supersedes the OLDER of a near-dup + key-compatible active pair, keeping the newer", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("older", "Adresse", "Berlin", [1, 0, 0], { updatedAt: 1 }));
    upsertMemoryItem(
      memItemWithKey("newer", "Adresse", "Berlin (aktuell)", [1, 0, 0], { updatedAt: 2 }),
    );
    const merged = autoMergeExactDuplicates(undefined);
    expect(merged).toBe(1);
    expect(getMemoryItem("older")?.status).toBe("superseded");
    expect(getMemoryItem("older")?.supersededBy).toBe("newer");
    expect(getMemoryItem("newer")?.status).toBeUndefined(); // survives, active
  });

  it("does NOT merge a near-dup pair without a compatible key (no confirmed 'same slot')", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("a", "Notiz", "text", [1, 0, 0], { updatedAt: 1 }));
    upsertMemoryItem(memItemWithKey("b", "Anderes", "text", [1, 0, 0], { updatedAt: 2 }));
    expect(autoMergeExactDuplicates(undefined)).toBe(0);
    expect(getMemoryItem("a")?.status).toBeUndefined();
    expect(getMemoryItem("b")?.status).toBeUndefined();
  });

  it("is reversible — reviveMemoryItem un-does the auto-merge", async () => {
    const { reviveMemoryItem } = await import("./memoryStore");
    resetMemory();
    upsertMemoryItem(memItemWithKey("older", "Adresse", "Berlin", [1, 0, 0], { updatedAt: 1 }));
    upsertMemoryItem(
      memItemWithKey("newer", "Adresse", "Berlin (aktuell)", [1, 0, 0], { updatedAt: 2 }),
    );
    autoMergeExactDuplicates(undefined);
    reviveMemoryItem("older");
    expect(getMemoryItem("older")?.status).toBeUndefined();
  });
});

describe("findAtticItems (P5)", () => {
  const now = Date.now();
  const old = now - ATTIC_AGE_MS - 1000;
  const recent = now - 1000;

  it("surfaces an active, non-pinned item untouched past ATTIC_AGE_MS", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("stale", "Notiz", "old fact", [1, 0, 0], { updatedAt: old }));
    expect(findAtticItems(undefined, now).map((m) => m.id)).toEqual(["stale"]);
  });

  it("excludes a recently-updated item", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("fresh", "Notiz", "fact", [1, 0, 0], { updatedAt: recent }));
    expect(findAtticItems(undefined, now)).toEqual([]);
  });

  it("excludes a pinned item, however old", () => {
    resetMemory();
    upsertMemoryItem(
      memItemWithKey("pinned", "Notiz", "fact", [1, 0, 0], { updatedAt: old, pinned: true }),
    );
    expect(findAtticItems(undefined, now)).toEqual([]);
  });

  it("excludes an old item that was recently CONFIRMED, even if never edited", () => {
    resetMemory();
    upsertMemoryItem(
      memItemWithKey("confirmed", "Notiz", "fact", [1, 0, 0], {
        updatedAt: old,
        lastConfirmedAt: recent,
      }),
    );
    expect(findAtticItems(undefined, now)).toEqual([]);
  });

  it("excludes an old item that was recently USED (retrieved into context)", () => {
    resetMemory();
    upsertMemoryItem(
      memItemWithKey("used", "Notiz", "fact", [1, 0, 0], { updatedAt: old, lastUsedAt: recent }),
    );
    expect(findAtticItems(undefined, now)).toEqual([]);
  });

  it("excludes a non-active (already superseded/archived) item", () => {
    resetMemory();
    upsertMemoryItem(
      memItemWithKey("gone", "Notiz", "fact", [1, 0, 0], { updatedAt: old, status: "archived" }),
    );
    expect(findAtticItems(undefined, now)).toEqual([]);
  });

  it("NEVER mutates — it's a pure read (calling it twice doesn't archive anything)", () => {
    resetMemory();
    upsertMemoryItem(memItemWithKey("stale", "Notiz", "old fact", [1, 0, 0], { updatedAt: old }));
    findAtticItems(undefined, now);
    findAtticItems(undefined, now);
    expect(getMemoryItem("stale")?.status).toBeUndefined();
  });
});

// --- the redundancy band (measured 2026-08-10, see SIM_REDUNDANT's doc) ------
// Reported: "beim Hinzufügen ins Memory wird nicht gegen Duplikate geprüft,
// und die Generierung liefert teilredundante Fakten". The measurement found
// why: genuine restatements sit at ~0.86, BELOW the old 0.92 gate.

/** Unit vectors whose pairwise cosine is exactly `c` — lets a threshold be
 *  tested at a named similarity instead of with magic arrays. */
function vecPair(c: number): [number[], number[]] {
  return [
    [1, 0],
    [c, Math.sqrt(1 - c * c)],
  ];
}

describe("SIM_REDUNDANT band", () => {
  it("sits above contradictions and below real restatements (the measured gap)", () => {
    // Contradictions measured 0.52-0.64; restatements 0.85-0.97. The threshold
    // must separate them, or merging would start destroying disagreeing facts.
    expect(SIM_REDUNDANT).toBeGreaterThan(0.7);
    expect(SIM_REDUNDANT).toBeLessThan(0.85);
    expect(SIM_REDUNDANT).toBeLessThan(SIM_SKIP);
  });

  it("does NOT change what classifyCandidate auto-merges — that stays strict", () => {
    // A 0.86 pair (a real restatement) must still NOT be silently merged into
    // an existing item; it becomes an "update" the user reviews.
    const [a, b] = vecPair(0.86);
    expect(classifyCandidate(a, undefined, [{ id: "x", embedding: b }])).toEqual({
      mode: "update",
      targetId: "x",
    });
  });

  it("a contradiction-level similarity is never treated as a duplicate", () => {
    const [a, b] = vecPair(0.6);
    const decision = classifyCandidate(a, undefined, [{ id: "x", embedding: b }]);
    expect(decision.mode).toBe("create");
  });
});
