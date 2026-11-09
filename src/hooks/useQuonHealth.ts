import { useSyncExternalStore } from "react";

import {
  checkHealth,
  deriveStatus,
  QUON_ENABLED,
  type HealthStatus,
  type QuonStatus,
} from "@/lib/quonApi";
import { createHealthStore, type HealthSnapshot } from "@/lib/healthStore";

export { shouldFlipToOffline } from "@/lib/healthStore";

const POLL_INTERVAL_MS = 30_000;

export interface QuonHealth {
  status: QuonStatus;
  health: HealthStatus | null;
}

// One store per app, created lazily so SSR (no document) never polls.
let store: ReturnType<typeof createHealthStore> | null = null;
function getStore() {
  if (store) return store;
  store = createHealthStore({
    check: checkHealth,
    intervalMs: POLL_INTERVAL_MS,
    isHidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
    onFailure: (consecutive, hidden, resume, e) => {
      // Do not swallow this. "Scrubber offline - Senden pausiert" appeared
      // briefly during a real 17-document send and could not be explained
      // afterwards, because an earlier version discarded the only evidence.
      console.warn(
        `[health] poll failed (consecutive=${consecutive}, hidden=${hidden}, resume=${resume})`,
        e,
      );
    },
  });
  if (typeof document !== "undefined") {
    // Background tabs throttle/suspend the poll, so a scrubber that's actually
    // fine can look offline until the next tick. Re-poll at once when the user
    // returns (visibility/focus) so the badge recovers immediately, not after 30s.
    const onActive = () => {
      if (document.visibilityState === "visible") store?.onActive();
    };
    document.addEventListener("visibilitychange", onActive);
    window.addEventListener("focus", onActive);
  }
  return store;
}

const SERVER_SNAPSHOT: HealthSnapshot = { health: null, failed: false };
const noopSubscribe = () => () => {};
const getServerSnapshot = () => SERVER_SNAPSHOT;

/**
 * The scrubber's traffic-light status - the same value in every component.
 *
 * Backed by one shared poll (`healthStore.ts`): however many pills, badges and
 * screens read it, there is one `/health` request per 30 s and one answer, so
 * the sidebar and the header can never disagree. Runs in the
 * browser only; with QUON disabled via env it reports "offline" without polling.
 */
export function useQuonHealth(): QuonHealth {
  const snap = useSyncExternalStore(
    QUON_ENABLED ? getStore().subscribe : noopSubscribe,
    QUON_ENABLED ? getStore().getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
  return {
    status: QUON_ENABLED ? deriveStatus(snap.health, snap.failed) : "offline",
    health: snap.health,
  };
}
