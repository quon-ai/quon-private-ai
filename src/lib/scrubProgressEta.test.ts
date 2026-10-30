import { describe, expect, it } from "vitest";

import {
  PROGRESS_REVEAL_MS,
  estimateSmallScrubFraction,
  STALL_AFTER_MS,
  isStalled,
  formatElapsed,
  interpolateScrubFraction,
  scrubWaveTotal,
  shouldRevealProgress,
} from "@/lib/scrubProgressEta";

describe("interpolateScrubFraction", () => {
  it("returns 0 for a degenerate total", () => {
    expect(interpolateScrubFraction(0, { done: 0, total: 0, updatedAt: 0 }, 100)).toBe(0);
  });

  it("returns 1 once done reaches total, regardless of elapsed time", () => {
    expect(interpolateScrubFraction(0, { done: 10, total: 10, updatedAt: 5000 }, 5000)).toBe(1);
    expect(interpolateScrubFraction(0, { done: 12, total: 10, updatedAt: 5000 }, 5000)).toBe(1);
  });

  it("creeps forward from 0 before the first unit finishes, but stays small", () => {
    const start = 0;
    const total = 26;
    const early = interpolateScrubFraction(start, { done: 0, total, updatedAt: 0 }, 500);
    const later = interpolateScrubFraction(start, { done: 0, total, updatedAt: 0 }, 3000);
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early);
    // Never implies even one whole unit is done before onProgress says so.
    expect(later).toBeLessThan(1 / total);
  });

  it("extrapolates forward between real updates using the observed rate", () => {
    // 6 of 26 done by t=12000ms (one concurrency batch in, matches the
    // documented ~12s/batch under load).
    const sample = { done: 6, total: 26, updatedAt: 12000 };
    const atUpdate = interpolateScrubFraction(0, sample, 12000);
    const midway = interpolateScrubFraction(0, sample, 18000);
    const laterStill = interpolateScrubFraction(0, sample, 23000);
    expect(atUpdate).toBeCloseTo(6 / 26, 5);
    expect(midway).toBeGreaterThan(atUpdate);
    expect(laterStill).toBeGreaterThan(midway);
  });

  it("never creeps more than one unconfirmed unit past the last real update", () => {
    // Regression: the bar used to extrapolate unbounded at the observed rate,
    // so a long gap drove it to ~100% while most pieces were still unscrubbed.
    const sample = { done: 6, total: 26, updatedAt: 12000 };
    const wayLater = interpolateScrubFraction(0, sample, 5_000_000);
    expect(wayLater).toBeLessThan(7 / 26);
    expect(wayLater).toBeGreaterThan(6 / 26);
  });

  it("keeps inching forward during a long gap instead of freezing", () => {
    // The counterpart to the cap: bounded, but never actually still — a frozen
    // bar is the "is it stuck?" feeling this module exists to remove.
    const sample = { done: 6, total: 26, updatedAt: 12000 };
    const a = interpolateScrubFraction(0, sample, 20000);
    const b = interpolateScrubFraction(0, sample, 30000);
    const c = interpolateScrubFraction(0, sample, 60000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(7 / 26);
  });

  it("never moves backward across a realistic burst-y scrub", () => {
    // THE bug this module nearly shipped with. Every other monotonicity check
    // here holds `sample` fixed and only advances `now` — which is precisely
    // the case that CAN'T catch it. The reversal only appears when the sample
    // also advances: the wave's fast units (message/rag/instruction) set an
    // optimistic average rate, then the attachment pieces land in bursts many
    // seconds apart. Measured before the fix: 90.4% at t=12s, falling back to
    // 26.9% — four reversals in a single 54s send.
    const total = 26;
    const events: Array<[number, number]> = [
      [500, 1], // typed message
      [12000, 7], // first concurrency burst of attachment pieces
      [24000, 13],
      [36000, 19],
      [48000, 25],
      [54000, 26],
    ];
    let sample = { done: 0, total, updatedAt: 0 };
    let prev = 0;
    for (let now = 0; now <= 56000; now += 250) {
      for (const [at, done] of events) if (now >= at) sample = { done, total, updatedAt: at };
      const f = interpolateScrubFraction(0, sample, now);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-9);
      // …and it must never claim near-completion while pieces are outstanding.
      if (sample.done < total) expect(f).toBeLessThan(1);
      prev = f;
    }
    expect(prev).toBe(1);
  });

  it("is monotonically non-decreasing over time for a fixed sample", () => {
    const sample = { done: 3, total: 26, updatedAt: 1000 };
    let prev = interpolateScrubFraction(0, sample, 1000);
    for (const now of [1500, 2000, 4000, 8000, 20000]) {
      const next = interpolateScrubFraction(0, sample, now);
      expect(next).toBeGreaterThanOrEqual(prev);
      prev = next;
    }
  });
});

describe("formatElapsed", () => {
  // A clock, not a prediction — so the only properties worth asserting are that
  // it reads correctly and only ever counts up. It replaced a remaining-time
  // estimate that wandered in both directions on every tuning attempted; see the
  // note on formatElapsed for the measurements.
  it("formats as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(3_400)).toBe("0:03");
    expect(formatElapsed(59_999)).toBe("0:59");
    expect(formatElapsed(60_000)).toBe("1:00");
    expect(formatElapsed(75_000)).toBe("1:15");
  });

  it("never goes backwards as time advances", () => {
    const toSec = (v: string) => Number(v.split(":")[0]) * 60 + Number(v.split(":")[1]);
    let prev = -1;
    for (let ms = 0; ms <= 120_000; ms += 500) {
      const secs = toSec(formatElapsed(ms));
      expect(secs).toBeGreaterThanOrEqual(prev);
      prev = secs;
    }
  });

  it("clamps a negative input rather than rendering nonsense", () => {
    expect(formatElapsed(-500)).toBe("0:00");
  });
});

describe("shouldRevealProgress", () => {
  it("hides progress for work that finishes quickly", () => {
    expect(shouldRevealProgress(0, 0)).toBe(false);
    expect(shouldRevealProgress(0, 1_500)).toBe(false);
  });

  it("reveals once the wait is long enough to be worth narrating", () => {
    expect(shouldRevealProgress(0, PROGRESS_REVEAL_MS)).toBe(true);
    expect(shouldRevealProgress(0, 30_000)).toBe(true);
  });

  it("is monotonic, so the bar cannot flicker", () => {
    let seenTrue = false;
    for (let now = 0; now <= 10_000; now += 100) {
      const r = shouldRevealProgress(0, now);
      if (seenTrue) expect(r).toBe(true); // never goes back to hidden
      if (r) seenTrue = true;
    }
    expect(seenTrue).toBe(true);
  });
});

describe("scrubWaveTotal", () => {
  it("always counts the typed message as one unit", () => {
    expect(scrubWaveTotal({ attachmentPieces: 0, hasRag: false, hasInstruction: false })).toBe(1);
  });

  it("adds one unit each for rag and instruction when present", () => {
    expect(scrubWaveTotal({ attachmentPieces: 0, hasRag: true, hasInstruction: true })).toBe(3);
  });

  it("adds the full attachment piece count", () => {
    expect(scrubWaveTotal({ attachmentPieces: 25, hasRag: true, hasInstruction: false })).toBe(
      25 + 1 + 1,
    );
  });

  it("clamps a negative piece count to 0", () => {
    expect(scrubWaveTotal({ attachmentPieces: -3, hasRag: false, hasInstruction: false })).toBe(1);
  });
});

describe("isStalled", () => {
  // The earlier of the two "something is wrong" signals. A retry is only reported
  // after the 180s per-request timeout expires, so waiting for one means three
  // silent minutes — which is what made a stalled send read as a dead UI.
  it("is false while units are still landing", () => {
    expect(isStalled(0, 1_000)).toBe(false);
    expect(isStalled(0, STALL_AFTER_MS - 1)).toBe(false);
  });

  it("becomes true once nothing has been confirmed for long enough", () => {
    expect(isStalled(0, STALL_AFTER_MS)).toBe(true);
    expect(isStalled(0, 200_000)).toBe(true);
  });

  it("resets when a unit lands — it measures the GAP, not total elapsed", () => {
    // A long send that is making steady progress must not be called stalled.
    expect(isStalled(300_000, 310_000)).toBe(false);
  });

  it("fires well before the first retry could possibly be reported", () => {
    // 180s timeout × attempt 1 — the user must hear about it long before that.
    expect(STALL_AFTER_MS).toBeLessThan(180_000);
  });
});

describe("estimateSmallScrubFraction", () => {
  it("rises monotonically toward ~95% at the expected duration", () => {
    const chars = 10_000; // expected 10s at the 1000 chars/s floor
    let prev = -1;
    for (const ms of [0, 1000, 2500, 5000, 7500, 10_000]) {
      const f = estimateSmallScrubFraction(0, ms, chars, 0, 2);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(estimateSmallScrubFraction(0, 10_000, chars, 0, 2)).toBeGreaterThan(0.9);
  });

  it("never exceeds the ceiling, even far past the expectation", () => {
    expect(estimateSmallScrubFraction(0, 600_000, 1_000, 0, 1)).toBeLessThanOrEqual(0.97);
  });

  it("a real piece completion is a floor the estimate cannot dip under", () => {
    // 1 of 2 pieces landed at t=1s of an expected 20s: time alone says ~13%,
    // the tick says 50% — the tick wins.
    expect(estimateSmallScrubFraction(0, 1000, 20_000, 1, 2)).toBeGreaterThanOrEqual(0.5);
  });

  it("tiny attachments get the 2s minimum expectation, not a instant jump", () => {
    expect(estimateSmallScrubFraction(0, 200, 100, 0, 1)).toBeLessThan(0.3);
  });
});
