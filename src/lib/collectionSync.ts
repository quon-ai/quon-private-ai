/**
 * Generic zero-knowledge collection sync.
 *
 * QUON's chat history syncs by encrypting each item client-side into an opaque
 * blob and pushing/pulling it through the collection-agnostic `/sync` relay
 * (last-write-wins by `updated_at`). Memory and Documents reuse the *exact same*
 * machinery - only the collection name, the encryption key, and the local store
 * differ. This factory captures that shared logic once.
 *
 * The server only ever sees ciphertext: text is encrypted with a key derived
 * from the user's Master Key (`deriveChatKey` / `deriveMemoryKey` / `deriveDocsKey`),
 * which never leaves the browser.
 */

import { ApiError } from "./api/http";
import { syncApi, type BlobIn } from "./api/syncApi";
import { onSyncCursorsReset, SYNC_CURSOR_PREFIX } from "./syncCursor";
import { getMasterKey } from "./authStore";
import { decryptJSON, encryptJSON } from "./crypto/quonCrypto";
import {
  clearSyncBlocked,
  reportSyncBlocked,
  reportSyncEnd,
  reportSyncProgress,
  reportSyncStart,
} from "./syncStatus";

/** The relay's per-blob cap, on DECODED bytes - it base64-decodes before
 *  measuring (`quon-scrubber-service/sync.py:264`). Mirrored here so an
 *  impossible push is caught before it costs a round trip. */
export const MAX_BLOB_BYTES = 4 * 1024 * 1024;

/** The relay rejects a batch over 500 changes with a whole-request 413
 *  (`sync.py:249`), and the initial reconcile push of a large account routinely
 *  exceeds that.
 *
 *  Well under the cap on purpose, for two reasons beyond legality: progress is
 *  only observable at batch granularity, so one giant request would leave the
 *  banner pinned at 0 until it all landed; and a smaller request is far less
 *  likely to hit the 120 s push timeout with megabytes of ciphertext behind it.
 *  Accounts below this still send exactly one request, so nothing routine pays
 *  an extra round trip. */
export const PUSH_BATCH_SIZE = 100;

/** Decoded byte length of a padded standard-base64 string (`base64_variants.Original`),
 *  without allocating the decoded copy. */
export function b64Bytes(s: string): number {
  const n = s.length;
  if (!n) return 0;
  const pad = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return (n * 3) / 4 - pad;
}

export interface PushPlan {
  /** Batches that are safe to send, each within both relay caps. */
  batches: BlobIn[][];
  /** Blobs the relay can never accept, with their decoded size. */
  oversized: Array<{ change: BlobIn; bytes: number }>;
}

/** Split a push into relay-legal batches and quarantine what can never fit.
 *
 *  Pure and exported for tests: this is the logic that decides whether a
 *  collection makes progress or wedges, and it is not otherwise reachable
 *  without a server. */
export function planPush(
  changes: BlobIn[],
  opts?: { maxBlobBytes?: number; batchSize?: number },
): PushPlan {
  const maxBlobBytes = opts?.maxBlobBytes ?? MAX_BLOB_BYTES;
  const batchSize = opts?.batchSize ?? PUSH_BATCH_SIZE;
  const sendable: BlobIn[] = [];
  const oversized: PushPlan["oversized"] = [];
  for (const c of changes) {
    const bytes = b64Bytes(c.ciphertext);
    if (bytes > maxBlobBytes) oversized.push({ change: c, bytes });
    else sendable.push(c);
  }
  const batches: BlobIn[][] = [];
  for (let i = 0; i < sendable.length; i += batchSize) {
    batches.push(sendable.slice(i, i + batchSize));
  }
  return { batches, oversized };
}

/** 413/422 mean the payload itself is unacceptable - re-sending it unchanged can
 *  only fail identically, so it must not be re-queued. Everything else (offline,
 *  5xx, an expired token) is worth another attempt. */
function isPermanent(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 413 || e.status === 422);
}

/** Adapter a local store implements so a collection can be synced. */
export interface SyncStore<T> {
  /** All locally-held items (used for the initial reconcile push). */
  getAll: () => T[];
  idOf: (item: T) => string;
  updatedAtOf: (item: T) => number;
  /** Merge a decrypted remote item (LWW). Must not fire local change listeners. */
  applyRemote: (item: T) => void;
  /** Apply a remote tombstone. Must not fire local change listeners. */
  applyRemoteDeletion: (id: string) => void;
  /** Subscribe to local upserts (each fires a debounced push). */
  onChange: (cb: (item: T) => void) => () => void;
  /** Subscribe to local deletes (each fires a tombstone push). */
  onDelete: (cb: (ids: string[]) => void) => () => void;
}

export interface CollectionSync {
  /** Begin syncing (idempotent). Pull remote, then push local-only items. */
  start: () => void;
  /** Stop syncing and reset the pull cursor (call on logout). */
  stop: () => void;
}

export function createCollectionSync<T>(opts: {
  collection: string;
  deriveKey: (masterKey: Uint8Array) => Uint8Array;
  store: SyncStore<T>;
  debounceMs?: number;
  /** Shared-project instance: sync `collection` under this project's shared
   *  store instead of the personal one. Requires `getKey`. */
  projectId?: string;
  /** Key override for shared instances - the project key from sharedKeyStore
   *  (a random 32-byte key exchanged via sealed grants), not MK-derived. */
  getKey?: () => Uint8Array | null;
  /** Restrict which local items this instance owns. Used to ROUTE items: the
   *  personal instance excludes items living in shared projects; a shared
   *  instance includes only its own project's items. Applies to pushes only -
   *  pulls are already partitioned server-side. */
  filter?: (item: T) => boolean;
  /** Poll interval (ms) for a periodic remote pull. Default: no polling (a
   *  collection only pulls on start + after each local push). The `jobs`
   *  collection sets this so a runner device SEES jobs/progress written on
   *  another device without a local write to trigger a pull - the cross-device
   *  agent runner and Phase-3 progress-watching both need it. All other
   *  collections stay event-driven (omit -> unchanged). */
  pollMs?: number;
}): CollectionSync {
  const { collection, deriveKey, store, projectId, filter, pollMs } = opts;
  const debounceMs = opts.debounceMs ?? 1500;
  // _v2, deliberately: every device that ran the pre-fix code has a cursor
  // that already SKIPPED blobs (see pushItems). Fixing the rule going forward
  // does not bring those back - the cursor only moves forward, so the skipped
  // range is never requested again. Bumping the key resets each device to 0
  // once, which re-pulls everything and heals the gaps. Costs one full sync per
  // device; applyRemote is LWW, so nothing local is overwritten by older data.
  const SEQ_KEY = `${SYNC_CURSOR_PREFIX}${collection}${projectId ? `_p_${projectId}` : ""}_v2`;

  let started = false;
  let unsubs: Array<() => void> = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  const dirty = new Map<string, T>();
  const tombstones = new Set<string>();

  const lastSeq = (): number => Number(localStorage.getItem(SEQ_KEY) ?? 0) || 0;
  const setSeq = (n: number): void => {
    if (n > lastSeq()) localStorage.setItem(SEQ_KEY, String(n));
  };
  const key = (): Uint8Array | null => {
    if (opts.getKey) return opts.getKey();
    const mk = getMasterKey();
    return mk ? deriveKey(mk) : null;
  };
  const mine = (it: T): boolean => (filter ? filter(it) : true);

  async function pull(): Promise<void> {
    const k = key();
    if (!k) return;
    let res;
    try {
      res = await syncApi.changes(collection, lastSeq(), projectId);
    } catch {
      return; // offline / transient - retry next cycle
    }
    for (const b of res.changes) {
      if (b.deleted) {
        store.applyRemoteDeletion(b.id);
        continue;
      }
      try {
        store.applyRemote(decryptJSON<T>(b.ciphertext, k));
      } catch {
        /* undecryptable (wrong key / corruption) - skip */
      }
    }
    setSeq(res.latest_seq);
  }

  async function pushItems(items: T[], deletes: string[], k: Uint8Array): Promise<void> {
    const changes: BlobIn[] = [
      ...items.map((it) => ({
        collection,
        id: store.idOf(it),
        ciphertext: encryptJSON(it, k),
        updated_at: store.updatedAtOf(it),
        project_id: projectId,
      })),
      ...deletes.map((id) => ({
        collection,
        id,
        ciphertext: "",
        updated_at: Date.now(),
        deleted: true,
        project_id: projectId,
      })),
    ];
    if (!changes.length) return;

    // Re-queue precisely: with batching, one failed batch must not drag the
    // batches that already landed back into the queue.
    const itemById = new Map(items.map((it) => [store.idOf(it), it]));
    const requeue = (batch: BlobIn[]): void => {
      for (const c of batch) {
        const it = itemById.get(c.id);
        if (it) dirty.set(c.id, it);
        else if (c.deleted) tombstones.add(c.id);
      }
    };

    const { batches, oversized } = planPush(changes);

    // Quarantine, do not re-queue. A blob over the relay's cap fails with a
    // whole-batch 413 every single time; the old bare `catch` put it straight
    // back in the queue, so one oversized chat wedged its entire collection
    // forever - silently, since nothing observed the failure. Surfacing it and
    // dropping it lets every other item in the collection keep syncing.
    for (const o of oversized) {
      reportSyncBlocked({
        collection,
        id: o.change.id,
        reason: "toobig",
        bytes: o.bytes,
      });
    }
    // Anything that now fits is no longer blocked (the item shrank, or the user
    // deleted enough of it).
    for (const b of batches) for (const c of b) clearSyncBlocked(collection, c.id);

    if (!batches.length) return;

    const total = batches.reduce((n, b) => n + b.length, 0);
    reportSyncStart(collection, total);
    let pushed = 0;
    let clean = true;
    for (const batch of batches) {
      try {
        const res = await syncApi.push(batch);
        // The cursor is not advanced here, and that is the whole point.
        //
        // A push response reports the user's LATEST server seq - which includes
        // everything other devices wrote since our last pull. Adopting it as our
        // cursor jumped straight over those blobs, and since the cursor only ever
        // moves forward they were never fetched again: chats written on the phone
        // silently never reached the laptop and vice versa. The `pull()` that
        // follows a flush is supposed to reconcile concurrent edits, but it ran
        // After the cursor had already skipped past them.
        //
        // Only a pull that actually applied the changes may move the cursor. The
        // cost is re-downloading our own just-pushed blobs once; `applyRemote`
        // ignores them (same `updatedAt`), so it is a no-op locally.

        // A reader's shared-scope edit comes back "forbidden" - the server is the
        // authority (owner-only writes in v1). Dropping it here (no re-queue)
        // keeps the queue from wedging; the next pull restores the server state.
        const refused = new Set(
          res.results.filter((r) => r.status === "forbidden").map((r) => r.id),
        );
        if (refused.size) {
          console.warn(`[sync] ${collection}: ${refused.size} shared write(s) refused (read-only)`);
        }
      } catch (e) {
        clean = false;
        if (isPermanent(e)) {
          // The relay refused the payload itself. Re-sending it unchanged can
          // only fail the same way, so surface it instead of looping.
          console.warn(`[sync] ${collection}: ${batch.length} change(s) refused permanently`, e);
          for (const c of batch) {
            reportSyncBlocked({
              collection,
              id: c.id,
              reason: "toobig",
              bytes: b64Bytes(c.ciphertext),
            });
          }
        } else {
          requeue(batch); // offline / 5xx / expired token - worth retrying
        }
      }
      pushed += batch.length;
      reportSyncProgress(collection, pushed, total);
    }
    reportSyncEnd(collection, clean);
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flush(), debounceMs);
  }

  async function flush(): Promise<void> {
    const k = key();
    if (!k) return;
    const items = Array.from(dirty.values());
    const deletes = Array.from(tombstones);
    dirty.clear();
    tombstones.clear();
    if (!items.length && !deletes.length) return;
    await pushItems(items, deletes, k);
    await pull(); // reconcile server_seq + concurrent edits
  }

  return {
    start() {
      if (started) return;
      started = true;
      unsubs.push(
        store.onChange((it) => {
          if (!mine(it)) return;
          dirty.set(store.idOf(it), it);
          tombstones.delete(store.idOf(it));
          schedule();
        }),
      );
      unsubs.push(
        store.onDelete((ids) => {
          // Deletes carry no item to filter on; a tombstone for an id the other
          // channel owns is refused/ignored server-side, so over-tombstoning is
          // safe for personal instances. Shared instances skip foreign deletes
          // via the pushed project_id partition anyway.
          for (const id of ids) {
            tombstones.add(id);
            dirty.delete(id);
          }
          schedule();
        }),
      );
      // Reliability net for cross-device propagation, esp. on mobile. A local
      // edit/delete only queues a push behind the `debounceMs` timer, and a pull
      // only happens on start() or right after a local push. So without this:
      //  - a phone that deletes a document and is then backgrounded/closed within
      //    the debounce window loses the tombstone (never reaches the server), and
      //  - a laptop left merely open never learns about a delete made elsewhere.
      // Flush pending writes the moment the page is hidden/unloading (the delete
      // tombstone gets out before the tab suspends), and pull when it becomes
      // visible again or the network returns (so an open device receives remote
      // deletes without a reload or a local change to trigger a pull).
      if (typeof document !== "undefined" && document.addEventListener) {
        const onVisibility = () => {
          if (document.visibilityState === "hidden") void flush();
          else void pull();
        };
        document.addEventListener("visibilitychange", onVisibility);
        unsubs.push(() => document.removeEventListener("visibilitychange", onVisibility));
      }
      if (typeof window !== "undefined" && window.addEventListener) {
        const onHide = () => void flush();
        const onOnline = () => void pull();
        // `pagehide` fires on real navigations/close where `beforeunload` is
        // unreliable on mobile; `online` covers a reconnect after offline.
        window.addEventListener("pagehide", onHide);
        window.addEventListener("online", onOnline);
        unsubs.push(() => window.removeEventListener("pagehide", onHide));
        unsubs.push(() => window.removeEventListener("online", onOnline));
      }
      // The local database turned out to be new (evicted by the browser) after
      // this engine had already pulled with the old cursor: pull again from 0.
      unsubs.push(onSyncCursorsReset(() => void pull()));
      void (async () => {
        await pull();
        const k = key();
        if (k) await pushItems(store.getAll().filter(mine), [], k);
      })();
      // Optional periodic pull - the only way a runner device receives jobs
      // written elsewhere (no local write there to trigger a pull). Ciphertext
      // in, ciphertext out; the server still reads nothing.
      if (pollMs && pollMs > 0) poll = setInterval(() => void pull(), pollMs);
    },
    stop() {
      started = false;
      for (const u of unsubs) u();
      unsubs = [];
      dirty.clear();
      tombstones.clear();
      if (timer) clearTimeout(timer);
      timer = null;
      if (poll) clearInterval(poll);
      poll = null;
      try {
        localStorage.removeItem(SEQ_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}
