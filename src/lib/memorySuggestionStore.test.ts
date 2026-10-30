import { beforeEach, describe, expect, it } from "vitest";

import {
  addMemorySuggestions,
  countStaleSuggestions,
  createSuggestionId,
  deleteMemorySuggestion,
  getAllMemorySuggestions,
  getSweepCursor,
  MAX_SUGGESTIONS_PER_SCOPE,
  resetMemorySuggestions,
  resetSweepCursors,
  setSweepCursor,
  type MemorySuggestion,
} from "./memorySuggestionStore";

function sug(id: string, overrides: Partial<MemorySuggestion> = {}): MemorySuggestion {
  return {
    id,
    kind: "fact",
    text: `text ${id}`,
    tags: [],
    sourceSessionId: "chat_1",
    mode: "create",
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  resetMemorySuggestions();
  resetSweepCursors();
});

describe("memory suggestion queue", () => {
  it("adds, lists (newest first) and deletes suggestions", () => {
    addMemorySuggestions([sug("a", { createdAt: 1 }), sug("b", { createdAt: 2 })]);
    expect(getAllMemorySuggestions().map((s) => s.id)).toEqual(["b", "a"]);

    deleteMemorySuggestion("b");
    expect(getAllMemorySuggestions().map((s) => s.id)).toEqual(["a"]);
    deleteMemorySuggestion("nope"); // no-op
    expect(getAllMemorySuggestions()).toHaveLength(1);
  });

  it("re-adding the same id replaces instead of duplicating", () => {
    addMemorySuggestions([sug("a")]);
    addMemorySuggestions([sug("a", { text: "updated" })]);
    const all = getAllMemorySuggestions();
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe("updated");
  });

  it("generates unique-looking ids", () => {
    expect(createSuggestionId()).not.toBe(createSuggestionId());
    expect(createSuggestionId()).toMatch(/^sug_/);
  });
});

describe("sweep cursors", () => {
  it("stores the last processed message id per session", () => {
    expect(getSweepCursor("s1")).toBeUndefined();
    setSweepCursor("s1", 7);
    setSweepCursor("s2", 3);
    expect(getSweepCursor("s1")).toBe(7);
    expect(getSweepCursor("s2")).toBe(3);

    setSweepCursor("s1", 12);
    expect(getSweepCursor("s1")).toBe(12);
  });

  it("reset clears every cursor", () => {
    setSweepCursor("s1", 7);
    resetSweepCursors();
    expect(getSweepCursor("s1")).toBeUndefined();
  });
});

describe("queue cap (P5 — MAX_SUGGESTIONS_PER_SCOPE)", () => {
  it("drops the OLDEST plain 'create' suggestions first when a scope goes over the cap", () => {
    const list = Array.from({ length: MAX_SUGGESTIONS_PER_SCOPE + 5 }, (_, i) =>
      sug(`c${i}`, { createdAt: i, mode: "create" }),
    );
    addMemorySuggestions(list);
    const all = getAllMemorySuggestions();
    expect(all).toHaveLength(MAX_SUGGESTIONS_PER_SCOPE);
    // The 5 oldest (lowest createdAt) are gone; the 5 newest survive.
    expect(all.some((s) => s.id === "c0")).toBe(false);
    expect(all.some((s) => s.id === "c4")).toBe(false);
    expect(all.some((s) => s.id === `c${MAX_SUGGESTIONS_PER_SCOPE + 4}`)).toBe(true);
  });

  it("drops 'create' suggestions before ever touching 'update'/'merge' ones", () => {
    // One very old "update" suggestion plus enough "create"s to blow the cap —
    // the update must survive even though it's the single oldest item overall.
    const updateSug = sug("keep-me", { createdAt: -1, mode: "update", targetId: "t1" });
    const creates = Array.from({ length: MAX_SUGGESTIONS_PER_SCOPE + 3 }, (_, i) =>
      sug(`c${i}`, { createdAt: i, mode: "create" }),
    );
    addMemorySuggestions([updateSug, ...creates]);
    const all = getAllMemorySuggestions();
    expect(all).toHaveLength(MAX_SUGGESTIONS_PER_SCOPE);
    expect(all.some((s) => s.id === "keep-me")).toBe(true);
  });

  it("caps each scope independently", () => {
    const globalList = Array.from({ length: MAX_SUGGESTIONS_PER_SCOPE + 2 }, (_, i) =>
      sug(`g${i}`, { createdAt: i, mode: "create" }),
    );
    const projectList = [sug("p1", { createdAt: 0, mode: "create", projectId: "proj" })];
    addMemorySuggestions([...globalList, ...projectList]);
    expect(getAllMemorySuggestions().filter((s) => s.projectId === "proj")).toHaveLength(1);
    expect(getAllMemorySuggestions().filter((s) => !s.projectId)).toHaveLength(
      MAX_SUGGESTIONS_PER_SCOPE,
    );
  });
});

describe("countStaleSuggestions (P5)", () => {
  it("counts only suggestions older than the threshold, in scope", () => {
    const now = Date.now();
    const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60 * 1000;
    addMemorySuggestions([
      sug("old", { createdAt: now - THIRTY_ONE_DAYS }),
      sug("fresh", { createdAt: now }),
      sug("old-proj", { createdAt: now - THIRTY_ONE_DAYS, projectId: "p1" }),
    ]);
    expect(countStaleSuggestions(undefined)).toBe(1); // default 30 days, global scope only
    expect(countStaleSuggestions("p1")).toBe(1);
    // A threshold in the future: everything already created counts as stale.
    expect(countStaleSuggestions(undefined, -1)).toBe(2);
    // A very large threshold: nothing counts as stale yet.
    expect(countStaleSuggestions(undefined, 365)).toBe(0);
  });
});
