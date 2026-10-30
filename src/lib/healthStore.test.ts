import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHealthStore, MIN_RESUME_GAP_MS } from "./healthStore";
import type { HealthStatus } from "./quonApi";

/**
 * Feedback #87: the sidebar pill said „Geschützt" while the header badge was
 * red — each consumer ran its own poll with its own failure state. The store
 * guarantees ONE poll and ONE answer for everyone.
 */
const ok: HealthStatus = {
  status: "ok",
  version: "t",
  ner_ready: true,
  pii_ready: true,
} as HealthStatus;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createHealthStore", () => {
  it("polls once per interval no matter how many subscribers, and they all see the same snapshot", async () => {
    const check = vi.fn(async () => ok);
    const store = createHealthStore({ check, intervalMs: 1000, isHidden: () => false });
    const a = vi.fn();
    const b = vi.fn();
    const offA = store.subscribe(a);
    const offB = store.subscribe(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1); // one boot probe, not two
    expect(store.getSnapshot()).toEqual({ health: ok, failed: false });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(check).toHaveBeenCalledTimes(4); // boot + 3 ticks — six-per-second is gone
    offA();
    offB();
    await vi.advanceTimersByTimeAsync(5000);
    expect(check).toHaveBeenCalledTimes(4); // nobody listening ⇒ no polling
  });

  it("a failed foreground poll flips EVERY subscriber to offline at once (no split brain)", async () => {
    let fail = false;
    const check = vi.fn(async () => {
      if (fail) throw new Error("AbortError");
      return ok;
    });
    const store = createHealthStore({ check, intervalMs: 1000, isHidden: () => false });
    const seen: boolean[] = [];
    const seen2: boolean[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().failed));
    store.subscribe(() => seen2.push(store.getSnapshot().failed));
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot()).toEqual({ health: null, failed: true });
    expect(seen.at(-1)).toBe(true);
    expect(seen2.at(-1)).toBe(true);
  });

  it("forgives exactly one failure on the wake-up poll, and never flips while hidden", async () => {
    let fail = false;
    let hidden = false;
    const check = vi.fn(async () => {
      if (fail) throw new Error("AbortError");
      return ok;
    });
    const store = createHealthStore({ check, intervalMs: 1000, isHidden: () => hidden });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    hidden = true;
    fail = true;
    await vi.advanceTimersByTimeAsync(2000); // two failures in the background
    expect(store.getSnapshot().failed).toBe(false);
    hidden = false;
    store.onActive(); // resume poll: the one forgiven failure
    await vi.advanceTimersByTimeAsync(0);
    expect(store.getSnapshot().failed).toBe(false);
    await vi.advanceTimersByTimeAsync(1000); // the next ordinary poll fails too ⇒ offline
    expect(store.getSnapshot().failed).toBe(true);
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getSnapshot()).toEqual({ health: ok, failed: false });
  });

  it("focus/visibility right after boot do not re-probe — one boot probe, not three", async () => {
    const check = vi.fn(async () => ok);
    const store = createHealthStore({ check, intervalMs: 30_000, isHidden: () => false });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    store.onActive(); // window focus on load
    store.onActive(); // visibilitychange on load
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(MIN_RESUME_GAP_MS + 1);
    store.onActive(); // a real return from the background later ⇒ catch up at once
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("an unmount/remount within the gap (StrictMode, route swap) keeps the answer and does not re-probe", async () => {
    const check = vi.fn(async () => ok);
    const store = createHealthStore({ check, intervalMs: 30_000, isHidden: () => false });
    const off = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    off();
    const off2 = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toEqual({ health: ok, failed: false }); // not back to "loading"
    off2();
    await vi.advanceTimersByTimeAsync(MIN_RESUME_GAP_MS + 1);
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(2); // a later return probes afresh
  });

  it("a slow probe never piles up behind itself", async () => {
    let resolve: ((h: HealthStatus) => void) | null = null;
    const check = vi.fn(() => new Promise<HealthStatus>((r) => (resolve = r)));
    const store = createHealthStore({ check, intervalMs: 1000, isHidden: () => false });
    store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(3500); // three ticks while the first probe hangs
    expect(check).toHaveBeenCalledTimes(1);
    resolve!(ok);
    await vi.advanceTimersByTimeAsync(1000);
    expect(check).toHaveBeenCalledTimes(2);
  });
});
