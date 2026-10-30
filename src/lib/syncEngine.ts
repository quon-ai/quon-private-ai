/**
 * Client sync engine: mirrors the user's local data to the zero-knowledge sync
 * relay, one encrypted blob per item. Three collections share the same
 * machinery (`createCollectionSync`), each with its own Master-Key-derived key:
 *
 *   - `chat`       — chat sessions        (deriveChatKey)
 *   - `memory`     — facts/notes          (deriveMemoryKey)
 *   - `documents`  — uploaded documents   (deriveDocsKey)
 *   - `projects`   — project containers   (deriveProjectsKey)
 *   - `prefs`      — UI prefs + redact lists, one singleton blob (derivePrefsKey)
 *
 * The server only ever sees ciphertext. `startSync`/`stopSync` are called by the
 * AppShell on the ready/anonymous transitions.
 */

import { createCollectionSync, type CollectionSync, type SyncStore } from "./collectionSync";
import {
  deriveChatKey,
  deriveDocsKey,
  deriveMemoryKey,
  derivePrefsKey,
  deriveProjectsKey,
} from "./crypto/quonCrypto";
import { isSharedProject, refreshSharedSync, stopSharedSync } from "./sharedSync";
import { whenLocalDbOpened } from "./idbStore";
import { requestPersistentStorage } from "./persistentStorage";
import { startOriginalsSync, stopOriginalsSync } from "./documents/originalSync";
import { documentSyncStore, resetDocuments, type DocItem } from "./documentStore";
import { memorySyncStore, resetMemory, type MemoryItem } from "./memoryStore";
import { resetSyncStatus } from "./syncStatus";
import { extraEngines, resetExtras, startExtras, stopExtras } from "./syncExtras";
import { projectSyncStore, resetProjects, type ProjectItem } from "./projectStore";
import {
  applyRemoteDeletion,
  applyRemotePrefs,
  applyRemoteSession,
  getAllSessions,
  getPrefsItem,
  onPrefsChange,
  onSessionChange,
  onSessionDelete,
  type PrefsItem,
  resetChatHistory,
  resetState,
  type ChatSession,
} from "./quonStore";

/** Remove every collection's pull cursor so the next startSync does a FULL pull.
 *  Robust even when no engines are running (e.g. an account-switch wipe), where
 *  per-engine stop() wouldn't have cleared them. */
function clearSyncCursors(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("quon_sync_seq_")) localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

// Chat history exposes its sync hooks directly on quonStore; wrap them in the
// generic SyncStore shape.
const chatSyncStore: SyncStore<ChatSession> = {
  getAll: getAllSessions,
  idOf: (s) => s.id,
  updatedAtOf: (s) => s.updatedAt,
  applyRemote: applyRemoteSession,
  applyRemoteDeletion,
  onChange: onSessionChange,
  onDelete: onSessionDelete,
};

// UI preferences (protection level, active model, reasoning) + the always/never
// redact lists, as ONE E2E-encrypted singleton blob (id "prefs"). The redact
// lists are the user's own PII, so — like chats — the server only ever sees
// ciphertext. LWW by prefsUpdatedAt across devices; never deleted (no tombstones).
const prefsSyncStore: SyncStore<PrefsItem> = {
  getAll: () => [getPrefsItem()],
  idOf: () => "prefs",
  updatedAtOf: (p) => p.updatedAt,
  applyRemote: applyRemotePrefs,
  applyRemoteDeletion: () => {},
  onChange: onPrefsChange,
  onDelete: () => () => {},
};

let engines: CollectionSync[] = [];

/** Start syncing all collections (call once the app is unlocked/ready). Idempotent. */
export function startSync(): void {
  if (engines.length) return;
  engines = [
    createCollectionSync<ChatSession>({
      collection: "chat",
      deriveKey: deriveChatKey,
      store: chatSyncStore,
    }),
    // Items living in a SHARED project are excluded here — the shared channel
    // (sharedSync.ts) owns them, encrypted under the project key instead of the
    // personal collection keys. Chats are never shared and keep no filter.
    createCollectionSync<MemoryItem>({
      collection: "memory",
      deriveKey: deriveMemoryKey,
      store: memorySyncStore,
      filter: (m) => !isSharedProject(m.projectId),
    }),
    createCollectionSync<DocItem>({
      collection: "documents",
      deriveKey: deriveDocsKey,
      store: documentSyncStore,
      filter: (d) => !isSharedProject(d.projectId),
    }),
    createCollectionSync<ProjectItem>({
      collection: "projects",
      deriveKey: deriveProjectsKey,
      store: projectSyncStore,
      filter: (p) => !isSharedProject(p.id),
    }),
    createCollectionSync<PrefsItem>({
      collection: "prefs",
      deriveKey: derivePrefsKey,
      store: prefsSyncStore,
    }),
    // Collections of the optional features (none in the core edition).
    ...extraEngines(),
  ];
  // Grants FIRST, personal engines after: the routing filters above consult the
  // shared registry, so it must be populated before the personal channel's
  // initial reconcile push — otherwise shared items leak into personal blobs
  // once. refreshSharedSync never rejects (offline → resolves empty), so the
  // personal channel starts promptly either way.
  const startPersonal = engines;
  // The local database first: if it had to be re-created (evicted — #88),
  // the cursors are reset by the time the first pull reads them. Capped so a
  // storage problem can never hold the sync back.
  const dbReady = Promise.race([
    whenLocalDbOpened(),
    new Promise<void>((r) => setTimeout(r, 10_000)),
  ]);
  void requestPersistentStorage();
  void Promise.all([refreshSharedSync(), dbReady]).finally(() => {
    for (const e of startPersonal) e.start();
    // Original document bytes: chunked upload + lazy fetch, outside the
    // delta-pull loop (documents/originalSync.ts). Started here so
    // interrupted/legacy uploads are retried once per session.
    startOriginalsSync();
    // Background runners of the optional features (syncExtras.ts).
    startExtras();
  });
}

/** Stop syncing and reset cursors (call on logout). Clears the local
 *  Memory/Document caches (re-pulled from the server on next login). */
export function stopSync(): void {
  stopSharedSync();
  stopOriginalsSync();
  stopExtras();
  for (const e of engines) e.stop();
  engines = [];
  clearSyncCursors();
  resetChatHistory();
  resetState();
  resetMemory();
  resetDocuments();
  resetProjects();
  resetExtras();
  // Progress counters and quarantined blobs belong to the account that just
  // left — a stale "1 chat can't sync" would otherwise follow the next one in.
  resetSyncStatus();
}
