/**
 * ONE health poll for the whole app.
 *
 * `useQuonHealth` used to own its state per component: every mounted consumer
 * (sidebar pill, header badge, the chat screen, settings cards) ran its own
 * 30 s poll with its own failure counter. Two consequences, both seen in the
 * field (feedback #87, 2026-10-10): the sidebar said „Geschützt" while the
 * header badge was red at the same moment — one instance's probe had timed
 * out on a slow mobile radio, another's had not even returned yet — and the
 * backend saw six `/health` requests in the same second from one client.
 *
 * The store is framework-free so the invariant is unit-tested with fake
 * timers: N subscribers ⇒ one request per interval, and every subscriber sees
 * the same snapshot. The flip rules (`shouldFlipToOffline`) are unchanged.
 */

import type { HealthStatus } from "./quonApi";

export interface HealthSnapshot {
  health: HealthStatus | null;
  failed: boolean;
}

/**
 * Decide whether a failed health poll should flip the badge to offline.
 *
 * Forgives exactly ONE failure: the stale catch-up poll fired immediately after
 * the tab resumes from background (mobile suspends JS entirely, so a real,
 * already-recovered scrubber can still look briefly offline on resume — the
 * 2026-07-02 "health fix"). It must NOT forgive a failure on a normal foreground
 * poll: that grace period used to apply unconditionally, so a genuine outage on
 * an already-open tab could leave the badge green for up to two poll intervals
 * (report #5, 2026-07-15).
 */
export function shouldFlipToOffline(params: {
  visibilityHidden: boolean;
  /** True for the one poll fired by the visibility/focus "resume" listener. */
  isResumePoll: boolean;
  everSucceeded: boolean;
  consecutiveFails: number;
}): boolean {
  const { visibilityHidden, isResumePoll, everSucceeded, consecutiveFails } = params;
  if (visibilityHidden) return false; // ignore while backgrounded — see above
  if (isResumePoll && everSucceeded && consecutiveFails < 2) return false; // forgive one stale wake-up poll
  return true;
}

export interface HealthStoreDeps {
  check: () => Promise<HealthStatus>;
  intervalMs: number;
  /** `document.visibilityState === "hidden"` — injectable for tests. */
  isHidden: () => boolean;
  /** Report a failed poll (console.warn in the app; silent in tests). */
  onFailure?: (consecutiveFails: number, hidden: boolean, resume: boolean, err: unknown) => void;
}

export interface HealthStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => HealthSnapshot;
  /** The tab became visible / focused: poll at once with the one-failure grace. */
  onActive: () => void;
}

const INITIAL: HealthSnapshot = { health: null, failed: false };

/** A resume re-poll fired this soon after the last probe has nothing to catch
 *  up on — `focus` and `visibilitychange` both fire on a fresh boot, and that
 *  turned one boot probe into three. */
export const MIN_RESUME_GAP_MS = 5_000;

export function createHealthStore(deps: HealthStoreDeps): HealthStore {
  let snapshot: HealthSnapshot = INITIAL;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let consecutiveFails = 0;
  let everSucceeded = false;
  let resumeGrace = false;
  let inFlight = false;
  let lastPollAt = -Infinity;

  const emit = (next: HealthSnapshot) => {
    if (next.health === snapshot.health && next.failed === snapshot.failed) return;
    snapshot = next;
    for (const l of Array.from(listeners)) l();
  };

  async function poll() {
    if (inFlight) return; // a slow probe must not pile up behind itself
    const isResumePoll = resumeGrace;
    resumeGrace = false;
    inFlight = true;
    lastPollAt = Date.now();
    try {
      const result = await deps.check();
      consecutiveFails = 0;
      everSucceeded = true;
      emit({ health: result, failed: false });
    } catch (e) {
      consecutiveFails += 1;
      const hidden = deps.isHidden();
      deps.onFailure?.(consecutiveFails, hidden, isResumePoll, e);
      if (
        shouldFlipToOffline({
          visibilityHidden: hidden,
          isResumePoll,
          everSucceeded,
          consecutiveFails,
        })
      ) {
        emit({ health: null, failed: true });
      }
    } finally {
      inFlight = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => void poll(), deps.intervalMs);
    // A remount right after an unmount (StrictMode's double effect in dev, a
    // route transition that swaps the shell) keeps the answer it already has —
    // re-probing on every remount was the other source of the boot burst.
    if (Date.now() - lastPollAt >= MIN_RESUME_GAP_MS) void poll();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
    resumeGrace = false;
    // The last snapshot and the failure counters stay: they are still the
    // best knowledge there is, and the next subscriber gets it instantly.
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
    onActive() {
      if (!timer) return;
      if (Date.now() - lastPollAt < MIN_RESUME_GAP_MS) return; // just probed — nothing to catch up
      consecutiveFails = 0;
      resumeGrace = true;
      void poll();
    },
  };
}
