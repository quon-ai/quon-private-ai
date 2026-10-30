import { beforeEach, describe, expect, it } from "vitest";

import { onSyncCursorsReset, resetAllSyncCursors, SYNC_CURSOR_PREFIX } from "./syncCursor";

beforeEach(() => localStorage.clear());

describe("resetAllSyncCursors", () => {
  it("removes every cursor and nothing else, and reports how many there were", () => {
    localStorage.setItem(`${SYNC_CURSOR_PREFIX}chat_v2`, "52130");
    localStorage.setItem(`${SYNC_CURSOR_PREFIX}projects_v2`, "52130");
    localStorage.setItem("quon_other", "keep");
    expect(resetAllSyncCursors()).toBe(2);
    expect(localStorage.getItem(`${SYNC_CURSOR_PREFIX}chat_v2`)).toBeNull();
    expect(localStorage.getItem("quon_other")).toBe("keep");
    expect(resetAllSyncCursors()).toBe(0);
  });

  it("notifies listeners only when a cursor was actually removed", () => {
    const seen: number[] = [];
    const off = onSyncCursorsReset(() => seen.push(1));
    expect(resetAllSyncCursors()).toBe(0);
    expect(seen).toEqual([]); // a genuine first run stays silent
    localStorage.setItem(`${SYNC_CURSOR_PREFIX}projects_v2`, "52130");
    expect(resetAllSyncCursors()).toBe(1);
    expect(seen).toEqual([1]);
    off();
    localStorage.setItem(`${SYNC_CURSOR_PREFIX}projects_v2`, "1");
    resetAllSyncCursors();
    expect(seen).toEqual([1]); // unsubscribed
  });
});
