/**
 * Auto-Memory review queue + sweep cursors.
 *
 * Suggestions are candidate facts mined from chat sessions by the manual
 * "Learn from chats" sweep (`src/lib/memoryExtract.ts`), waiting for the user's
 * explicit Keep / Edit / Discard in the Memory screen. Nothing enters the real
 * (synced) Memory store without that approval.
 *
 * Persistence follows the Memory/Documents pattern: a `useSyncExternalStore`
 * hook over an in-memory array, cached in IndexedDB where every row is sealed
 * with the localVault key (encrypted at rest; rows sealed under a different
 * account's key are unreadable and dropped by idbGetAll). Unlike those stores it
 * is **never synced** — a review queue is per-device working state. The queue
 * is also capped per scope (`MAX_SUGGESTIONS_PER_SCOPE`) so an idle habit of
 * running sweeps doesn't grow it without bound.
 *
 * The sweep cursors (per chat session: the last message id already processed)
 * DO sync, cross-device, as part of quonStore's `prefs` blob — see the
 * `getSweepCursor`/`setSweepCursor`/`resetSweepCursors` re-exports below.
 */

import { useSyncExternalStore } from "react";

import { idbClear, idbDelete, idbGetAll, idbPutAll } from "./idbStore";
import {
  getSweepCursor as getStoreSweepCursor,
  resetSweepCursors as resetStoreSweepCursors,
  setSweepCursor as setStoreSweepCursor,
} from "./quonStore";
import { inScope, type RagScope } from "./rag";
import type { MemoryKind } from "./memoryStore";

export interface MemorySuggestion {
  id: string;
  kind: MemoryKind;
  /** Short label for facts (mirrors MemoryItem.key). */
  key?: string;
  /** Candidate memory text — already re-hydrated (real values, device-only). */
  text: string;
  tags: string[];
  /** Scope the suggestion was mined in; undefined = global. */
  projectId?: string;
  /** Chat session the fact came from (title is looked up at render time).
   *  Absent for suggestions distilled from pasted text (Memory's large-paste
   *  triage) — those have no source session. */
  sourceSessionId?: string;
  /** Document the fact was mined from ("Learn from documents"); mutually
   *  exclusive with `sourceSessionId`. The filename is looked up at render
   *  time so a renamed document shows its current name. */
  sourceDocId?: string;
  /** "create" = new fact; "update" = refines the item in `targetId`; "merge"
   *  = a tidy-run consolidation of `targetIds` into this one merged text
   *  (see `src/lib/memoryTidy.ts`'s `runTidy`/`applyMergeSuggestion`). */
  mode: "create" | "update" | "merge";
  /** For mode "update": the memory item this suggestion refines. */
  targetId?: string;
  /** For mode "merge": the memory items this suggestion consolidates —
   *  accepting supersedes all of them (see `applyMergeSuggestion`). */
  targetIds?: string[];
  /** For mode "update": the target's text AT THE TIME the suggestion was
   *  created, so a review UI can render a before/after conflict diff without
   *  a live lookup (the target may change or get superseded before review). */
  previousText?: string;
  createdAt: number;
}

const IDB = "memory_suggestions" as const;
/** Per-scope cap on the review queue — a runaway "Learn from chats" habit
 *  must not grow the queue without bound. When over cap, the OLDEST plain
 *  "create" suggestions are dropped first; "update"/"merge" suggestions (a
 *  refinement or a resolved conflict — rarer and more valuable, since losing
 *  one silently hides a real contradiction) are only dropped once no creates
 *  remain to drop. */
export const MAX_SUGGESTIONS_PER_SCOPE = 50;

let items: MemorySuggestion[] = [];
let loadStarted = false;
const listeners = new Set<() => void>();

function sortItems(list: MemorySuggestion[]): MemorySuggestion[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

/** Load persisted suggestions from IndexedDB once (browser only). */
function ensureLoaded(): void {
  if (loadStarted || typeof window === "undefined") return;
  loadStarted = true;
  void (async () => {
    const stored = await idbGetAll<MemorySuggestion>(IDB);
    // Merge, not overwrite: suggestions added while the async load was in flight
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

export function useMemorySuggestions(): MemorySuggestion[] {
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

export function createSuggestionId(): string {
  return `sug_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAllMemorySuggestions(): MemorySuggestion[] {
  ensureLoaded();
  return items;
}

const scopeKey = (s: MemorySuggestion): string => s.projectId ?? "__global__";

/** Enforce `MAX_SUGGESTIONS_PER_SCOPE`: when a scope holds more than the cap,
 *  drop the OLDEST suggestions first — plain "create"s before "update"/"merge"
 *  ones (see the field's doc comment). Returns the surviving list (all scopes)
 *  and the ids dropped, so the caller can also evict them from IndexedDB. */
function enforceQueueCap(list: MemorySuggestion[]): {
  kept: MemorySuggestion[];
  droppedIds: string[];
} {
  const byScope = new Map<string, MemorySuggestion[]>();
  for (const s of list) {
    const bucket = byScope.get(scopeKey(s));
    if (bucket) bucket.push(s);
    else byScope.set(scopeKey(s), [s]);
  }
  const droppedIds: string[] = [];
  const kept: MemorySuggestion[] = [];
  for (const bucket of byScope.values()) {
    if (bucket.length <= MAX_SUGGESTIONS_PER_SCOPE) {
      kept.push(...bucket);
      continue;
    }
    const oldestFirst = [...bucket].sort((a, b) => a.createdAt - b.createdAt);
    const creates = oldestFirst.filter((s) => s.mode === "create");
    const others = oldestFirst.filter((s) => s.mode !== "create");
    let overflow = bucket.length - MAX_SUGGESTIONS_PER_SCOPE;
    const toDrop = new Set<string>();
    for (const s of [...creates, ...others]) {
      if (overflow <= 0) break;
      toDrop.add(s.id);
      overflow--;
    }
    droppedIds.push(...toDrop);
    kept.push(...bucket.filter((s) => !toDrop.has(s.id)));
  }
  return { kept, droppedIds };
}

/** Queue new suggestions from a sweep (one IndexedDB transaction), then
 *  enforce the per-scope cap (see `MAX_SUGGESTIONS_PER_SCOPE`). */
export function addMemorySuggestions(list: MemorySuggestion[]): void {
  if (list.length === 0) return;
  ensureLoaded();
  const ids = new Set(list.map((s) => s.id));
  const merged = sortItems([...list, ...items.filter((x) => !ids.has(x.id))]);
  const { kept, droppedIds } = enforceQueueCap(merged);
  items = sortItems(kept);
  void idbPutAll(IDB, list);
  for (const id of droppedIds) void idbDelete(IDB, id);
  emit();
}

/** How many suggestions from `scope`'s own sweep are waiting for review.
 *
 *  Strict scope (`inScope`), matching the sweep that produced them: a project
 *  sweep's results belong to that project, and the global sweep's to the
 *  global pool. This is what the "Learn from…" button reports, so the number
 *  it shows is always the number that sweep just created. */
export function countSuggestionsInScope(scope: RagScope, kind?: "chats" | "documents"): number {
  const ok = inScope(scope);
  return getAllMemorySuggestions().filter((s) => ok(s) && matchesKind(s, kind)).length;
}

/** Which sweep produced a suggestion, by its provenance. Without this the two
 *  "Learn from…" buttons would both advertise the same queue, so the documents
 *  button would claim credit for facts mined from chats. A paste-distilled
 *  suggestion has neither source and belongs to no sweep — it is never
 *  counted. */
function matchesKind(s: MemorySuggestion, kind?: "chats" | "documents"): boolean {
  if (!kind) return true;
  return kind === "chats" ? !!s.sourceSessionId : !!s.sourceDocId;
}

/** How many suggestions in `scope` are older than `olderThanDays` (default
 *  30) — drives a future "collapse older suggestions" UI affordance. Pure
 *  local read, no relay. */
export function countStaleSuggestions(scope: RagScope, olderThanDays = 30): number {
  const ok = inScope(scope);
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  return getAllMemorySuggestions().filter((s) => ok(s) && s.createdAt < cutoff).length;
}

/** Remove a suggestion (both on Keep — it was consumed — and on Discard). */
export function deleteMemorySuggestion(id: string): void {
  ensureLoaded();
  if (!items.some((x) => x.id === id)) return;
  items = items.filter((x) => x.id !== id);
  void idbDelete(IDB, id);
  emit();
}

/** Reset the in-memory + cached queue (tests; not needed on logout — rows are
 *  sealed per-account and unreadable ciphertext is dropped on next load). */
export function resetMemorySuggestions(): void {
  items = [];
  loadStarted = false;
  void idbClear(IDB);
  emit();
}

// --- sweep cursors ----------------------------------------------------------
// Per chat session: the id of the last message a successful sweep processed,
// so re-runs only look at NEW messages. A failed session never advances its
// cursor (memoryExtract retries it on the next run).
//
// P5 (memory-lifecycle-p5.md §"Sweep-cursor sync"): cursors now live in
// quonStore's synced `prefs` blob (message-id watermarks only, no content),
// so "Learn from chats" progress follows the account cross-device instead of
// staying stuck to whichever device happened to run the sweep — otherwise a
// second device re-relays (and re-costs) content the first device already
// processed. quonStore's `applyRemotePrefs` key-wise MAX-merges the cursor
// map on every pull (a remote cursor can only ever advance a local one, never
// rewind it — see that function's doc comment), independent of the prefs
// blob's own last-write-wins clock. These wrappers keep the EXACT signatures
// this module always had, so `memoryExtract.ts` doesn't need to know the
// storage moved.
export {
  getStoreSweepCursor as getSweepCursor,
  setStoreSweepCursor as setSweepCursor,
  resetStoreSweepCursors as resetSweepCursors,
};
