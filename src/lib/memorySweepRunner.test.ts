import { beforeEach, describe, expect, it, vi } from "vitest";

// Control runMemorySweep so no scrub/relay/embedder runs in the test. The mock
// lives in vi.hoisted so the (hoisted) vi.mock factory can reference it safely.
const h = vi.hoisted(() => {
  let resolveSweep!: (r: { analyzed: number; failed: number; suggestions: number }) => void;
  let lastOnProgress: ((label: string) => void) | undefined;
  const runMemorySweep = vi.fn((opts: { onProgress?: (l: string) => void }) => {
    lastOnProgress = opts.onProgress;
    return new Promise((res) => {
      resolveSweep = res as typeof resolveSweep;
    });
  });
  return {
    runMemorySweep,
    resolve: (r: { analyzed: number; failed: number; suggestions: number }) => resolveSweep(r),
    progress: (l: string) => lastOnProgress?.(l),
  };
});
vi.mock("./memoryExtract", () => ({ runMemorySweep: h.runMemorySweep }));

import { getSweepState, isSweeping, startSweep, subscribeSweep } from "./memorySweepRunner";

const baseOpts = { scope: "p1", model: "m", alwaysRedact: [], neverRedact: [] };

beforeEach(() => {
  h.runMemorySweep.mockClear();
});

describe("memorySweepRunner", () => {
  it("holds running state at module level (survives a component's unmount)", async () => {
    const notify = vi.fn();
    const unsub = subscribeSweep(notify);

    startSweep(baseOpts);
    expect(isSweeping("p1")).toBe(true);
    expect(getSweepState("p1")).toMatchObject({ running: true });
    expect(notify).toHaveBeenCalled();

    // Progress routes into the module state, not a component setter.
    h.progress("Analyzing 1 of 4 chats…");
    expect(getSweepState("p1").status).toBe("Analyzing 1 of 4 chats…");

    h.resolve({ analyzed: 4, failed: 0, suggestions: 3 });
    await vi.waitFor(() => expect(isSweeping("p1")).toBe(false));
    // The final summary persists so a re-entered screen still shows it. Wording is
    // catalog-driven (default German) - assert the count is present, not the language.
    expect(getSweepState("p1").status).toContain("3");
    unsub();
  });

  it("won't start a second concurrent sweep for the same scope", () => {
    startSweep(baseOpts);
    startSweep(baseOpts);
    expect(h.runMemorySweep).toHaveBeenCalledTimes(1);
    h.resolve({ analyzed: 1, failed: 0, suggestions: 0 });
  });

  it("scopes are independent (global vs a project)", () => {
    startSweep({ ...baseOpts, scope: undefined });
    expect(isSweeping(undefined)).toBe(true);
    expect(isSweeping("p1")).toBe(false);
    h.resolve({ analyzed: 0, failed: 0, suggestions: 0 });
  });

  it("idle scope returns a stable IDLE snapshot reference", () => {
    expect(getSweepState("never-run")).toBe(getSweepState("also-never"));
  });
});
