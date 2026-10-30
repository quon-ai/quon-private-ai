/**
 * Memory store — the user's facts/notes, end-to-end encrypted and synced as
 * opaque blobs (collection `memory`) exactly like chat history.
 *
 * Same shape as the Documents store: a `useSyncExternalStore` hook + an
 * **IndexedDB** cache + local-change/delete listeners the sync engine subscribes
 * to. Text is the user's **original** content (encrypted at rest); the embedding
 * is computed on-device so nothing ever leaves the browser in the clear.
 *
 * Persistence is IndexedDB (not localStorage): memory items carry embeddings and
 * can grow past localStorage's ~5MB cap. The in-memory `items` array is the
 * synchronous source of truth; IndexedDB loads into it async and is written
 * per-record on change.
 */

import { useSyncExternalStore } from "react";

import type { SyncStore } from "./collectionSync";
import { idbClear, idbDelete, idbGetAll, idbPut, idbPutAll } from "./idbStore";

export type MemoryKind = "fact" | "note";

/** Length ceiling for the "fact" tier. A fact is a short, standalone statement
 *  (the shape the Auto-Memory sweep produces); anything longer is free-form
 *  content and is saved as a note. Retrieval trusts the two tiers differently:
 *  items above this length get the STRICT relevance gate (keyword anchor + high
 *  cosine — see rag.ts), because long pasted content chunk-embeds into many
 *  vectors and is the main source of spurious context hits. */
export const FACT_MAX_CHARS = 300;

/** Effective kind for a text about to be saved: long texts are always notes —
 *  a multi-paragraph "fact" defeats the tier semantics above. */
export function kindForText(text: string, chosen: MemoryKind): MemoryKind {
  return text.length > FACT_MAX_CHARS ? "note" : chosen;
}

/** A passage of a memory item with its own embedding. A long note as a single vector
 *  is too diluted to match a focused query, so retrieval ranks over these instead. */
export interface MemoryChunk {
  text: string;
  embedding?: number[];
}

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  /** Short label for facts (e.g. "Standard rate"); optional for free notes. */
  key?: string;
  /** Original text (encrypted at rest, never sent to a third party as-is). */
  text: string;
  tags: string[];
  /** Whole-item embedding (length = dim); absent until embedded. Used by the Memory
   *  screen search + the "is this item current" check. RAG ranks over `chunks`. */
  embedding?: number[];
  /** Per-passage embeddings for retrieval; absent on items embedded before chunking
   *  existed (RAG then falls back to the whole-item `embedding`). */
  chunks?: MemoryChunk[];
  dim?: number;
  /** Id of the embedding model used (vectors are only comparable within a model). */
  embModel?: string;
  /** Project this item belongs to; undefined = global pool. */
  projectId?: string;
  /** How the item was created. Undefined (older/manual items) means "manual";
   *  "chat" = accepted from the Auto-Memory review queue ("Learn from chats");
   *  "document" = mined from one of the user's own documents. */
  source?: "manual" | "chat" | "document";
  /** For source "chat": the chat session the fact was mined from. */
  sourceSessionId?: string;
  /** For source "document": the document the fact was mined from. */
  sourceDocId?: string;
  /** User-curated "always consider this" flag. A pinned item is a retrieval
   *  candidate on every in-scope chat turn, bypassing the relevance gate's
   *  cosine floor — meant for a FEW short, deliberately important facts (see
   *  `FACT_MAX_CHARS` and `rag.ts`'s `memoryChunksInScope`, which only honours
   *  this for items at/under the fact-length ceiling; a pinned long note still
   *  gets the strict tier, so pinning can't be used to force-inject arbitrary
   *  pasted content). Optional and unset for all existing items; a plain field
   *  on the record, so it round-trips through the existing encrypted sync
   *  (`collectionSync.ts` serializes the whole item generically) and the
   *  IndexedDB local cache unchanged — no migration needed. */
  pinned?: boolean;
  /**
   * Lifecycle status (P5, see `.claude/plans/memory-lifecycle-p5.md`). Absent
   * (the shape of every pre-P5 item) means "active" — see `isActiveMemory`.
   * "superseded" = replaced by a newer/merged item (`supersededBy` names it);
   * "archived" = the user tucked it away via the future "attic" review.
   * Reversible in both cases (`reviveMemoryItem`) — nothing here is ever a
   * hard delete. No migration: a plain optional field, same precedent as
   * `pinned` above. */
  status?: "active" | "superseded" | "archived";
  /** For status "superseded": the item that replaced this one. */
  supersededBy?: string;
  /** Ids of items THIS item has superseded (provenance trail; may include
   *  items later revived — not pruned on revive). */
  supersedes?: string[];
  /** Last time the user explicitly confirmed this item is still current (the
   *  future "attic" review's "Noch aktuell?" action). Distinct from `updatedAt`
   *  (an edit) and `lastUsedAt` (a retrieval hit) — see `findAtticItems` in
   *  memoryExtract.ts and the staleness date-suffix in rag.ts. */
  lastConfirmedAt?: number;
  /** Last time this item was actually surfaced into a chat's context by RAG
   *  (`touchMemoryUsage`, called from rag.ts's `retrieveContext`). Deliberately
   *  does NOT bump `updatedAt` — see `touchMemoryUsage`'s doc comment. */
  lastUsedAt?: number;
  /** How many times this item has been surfaced into context (companion to
   *  `lastUsedAt`; same non-bumping-updatedAt rule). */
  useCount?: number;
  createdAt: number;
  updatedAt: number;
}

/** True when an item is in the (implicit) "active" lifecycle state — the
 *  absence of `status` (every pre-P5 item, and the common case) counts as
 *  active, same as an unset `pinned` counts as "not pinned". Retrieval
 *  (`rag.ts`), the sweep's dedup (`memoryExtract.ts`) and conflict/near-dup
 *  detection all filter through this — a superseded/archived item must never
 *  be silently treated as current. */
export function isActiveMemory(item: Pick<MemoryItem, "status">): boolean {
  return item.status !== "superseded" && item.status !== "archived";
}

const STORAGE_KEY = "quon_memory_v1"; // legacy localStorage cache (migrated to IndexedDB)
const IDB = "memory" as const;

let items: MemoryItem[] = [];
let loadStarted = false;
const listeners = new Set<() => void>();
const changeListeners = new Set<(item: MemoryItem) => void>();
const deleteListeners = new Set<(ids: string[]) => void>();

function sortItems(list: MemoryItem[]): MemoryItem[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Load persisted items from IndexedDB once, migrating any legacy localStorage cache. */
function ensureLoaded(): void {
  if (loadStarted || typeof window === "undefined") return;
  loadStarted = true;
  void (async () => {
    let stored = await idbGetAll<MemoryItem>(IDB);
    if (stored.length === 0) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = (JSON.parse(raw) as MemoryItem[]).filter((x) => x && x.id);
          if (parsed.length) {
            await idbPutAll(IDB, parsed);
            stored = parsed;
          }
          localStorage.removeItem(STORAGE_KEY); // free the old ~5MB cap
        }
      } catch {
        /* ignore corrupt legacy cache */
      }
    }
    // Merge, not overwrite: writes that landed while the async load was in flight
    // (already in `items`) take precedence over the loaded snapshot.
    const byId = new Map(stored.filter((x) => x && x.id).map((x) => [x.id, x]));
    for (const x of items) byId.set(x.id, x);
    items = sortItems([...byId.values()]);
    emit();
  })();
}

function emit(): void {
  for (const l of listeners) l();
}

export function useMemory(): MemoryItem[] {
  return useSyncExternalStore(
    (l) => {
      ensureLoaded();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
    () => [],
  );
}

export function createMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAllMemory(): MemoryItem[] {
  ensureLoaded();
  return items;
}

export function getMemoryItem(id: string): MemoryItem | undefined {
  ensureLoaded();
  return items.find((x) => x.id === id);
}

/** Insert or update a memory item (fires sync push). */
export function upsertMemoryItem(item: MemoryItem): void {
  ensureLoaded();
  const next = { ...item, updatedAt: item.updatedAt || Date.now() };
  items = sortItems([next, ...items.filter((x) => x.id !== next.id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

// --- lifecycle (P5): usage tracking + supersede/revive ----------------------

/** Batches multiple `touchMemoryUsage` calls to the SAME item into one sync
 *  push (a memory re-used across several turns of one chat shouldn't push
 *  once per hit). Keyed by item id. */
const usageTouchTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Batch window for the debounced usage-sync push (see `touchMemoryUsage`). */
export const USAGE_PUSH_DEBOUNCE_MS = 5000;

/**
 * Record that a memory item was actually surfaced into a chat's context
 * (called from `rag.ts`'s `retrieveContext`). Bumps `lastUsedAt`/`useCount`.
 *
 * Deliberately does NOT bump `updatedAt`: doing so would (a) distort the
 * recency-boost ranking in `rerankAndGate` — a frequently-*retrieved* item
 * would look like a frequently-*edited* one and keep winning ties it hasn't
 * earned — and (b) spam the sync layer on every single chat turn (same class
 * of bug as the fresh-device `activeModelId` correction out-timestamping the
 * real choice — see `quon.correctActiveModel`'s doc comment).
 *
 * Sync strategy (chosen deliberately safe over complete — see
 * memory-lifecycle-p5.md §"Data model"): the local update lands immediately
 * (IndexedDB + in-memory), but the debounced PUSH carries the item's
 * UNCHANGED `updatedAt`. `collectionSync.ts` pushes `store.updatedAtOf(item)`
 * as the authoritative LWW timestamp, and the server (`sync.py`) only ever
 * REJECTS an incoming write when it is OLDER than what's stored — so a push
 * with an unchanged timestamp can never clobber a genuinely newer edit,
 * local or remote. The trade-off: a receiving device already holding this
 * exact item at that exact `updatedAt` will locally DROP the pull
 * (`applyRemoteMemory`'s `existing.updatedAt >= item.updatedAt` guard), so a
 * usage bump doesn't always propagate to devices already in sync. That's
 * acceptable — usage is a soft staleness signal (feeds the "attic" review),
 * never user-authored content, so safety against ever clobbering a real edit
 * wins over completeness.
 */
export function touchMemoryUsage(id: string): void {
  ensureLoaded();
  const existing = items.find((x) => x.id === id);
  if (!existing) return;
  const next: MemoryItem = {
    ...existing,
    lastUsedAt: Date.now(),
    useCount: (existing.useCount ?? 0) + 1,
    // updatedAt intentionally unchanged — see the doc comment above.
  };
  items = items.map((x) => (x.id === id ? next : x));
  void idbPut(IDB, next);
  emit();

  const pending = usageTouchTimers.get(id);
  if (pending) clearTimeout(pending);
  usageTouchTimers.set(
    id,
    setTimeout(() => {
      usageTouchTimers.delete(id);
      const current = items.find((x) => x.id === id);
      if (current) for (const l of changeListeners) l(current);
    }, USAGE_PUSH_DEBOUNCE_MS),
  );
}

/**
 * Mark `loserId` as superseded by `winnerId`: sets `status:"superseded"` +
 * `supersededBy` on the loser and records the link on the winner's
 * `supersedes[]`. Both are real edits (bump `updatedAt`, fire the sync push)
 * — this is the reversible alternative to deleting: `reviveMemoryItem`
 * restores the loser. No-op if either id is unknown or they're the same item.
 */
export function supersedeMemoryItem(loserId: string, winnerId: string): void {
  ensureLoaded();
  if (loserId === winnerId) return;
  const loser = items.find((x) => x.id === loserId);
  const winner = items.find((x) => x.id === winnerId);
  if (!loser || !winner) return;
  const now = Date.now();
  const nextLoser: MemoryItem = {
    ...loser,
    status: "superseded",
    supersededBy: winnerId,
    updatedAt: now,
  };
  const priorSupersedes = winner.supersedes ?? [];
  const winnerChanged = !priorSupersedes.includes(loserId);
  const nextWinner: MemoryItem = winnerChanged
    ? { ...winner, supersedes: [...priorSupersedes, loserId], updatedAt: now }
    : winner;
  items = sortItems(
    items.map((x) => (x.id === loserId ? nextLoser : x.id === winnerId ? nextWinner : x)),
  );
  void idbPut(IDB, nextLoser);
  for (const l of changeListeners) l(nextLoser);
  if (winnerChanged) {
    void idbPut(IDB, nextWinner);
    for (const l of changeListeners) l(nextWinner);
  }
  emit();
}

/** Reverse a supersede OR an archive: clears `status`/`supersededBy`, making
 *  the item active again. A real edit (bumps `updatedAt`, fires the sync
 *  push). No-op if the item is unknown or already active. The winner's
 *  `supersedes[]` provenance trail is intentionally left as-is — it's a
 *  historical record, not a live pointer. */
export function reviveMemoryItem(id: string): void {
  ensureLoaded();
  const existing = items.find((x) => x.id === id);
  if (!existing || isActiveMemory(existing)) return;
  const next: MemoryItem = {
    ...existing,
    status: undefined,
    supersededBy: undefined,
    updatedAt: Date.now(),
  };
  items = sortItems([next, ...items.filter((x) => x.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Tuck an item away (the future "attic" review's non-destructive action).
 *  Reversible via `reviveMemoryItem`. No-op if already archived. */
export function archiveMemoryItem(id: string): void {
  ensureLoaded();
  const existing = items.find((x) => x.id === id);
  if (!existing || existing.status === "archived") return;
  const next: MemoryItem = { ...existing, status: "archived", updatedAt: Date.now() };
  items = sortItems([next, ...items.filter((x) => x.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Record that the user confirmed an item is still current (the "attic"
 *  review's "Noch aktuell?" → yes action). Bumps `lastConfirmedAt` only —
 *  deliberately NOT `updatedAt` (this isn't a content edit; keeping the two
 *  separate is what lets `findAtticItems`/the staleness date-suffix in
 *  rag.ts tell "confirmed recently" apart from "edited recently"). */
export function confirmMemoryItem(id: string): void {
  ensureLoaded();
  const existing = items.find((x) => x.id === id);
  if (!existing) return;
  const next: MemoryItem = { ...existing, lastConfirmedAt: Date.now() };
  items = items.map((x) => (x.id === id ? next : x));
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Assign (or clear, with `undefined`) the project a memory item belongs to.
 *  Pure metadata — embeddings are untouched, so no re-embedding. Fires sync push. */
export function setMemoryProject(id: string, projectId: string | undefined): void {
  ensureLoaded();
  const existing = items.find((x) => x.id === id);
  if (!existing || existing.projectId === projectId) return;
  const next = { ...existing, projectId, updatedAt: Date.now() };
  items = sortItems([next, ...items.filter((x) => x.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Delete a memory item (fires sync tombstone). */
export function deleteMemoryItem(id: string): void {
  ensureLoaded();
  if (!items.some((x) => x.id === id)) return;
  items = items.filter((x) => x.id !== id);
  void idbDelete(IDB, id);
  emit();
  for (const l of deleteListeners) l([id]);
}

// --- sync integration (no echo back to the server) -------------------------

export function applyRemoteMemory(item: MemoryItem): void {
  ensureLoaded();
  const existing = items.find((x) => x.id === item.id);
  if (existing && existing.updatedAt >= item.updatedAt) return;
  items = sortItems([item, ...items.filter((x) => x.id !== item.id)]);
  void idbPut(IDB, item);
  emit();
}

export function applyRemoteMemoryDeletion(id: string): void {
  ensureLoaded();
  if (!items.some((x) => x.id === id)) return;
  items = items.filter((x) => x.id !== id);
  void idbDelete(IDB, id);
  emit();
}

/** Reset the in-memory + cached state (called on logout). */
export function resetMemory(): void {
  items = [];
  loadStarted = false;
  void idbClear(IDB);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** SyncStore adapter consumed by `createCollectionSync`. */
export const memorySyncStore: SyncStore<MemoryItem> = {
  getAll: getAllMemory,
  idOf: (it) => it.id,
  updatedAtOf: (it) => it.updatedAt,
  applyRemote: applyRemoteMemory,
  applyRemoteDeletion: applyRemoteMemoryDeletion,
  onChange: (cb) => {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  },
  onDelete: (cb) => {
    deleteListeners.add(cb);
    return () => deleteListeners.delete(cb);
  },
};
