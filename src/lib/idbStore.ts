/**
 * Minimal async IndexedDB key-value backing for the Memory / Documents stores.
 *
 * localStorage caps at ~5MB per origin — a handful of documents' embeddings blow
 * that, after which persistence silently fails (data lost on reload). IndexedDB
 * has orders-of-magnitude more room and is async (no main-thread serialization
 * stall). Each store keeps its working copy in memory; this just persists records
 * by `id` (one record per item, so writes don't re-serialize the whole set).
 *
 * Records are **encrypted at rest** (localVault): each row is `{id, enc1}` sealed
 * under the Master-Key-derived cache key. Reads wait for the key (i.e. for
 * unlock); writes without a key are skipped. Legacy plaintext rows are loaded
 * once and re-written sealed; rows sealed under a *different* account's key fail
 * to open and are deleted (the owner re-pulls them from the server sync).
 *
 * Everything fails soft: if IndexedDB is unavailable (SSR, private mode, denied),
 * reads return [] and writes no-op, and the in-memory store still works for the
 * session — the server sync remains the durable source of truth either way.
 */

import { diagAppend } from "./diagLog";
import {
  openLocal,
  openLocalBytes,
  sealLocal,
  sealLocalBytes,
  whenLocalCacheKey,
} from "./localVault";
import { resetAllSyncCursors } from "./syncCursor";

const DB_NAME = "quon";
// v2 adds the "projects" store; v3 adds "originals" (sealed original file bytes
// behind the document viewer — a local cache, re-fillable from the `originals`
// sync collection via documents/originalSync.ts); v4 adds
// "memory_suggestions" (the Auto-Memory review queue — local-only, never synced);
// v5 adds "jobs" (client-runmode agents + runs, synced E2E via the `jobs`
// collection — see agents/jobsStore.ts); v6 adds "images" (generated-image
// bytes behind a chat message — a sealed local cache like "originals",
// re-fillable from the `originals` sync collection via chat/generatedImages.ts).
// onupgradeneeded only fires on a version change, so the bump is what creates the
// new store for existing users; the handler iterates IDB_STORES and creates any
// missing store (idempotent — existing data untouched).
const DB_VERSION = 6;
export const IDB_STORES = [
  "documents",
  "memory",
  "projects",
  "originals",
  "memory_suggestions",
  "jobs",
  "images",
] as const;
export type IdbStoreName = (typeof IDB_STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** The database did not exist — first run on this device, or the browser
 *  evicted it (feedback #88). Any sync cursor that survived in localStorage now
 *  vouches for blobs that are gone: reset them so the next pull refills the
 *  cache from the server. Silent on a genuine first run (no cursors). */
function onFreshDatabase(): void {
  const n = resetAllSyncCursors();
  if (n > 0) {
    diagAppend(
      `local cache: database was missing while ${n} sync cursor(s) existed — ` +
        `evicted by the browser; re-pulling everything from the server`,
    );
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let settled = false;
    const settle = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close(); // a late second connection — one is enough
        return;
      }
      settled = true;
      if (db) {
        // Another tab/window wants to upgrade (or delete) the database: let it.
        // Without this, THIS build is the one blocking the next version bump
        // in every other window — exactly how an installed PWA that was never
        // reloaded can keep a fresh tab from opening the store at all.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
      }
      resolve(db);
    };
    // The upgrade cannot proceed (another QUON window holds the old version
    // open, or a newer build already moved past ours): open whatever version
    // is on disk instead of hanging. A store this build expects may then be
    // missing — every access already fails soft on that.
    const openCurrent = (why: string) => {
      diagAppend(`local cache: ${why} — using the stored version for now`);
      try {
        const cur = indexedDB.open(DB_NAME);
        cur.onsuccess = () => settle(cur.result);
        cur.onerror = () => settle(null);
      } catch {
        settle(null);
      }
    };
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return settle(null);
    }
    req.onupgradeneeded = (ev) => {
      if (ev.oldVersion === 0) onFreshDatabase();
      const db = req.result;
      for (const name of IDB_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "id" });
      }
    };
    req.onsuccess = () => settle(req.result);
    req.onerror = () => {
      if (req.error?.name === "VersionError") {
        openCurrent("a newer QUON build already upgraded the database");
      } else {
        settle(null);
      }
    };
    req.onblocked = () =>
      openCurrent(`upgrade to v${DB_VERSION} is blocked by another open QUON window`);
  });
  return dbPromise;
}

/** Resolves once the local database has been opened (or given up on). The
 *  sync engine waits for this before its first pull, so a reset of the
 *  cursors (see onFreshDatabase) is in effect by then. */
export function whenLocalDbOpened(): Promise<void> {
  return openDb().then(() => undefined);
}

/** A sealed row: the item encrypted under the local cache key. */
interface SealedRecord {
  id: string;
  enc1: string;
}

function isSealedRecord(rec: unknown): rec is SealedRecord {
  return (
    typeof rec === "object" &&
    rec !== null &&
    typeof (rec as SealedRecord).enc1 === "string" &&
    typeof (rec as SealedRecord).id === "string"
  );
}

/** All records in a store (empty array if IndexedDB is unavailable). Waits for
 *  the local cache key — i.e. resolves only once the user has unlocked. */
export async function idbGetAll<T extends { id: string }>(name: IdbStoreName): Promise<T[]> {
  await whenLocalCacheKey();
  const db = await openDb();
  if (!db) return [];
  const raw = await new Promise<unknown[]>((resolve) => {
    try {
      const req = db.transaction(name, "readonly").objectStore(name).getAll();
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
  const out: T[] = [];
  const legacy: T[] = []; // plaintext rows from before at-rest encryption
  const dead: string[] = []; // sealed under another account's key → unreadable
  for (const rec of raw) {
    if (isSealedRecord(rec)) {
      const item = openLocal<T>(rec.enc1);
      if (item) out.push(item);
      else dead.push(rec.id);
    } else if (rec && typeof (rec as T).id === "string") {
      legacy.push(rec as T);
      out.push(rec as T);
    }
  }
  // One-time migration: re-write legacy plaintext rows sealed.
  if (legacy.length) void idbPutAll(name, legacy);
  // Hygiene: rows this account can never open just waste space — drop them. The
  // owning account re-pulls its data from the server sync on next login.
  for (const id of dead) void idbDelete(name, id);
  return out;
}

/** Insert/replace one record (keyed by its `id`). */
export async function idbPut<T extends { id: string }>(name: IdbStoreName, item: T): Promise<void> {
  return idbPutAll(name, [item]);
}

/** Insert/replace many records in a single transaction. Records are sealed with
 *  the local cache key; without a key (locked/anonymous) the write is skipped —
 *  plaintext never touches disk. */
export async function idbPutAll<T extends { id: string }>(
  name: IdbStoreName,
  items: T[],
): Promise<void> {
  const db = await openDb();
  if (!db || items.length === 0) return;
  const sealed: SealedRecord[] = [];
  for (const item of items) {
    const enc1 = sealLocal(item);
    if (!enc1) return; // no cache key → keep in memory only (fail soft)
    sealed.push({ id: item.id, enc1 });
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(name, "readwrite");
      const store = tx.objectStore(name);
      for (const rec of sealed) store.put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** A sealed binary row: raw bytes encrypted under the local cache key. Kept as
 *  a Uint8Array (structured clone), not a base64 SealedRecord — originals run to
 *  megabytes and the JSON detour would multiply the allocation. */
interface SealedBytesRecord {
  id: string;
  bin: Uint8Array;
}

/** One binary record by id, unsealed. Null when absent, IndexedDB is unavailable,
 *  or the row was sealed under a different account's key (then it can never be
 *  opened here again → deleted, same hygiene as idbGetAll). Waits for the local
 *  cache key, i.e. resolves only once the user has unlocked. */
export async function idbGetBytes(name: IdbStoreName, id: string): Promise<Uint8Array | null> {
  await whenLocalCacheKey();
  const db = await openDb();
  if (!db) return null;
  const rec = await new Promise<unknown>((resolve) => {
    try {
      const req = db.transaction(name, "readonly").objectStore(name).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  if (!rec || typeof rec !== "object" || !((rec as SealedBytesRecord).bin instanceof Uint8Array)) {
    return null;
  }
  const bytes = openLocalBytes((rec as SealedBytesRecord).bin);
  if (!bytes) void idbDelete(name, id);
  return bytes;
}

/** Insert/replace one binary record, sealed with the local cache key. Returns
 *  false (skipping the write) without a key — plaintext never touches disk. */
export async function idbPutBytes(
  name: IdbStoreName,
  id: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  const bin = sealLocalBytes(bytes);
  if (!bin) return false; // no cache key → keep in memory only (fail soft)
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(name, "readwrite");
      tx.objectStore(name).put({ id, bin } satisfies SealedBytesRecord);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Delete one record by id. */
export async function idbDelete(name: IdbStoreName, id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(name, "readwrite");
      tx.objectStore(name).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Remove every record in a store. */
export async function idbClear(name: IdbStoreName): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(name, "readwrite");
      tx.objectStore(name).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
