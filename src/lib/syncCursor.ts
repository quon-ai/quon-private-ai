/**
 * The sync cursors ("I have every blob up to server seq N") live in
 * localStorage; the blobs they vouch for live in IndexedDB. Those are two
 * different storage buckets, and a browser under storage pressure evicts the
 * second without touching the first - Chrome's quota eviction covers
 * IndexedDB and the Cache API (where the 100+ MB embedder model lives), not
 * localStorage. Afterwards every store is empty, the cursor still says
 * "nothing new since N", and the user's projects, memory and documents stay
 * invisible on that device for good (a 4 GB Android is the typical case).
 *
 * The invariant: a cursor is only valid together with the database it
 * describes. `idbStore` reports a database it had to CREATE; that is the
 * moment the cursors are proven stale and get reset, so the next pull starts
 * from 0 and the server (the durable source of truth) refills the cache.
 */

export const SYNC_CURSOR_PREFIX = "quon_sync_seq_";

const resetListeners = new Set<() => void>();

/** Run `cb` whenever the cursors are reset. The sync engine waits for the
 *  database before its first pull, but only for a bounded time - on a slow
 *  device the open can outlast that wait, and then the first pull has already
 *  gone out with the stale cursor. A reset therefore also TRIGGERS a pull on
 *  every running engine, so the order no longer matters. */
export function onSyncCursorsReset(cb: () => void): () => void {
  resetListeners.add(cb);
  return () => {
    resetListeners.delete(cb);
  };
}

/** Remove every sync cursor; returns how many there were. Notifies listeners
 *  when at least one was removed. */
export function resetAllSyncCursors(): number {
  if (typeof localStorage === "undefined") return 0;
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(SYNC_CURSOR_PREFIX)) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    return 0;
  }
  if (keys.length) for (const cb of Array.from(resetListeners)) cb();
  return keys.length;
}
