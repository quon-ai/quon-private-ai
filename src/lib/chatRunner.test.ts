import { beforeEach, describe, expect, it } from "vitest";

import { abortRun, beginRun, endRun, getRun, isGenerating, resetRuns } from "./chatRunner";

beforeEach(() => resetRuns());

describe("chatRunner registry", () => {
  it("tracks and clears a run by session", () => {
    beginRun("s1", { controller: new AbortController(), assistantId: 5 });
    expect(isGenerating("s1")).toBe(true);
    expect(getRun("s1")?.assistantId).toBe(5);
    endRun("s1");
    expect(isGenerating("s1")).toBe(false);
    expect(getRun("s1")).toBeUndefined();
  });

  it("keeps per-session controllers separate — aborting one leaves the other running", () => {
    const a = new AbortController();
    const b = new AbortController();
    beginRun("A", { controller: a, assistantId: 1 });
    beginRun("B", { controller: b, assistantId: 2 });
    abortRun("A");
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(false);
    expect(isGenerating("B")).toBe(true); // B's background run survives
  });

  it("tolerates null/undefined session ids", () => {
    expect(isGenerating(null)).toBe(false);
    expect(getRun(undefined)).toBeUndefined();
    expect(() => abortRun(null)).not.toThrow();
  });
});
