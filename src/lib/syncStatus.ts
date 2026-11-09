/**
 * Observable status for the zero-knowledge collection sync.
 *
 * Why this exists: sync used to be completely invisible. `createCollectionSync`
 * returned `{start, stop}` and nothing else - no busy flag, no counters, no
 * error state - so a push that failed was indistinguishable from a push that
 * never needed to happen. The failure mode that motivated this: the relay
 * rejects a blob over 4 MiB with a *whole-batch* 413, and the client caught it
 * with a bare `catch` that re-queued everything. One oversized chat therefore
 * wedged its entire collection forever, retrying the same doomed payload, with
 * no console line and no UI. Users experienced that as "sync is slow".
 *
 * Two things are reported here, and they are deliberately different in kind:
 *  - **progress** (`busy` / `done` / `total`) - transient, answers "is it still
 *    running?" during the long initial reconcile push.
 *  - **blocked** - durable, answers "this will never sync until you act". A
 *    blocked blob is not retried (that was the wedge); it is surfaced instead.
 *
 * Module-level snapshot + subscribe, matching `originalSync.ts` - the snapshot
 * reference is stable between changes so `useSyncExternalStore` doesn't loop.
 */

/** "toobig": ciphertext exceeds the relay's per-blob cap; pushing it again can
 *  only fail the same way, so it is quarantined rather than retried. */
export type SyncBlockReason = "toobig";

export interface SyncBlocked {
  collection: string;
  id: string;
  reason: SyncBlockReason;
  /** Decoded ciphertext size, for a message that names the actual number. */
  bytes: number;
}

export interface SyncStatus {
  /** A push or pull is in flight somewhere. */
  busy: boolean;
  /** Aggregate push progress across collections (0/0 when nothing is pushing). */
  done: number;
  total: number;
  /** Last time any collection completed a push without error. */
  lastSyncedAt: number | null;
  /** Blobs that can never sync as they stand. Stable, sorted, deduped. */
  blocked: readonly SyncBlocked[];
}

const EMPTY_BLOCKED: readonly SyncBlocked[] = Object.freeze([]);

const IDLE: SyncStatus = Object.freeze({
  busy: false,
  done: 0,
  total: 0,
  lastSyncedAt: null,
  blocked: EMPTY_BLOCKED,
});

/** Per-collection push progress, aggregated into the public snapshot. */
const active = new Map<string, { done: number; total: number }>();
/** Keyed `collection/id` so re-reporting the same blob doesn't duplicate it. */
const blocked = new Map<string, SyncBlocked>();

let status: SyncStatus = IDLE;
let lastSyncedAt: number | null = null;
const listeners = new Set<() => void>();

function recompute(): void {
  let done = 0;
  let total = 0;
  for (const p of active.values()) {
    done += p.done;
    total += p.total;
  }
  const next: SyncStatus = {
    busy: active.size > 0,
    done,
    total,
    lastSyncedAt,
    blocked: blocked.size
      ? Object.freeze(
          [...blocked.values()].sort(
            (a, b) => a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id),
          ),
        )
      : EMPTY_BLOCKED,
  };
  // Skip the notify when nothing observable moved - a pull loop that applies
  // hundreds of blobs would otherwise re-render the shell once per blob.
  if (
    next.busy === status.busy &&
    next.done === status.done &&
    next.total === status.total &&
    next.lastSyncedAt === status.lastSyncedAt &&
    next.blocked === status.blocked
  ) {
    return;
  }
  status = next;
  for (const l of listeners) l();
}

/** A collection began pushing `total` changes. */
export function reportSyncStart(collection: string, total: number): void {
  active.set(collection, { done: 0, total });
  recompute();
}

/** A collection finished `done` of its `total` changes. */
export function reportSyncProgress(collection: string, done: number, total: number): void {
  if (!active.has(collection)) return; // stopped underneath us
  active.set(collection, { done, total });
  recompute();
}

/** A collection's push settled. `ok` marks a clean finish (stamps lastSyncedAt). */
export function reportSyncEnd(collection: string, ok: boolean): void {
  active.delete(collection);
  if (ok) lastSyncedAt = Date.now();
  recompute();
}

/** Quarantine a blob that the relay can never accept. */
export function reportSyncBlocked(b: SyncBlocked): void {
  const k = `${b.collection}/${b.id}`;
  const prev = blocked.get(k);
  if (prev && prev.bytes === b.bytes && prev.reason === b.reason) return;
  blocked.set(k, b);
  recompute();
}

/** Clear a quarantine - the item shrank back under the cap, or was deleted. */
export function clearSyncBlocked(collection: string, id: string): void {
  if (blocked.delete(`${collection}/${id}`)) recompute();
}

/** Drop all state (logout / account switch). */
export function resetSyncStatus(): void {
  active.clear();
  blocked.clear();
  lastSyncedAt = null;
  status = IDLE;
  for (const l of listeners) l();
}

/** Stable snapshot - useSyncExternalStore-compatible. */
export function getSyncStatus(): SyncStatus {
  return status;
}

/** SSR has no sync; a constant keeps hydration stable. */
export function getSyncStatusServer(): SyncStatus {
  return IDLE;
}

export function subscribeSyncStatus(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
