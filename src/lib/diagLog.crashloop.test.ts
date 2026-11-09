import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The crash-loop counter behind safe mode (deviceClass.ts).
 *
 * An iPhone crash loop has exactly this shape: a boot, the page killed within
 * seconds, a boot, killed again - for days. Each boot must know that it is the
 * Nth in a row, and a session that lives must reset the count.
 * installDiagCapture() is once-per-module, so every case imports a fresh module.
 */

const ALIVE_KEY = "quon_diag_alive_v1";
const LOOP_KEY = "quon_diag_crashloop_v1";
const LOG_KEY = "quon_diag_v1";

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

let storage: Storage;

beforeEach(() => {
  vi.useFakeTimers();
  storage = fakeStorage();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", {
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
    innerWidth: 390,
    innerHeight: 844,
  });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  vi.stubGlobal("navigator", { userAgent: "test", language: "de-DE", onLine: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

/** A previous session that started at `start` and was last seen alive at `last`. */
function previousSession(start: number, last: number) {
  storage.setItem(ALIVE_KEY, `${start}|${last}`);
}

async function boot() {
  vi.resetModules();
  const mod = await import("./diagLog");
  mod.installDiagCapture();
  return mod;
}

describe("crash-loop counter", () => {
  it("a clean previous session -> 0", async () => {
    const mod = await boot();
    expect(mod.crashLoopCount()).toBe(0);
    expect(storage.getItem(LOOP_KEY)).toBeNull();
  });

  it("one short unclean session -> 1 (not yet a loop: could be a force-close)", async () => {
    previousSession(1_000_000, 1_000_000 + 12_000);
    const mod = await boot();
    expect(mod.crashLoopCount()).toBe(1);
    expect(storage.getItem(LOG_KEY)).not.toContain("crash loop");
  });

  it("the second short unclean boot in a row -> 2, and the log says safe mode", async () => {
    storage.setItem(LOOP_KEY, "1");
    previousSession(2_000_000, 2_000_000 + 15_000);
    const mod = await boot();
    expect(mod.crashLoopCount()).toBe(2);
    expect(storage.getItem(LOG_KEY)).toContain("crash loop: 2");
    expect(storage.getItem(LOG_KEY)).toContain("Schonmodus");
  });

  it("an unclean session that LIVED (past 90 s) breaks the loop -> 0", async () => {
    storage.setItem(LOOP_KEY, "3");
    previousSession(3_000_000, 3_000_000 + 10 * 60_000);
    const mod = await boot();
    expect(mod.crashLoopCount()).toBe(0);
    expect(storage.getItem(LOOP_KEY)).toBeNull();
  });

  it("the running session resets the count once it has lived past the short line", async () => {
    storage.setItem(LOOP_KEY, "1");
    previousSession(4_000_000, 4_000_000 + 5_000);
    const mod = await boot();
    expect(mod.crashLoopCount()).toBe(2);
    // Heartbeats tick; before 90 s the count stands...
    vi.advanceTimersByTime(60_000);
    expect(storage.getItem(LOOP_KEY)).toBe("2");
    // ...after it, this boot proved stable and the next boot starts clean.
    vi.advanceTimersByTime(40_000);
    expect(storage.getItem(LOOP_KEY)).toBeNull();
  });

  it("the heartbeat is frequent enough to measure a session that dies at boot", async () => {
    const mod = await boot();
    void mod;
    vi.advanceTimersByTime(5_000);
    const alive = storage.getItem(ALIVE_KEY) ?? "";
    const [start, last] = alive.split("|").map(Number);
    expect(last - start).toBeGreaterThanOrEqual(5_000);
    expect(last - start).toBeLessThan(30_000);
  });
});
