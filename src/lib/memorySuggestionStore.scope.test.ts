import { beforeEach, describe, expect, it } from "vitest";

import {
  addMemorySuggestions,
  countSuggestionsInScope,
  createSuggestionId,
  resetMemorySuggestions,
  type MemorySuggestion,
} from "./memorySuggestionStore";

/**
 * Reported 2026-08-04: a sweep reported "29 suggestions to review", the user
 * pressed the only button in reach, and the message became "Nothing new to
 * learn". The suggestions were never lost — the count that tells the UI they
 * are still waiting simply did not exist. This pins that count.
 */

const sug = (over: Partial<MemorySuggestion> = {}): MemorySuggestion =>
  ({
    id: createSuggestionId(),
    kind: "fact",
    text: "Arbeitet bei Elbwerke",
    mode: "create",
    createdAt: Date.now(),
    ...over,
  }) as MemorySuggestion;

beforeEach(() => resetMemorySuggestions());

describe("countSuggestionsInScope", () => {
  it("counts what a scope's own sweep produced, and nothing else", () => {
    addMemorySuggestions([
      sug({ projectId: "finanzen", sourceSessionId: "s1" }),
      sug({ projectId: "finanzen", sourceSessionId: "s2" }),
      sug({ projectId: "gesundheit", sourceSessionId: "s3" }),
      sug({ sourceSessionId: "s4" }), // global
    ]);
    expect(countSuggestionsInScope("finanzen")).toBe(2);
    expect(countSuggestionsInScope("gesundheit")).toBe(1);
    // Strict, like the sweep: the global pool is NOT "everything".
    expect(countSuggestionsInScope(undefined)).toBe(1);
  });

  it("is zero for a scope that has never been swept", () => {
    expect(countSuggestionsInScope("leer")).toBe(0);
  });

  it("attributes a suggestion to the sweep that produced it", () => {
    // Otherwise both "Learn from…" buttons advertise the same queue and the
    // documents button takes credit for facts mined from chats.
    addMemorySuggestions([
      sug({ projectId: "p", sourceSessionId: "s1" }),
      sug({ projectId: "p", sourceDocId: "d1" }),
      sug({ projectId: "p", sourceDocId: "d2" }),
      sug({ projectId: "p" }), // paste-distilled: belongs to no sweep
    ]);
    expect(countSuggestionsInScope("p", "chats")).toBe(1);
    expect(countSuggestionsInScope("p", "documents")).toBe(2);
    // Without a kind, everything in scope — including the manual one.
    expect(countSuggestionsInScope("p")).toBe(4);
  });

  it("drops back to zero as the queue is worked off", () => {
    addMemorySuggestions([
      sug({ projectId: "p", sourceSessionId: "s1" }),
      sug({ projectId: "p", sourceSessionId: "s2" }),
    ]);
    expect(countSuggestionsInScope("p")).toBe(2);
    resetMemorySuggestions();
    expect(countSuggestionsInScope("p")).toBe(0);
  });
});
