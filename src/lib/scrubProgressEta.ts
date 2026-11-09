/**
 * Pure presentation logic for the send-path scrub progress bar
 * (ScreenChat.tsx's LoadingIndicator, driven by scrubChunked.ts's onProgress).
 *
 * Why this exists: a 200k-char / 10-document attachment takes 50-60s to scrub
 * (~25 pieces at SCRUB_CONCURRENCY=6, scrubChunked.ts). The raw onProgress
 * callback only ticks a handful of times over that minute - once per piece,
 * and pieces complete in CONCURRENCY-sized bursts, so the raw (done/total)
 * sits static for many seconds between bursts. That reads as "stuck", not
 * "the core of the product is working". This module turns the sparse
 * (done, total) samples into:
 *   - a continuously-creeping fraction for the bar (interpolateScrubFraction)
 *   - a reveal gate, so a fast scrub shows nothing (shouldRevealProgress)
 *   - elapsed time (formatElapsed) - not a prediction; see its note for why
 *
 * No timers or DOM here - the component owns a tick loop and feeds in `now`
 * (its own clock reading), so every function here is a pure, synchronous,
 * trivially-testable projection from timestamps to numbers.
 */

/** A progress sample: `done` of `total` units finished, as of `updatedAt`
 *  (same clock as `startedAt`/`now` - callers use performance.now()). */
export interface ScrubProgressSample {
  done: number;
  total: number;
  updatedAt: number;
}

const MIN_ELAPSED_MS = 1; // guards a divide-by-zero on a same-tick update

/** How far past the last CONFIRMED unit the bar may creep. Just under 1, so the
 *  bar never implies a unit finished before onProgress said so - and so a real
 *  update can only ever move it forward. See interpolateScrubFraction. */
const MAX_UNCONFIRMED_UNITS = 0.95;

/**
 * 0..1 fraction to render in the bar. Pieces land in CONCURRENCY-sized bursts
 * (scrubChunked.ts), so the raw sample can sit unchanged for many seconds;
 * between real onProgress events the bar creeps forward at the throughput
 * observed so far, so the wait always looks alive.
 *
 * Two guarantees, both load-bearing - see the cap below for what happens
 * without them: the rendered fraction is **monotonic** (a real update can only
 * move it forward), and it reaches 1 only on a real `done >= total`.
 */
export function interpolateScrubFraction(
  startedAt: number,
  sample: ScrubProgressSample,
  now: number,
  /** How many units can be in flight at once (SCRUB_CONCURRENCY). The creep is
   *  allowed to cover the wave that is genuinely running - otherwise a 6-piece
   *  wave taking 18s leaves the bar frozen at one unit for those 18s, which is
   *  the "is it stuck?" feeling this module exists to remove. Defaults to 1, the
   *  conservative single-unit behaviour. */
  inFlight = 1,
): number {
  const { done, total, updatedAt } = sample;
  if (total <= 0) return 0;
  if (done >= total) return 1;
  if (done <= 0) {
    // No unit has finished yet - nothing to extrapolate a rate from. Ease
    // gently toward (never past) a sliver of the first unit so the bar
    // still reads as alive during this first, unmeasured stretch (it's
    // normally brief: the typed message alone is one unit and usually
    // resolves in well under a second).
    const elapsed = Math.max(0, now - startedAt);
    const eased = 1 - Math.exp(-elapsed / 4000); // asymptotic, ~63% by 4s
    return Math.min(eased * 0.6, 0.6) / total;
  }
  const rate = done / Math.max(MIN_ELAPSED_MS, updatedAt - startedAt); // units per ms
  const sinceUpdate = Math.max(0, now - updatedAt);
  // Never extrapolate past the wave that is actually in flight.
  //
  // Without this the bar snaps BACKWARD, badly. The rate is an average over the
  // whole wave, and the wave's first units are the fast ones (message, rag,
  // instruction: one /scrub call each, well under a second) while the rest are
  // attachment pieces that land in CONCURRENCY-sized bursts many seconds apart.
  // So the early rate is wildly optimistic: simulating a real 200k/25-piece
  // scrub, the bar reached 90% at t=12s of a 54s wait and then fell back to
  // 27% when the first burst actually landed - four such reversals in one send.
  // A bar that promises completion and then reneges is worse than no bar.
  //
  // Keeping the creep inside the current unit makes it impossible to claim
  // progress that hasn't happened, so the fraction is monotonic by construction.
  // Asymptotic rather than a hard clamp: `M * (1 - e^(-x/M))` starts with slope
  // exactly 1, so early on the bar advances at the genuinely observed rate, then
  // approaches - but never reaches - the headroom. A hard clamp would freeze the
  // bar for the rest of a burst gap, which is the "looks stalled" complaint this
  // whole module exists to fix.
  //
  // Headroom = the in-flight wave, never more than what is actually outstanding.
  // Clamping to `total - done` is what keeps the last, partial wave honest: with
  // one piece left the headroom is one piece, so the bar can't run ahead of it.
  const headroom = Math.min(Math.max(1, inFlight), total - done) * MAX_UNCONFIRMED_UNITS;
  const creep = rate * sinceUpdate;
  const projected = done + headroom * (1 - Math.exp(-creep / headroom));
  const ceiling = total - 0.02; // never claim "done" via extrapolation alone
  return Math.min(projected, ceiling) / total;
}

/** Don't show progress UI at all until the work has proven it is slow enough to
 *  need it. A bar that flashes up and vanishes is worse than no bar, and this is
 *  what makes the whole indicator independent of how fast the scrubber is: a
 *  scrub that finishes inside this window never renders one. */
export const PROGRESS_REVEAL_MS = 2000;

/** True once a wave has run long enough that showing progress helps.
 *  Monotonic in `now`, so it can't flicker. */
export function shouldRevealProgress(startedAt: number, now: number): boolean {
  return now - startedAt >= PROGRESS_REVEAL_MS;
}

/**
 * Elapsed time, as `m:ss`.
 *
 * This replaced a remaining-time ESTIMATE, deliberately. Three successive
 * attempts to make a prediction behave each shipped a new artefact - it decayed
 * to "0s" at 55%, it swung 0s->1:10, and after being anchored to elapsed time it
 * still wandered. Instrumented against a fully deterministic scrub (fixed
 * per-piece latency, no provider variance) it went ~10s -> ~15s -> ~10s, and a
 * real 17-document send was reported as 20s -> 40s -> 1:00 -> 25s.
 *
 * That is not a tuning problem. Per-piece latency varies by retry and provider,
 * so any point estimate wanders, and a duration that moves in both directions
 * gives the user nothing to decide on. Elapsed time is monotonic, always true,
 * needs no tuning at any scrubber speed, and combined with the percentage it
 * lets the reader extrapolate as well as we could have.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function scrubWaveTotal(opts: {
  attachmentPieces: number;
  hasRag: boolean;
  hasInstruction: boolean;
}): number {
  // The typed message is always scrubbed - it's the one input send() can't
  // skip - so it always counts as one unit of the wave.
  return (
    Math.max(0, opts.attachmentPieces) + (opts.hasRag ? 1 : 0) + (opts.hasInstruction ? 1 : 0) + 1
  );
}

/** No confirmed progress for this long means something is wrong, even before a
 *  retry fires: the per-request timeout is 180s, so the first failure isn't
 *  reported for three minutes. Waiting silently through that is what made a
 *  stalled send read as a dead UI. */
export const STALL_AFTER_MS = 45_000;

/** True when the last confirmed unit is old enough that the wait should be
 *  called out rather than left to a ticking clock. */
export function isStalled(lastProgressAt: number, now: number): boolean {
  return now - lastProgressAt >= STALL_AFTER_MS;
}

/** Throughput floor for the small-scrub estimate, chars/second.
 *
 *  Deliberately conservative: measured scrub throughput is ~2900 chars/s on an
 *  M-series laptop and lower on the production box with the cross-check on.
 *  Underestimating means the bar reaches its ceiling a little early and then
 *  jumps to done - mildly optimistic. Overestimating means it crawls and the
 *  user reads a stall. Of the two lies the early one is smaller. */
export const SMALL_SCRUB_CHARS_PER_S = 1000;

/** Percent ceiling for the estimate - the bar never claims what it can't know. */
export const SMALL_SCRUB_CEILING = 0.97;

/** Time-based fraction for scrubs too small for real progress ticks.
 *
 *  A <=SCRUB_CONCURRENCY-piece scrub lands in a single burst, so there is no
 *  intermediate truth to interpolate - the previous attempt at a percent here
 *  fabricated one and sat at "97%" for 26 seconds (see the LoadingIndicator
 *  comment), which is why small scrubs fell back to a pulse. This estimator is
 *  honest about being an ESTIMATE: it is driven by the attachment's real size
 *  and a measured throughput floor, rises smoothly toward 95% at the expected
 *  duration, keeps creeping asymptotically past it rather than freezing, and
 *  never exceeds the ceiling. Real piece completions still dominate: the
 *  fraction is never below attachDone/attachTotal.
 */
export function estimateSmallScrubFraction(
  startedAt: number,
  now: number,
  attachChars: number,
  attachDone: number,
  attachTotal: number,
): number {
  const expectedMs = Math.max(2000, (attachChars / SMALL_SCRUB_CHARS_PER_S) * 1000);
  const elapsed = Math.max(0, now - startedAt);
  // 1 - e^-3 ~ 0.95 at expectedMs; keeps moving afterwards, never reaches 1.
  const timeEst = (1 - Math.exp((-3 * elapsed) / expectedMs)) * SMALL_SCRUB_CEILING;
  const tickFloor = attachTotal > 0 ? attachDone / attachTotal : 0;
  return Math.min(SMALL_SCRUB_CEILING, Math.max(timeEst, tickFloor));
}
