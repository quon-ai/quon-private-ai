import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearDiagLog, diagAppend, getDiagReport } from "./diagLog";

/** Minimal localStorage for the node test env (the module writes synchronously -
 *  that synchronous write is the point: it must survive a process crash). */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

beforeEach(() => {
  const storage = fakeStorage();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal("navigator", {
    userAgent: "test-ua",
    language: "de-DE",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("diagAppend / getDiagReport", () => {
  it("records entries and renders an environment header + lines", () => {
    diagAppend("error: something broke @ chunk-abc.js:12");
    const report = getDiagReport();
    expect(report).toContain("ua: test-ua");
    expect(report).toContain("pwa: ja (standalone)");
    expect(report).toContain("error: something broke @ chunk-abc.js:12");
  });

  it("returns an empty report when nothing was recorded (option stays hidden)", () => {
    expect(getDiagReport()).toBe("");
  });

  it("caps the ring at 40 entries, dropping the oldest", () => {
    for (let i = 0; i < 50; i++) diagAppend(`e${i}`);
    const report = getDiagReport();
    expect(report).not.toContain("e0\n");
    expect(report).toContain("e49");
    // 40 entries max (8 header lines + separator + 40)
    expect(report.split("\n").length).toBeLessThanOrEqual(8 + 1 + 40);
  });

  it("truncates a single huge message instead of blowing the quota", () => {
    diagAppend("x".repeat(5000));
    expect(getDiagReport().length).toBeLessThan(1000);
  });

  it("collapses an immediately-repeated identical error into one line", () => {
    for (let i = 0; i < 10; i++) diagAppend("error: same render loop");
    const report = getDiagReport();
    const hits = report.split("error: same render loop").length - 1;
    expect(hits).toBe(1);
    expect(report).toContain("(wiederholt)");
  });

  it("clearDiagLog empties the buffer", () => {
    diagAppend("stale");
    clearDiagLog();
    expect(getDiagReport()).toBe("");
  });
});
