/**
 * Project store — optional containers that group chats and scope Memory/Documents
 * to a topic, plus a per-project instruction (system prompt). End-to-end encrypted
 * and synced as opaque blobs (collection `projects`), exactly like chat/memory/docs.
 *
 * Same shape as the Memory store: a `useSyncExternalStore` hook + an **IndexedDB**
 * cache + local-change/delete listeners the sync engine subscribes to. Projects are
 * opt-in — with none created the app behaves exactly as before. A chat/memory/doc
 * "belongs to" a project purely via its own optional `projectId` field; the project
 * record here only holds the name, instruction and a cosmetic colour.
 */

import { useSyncExternalStore } from "react";

import type { SyncStore } from "./collectionSync";
import { getAllDocuments, setDocumentProject } from "./documentStore";
import { idbClear, idbDelete, idbGetAll, idbPut } from "./idbStore";
import { getAllMemory, setMemoryProject } from "./memoryStore";
import {
  getAllSessions,
  setChatProject,
  type ProtectionLevel,
  type ReasoningEffort,
} from "./quonStore";

/** Fixed accent palette (deterministic theming; not free-form colour input).
 *  Ordered so consecutive auto-assigned colours are visually far apart in hue. */
export const PROJECT_COLORS = [
  "indigo",
  "green",
  "yellow",
  "sky",
  "rose",
  "teal",
  "purple",
  "orange",
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];

/** Map a project colour key to a hex for dots/accents (shared by sidebar + screen). */
export const PROJECT_COLOR_HEX: Record<ProjectColor, string> = {
  indigo: "#818cf8",
  green: "#22c55e",
  yellow: "#f59e0b",
  sky: "#38bdf8",
  rose: "#fb7185",
  teal: "#2dd4bf",
  purple: "#c084fc",
  orange: "#fb923c",
};

/** Pick the accent for a NEW project: the LEAST-used colour among existing
 *  projects (ties broken by palette order). Round-robin by count collides after
 *  a delete-then-create (two projects land on the same colour — the reported
 *  "overlapping bubble colours" bug); least-used spreads evenly and only repeats
 *  once every colour is already in use. */
export function nextProjectColor(existing: Pick<ProjectItem, "color">[]): ProjectColor {
  const counts = new Map<ProjectColor, number>(PROJECT_COLORS.map((c) => [c, 0]));
  for (const p of existing) {
    const c = p.color ?? "indigo";
    if (counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: ProjectColor = PROJECT_COLORS[0];
  let bestCount = Infinity;
  for (const c of PROJECT_COLORS) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) {
      bestCount = n;
      best = c;
    }
  }
  return best;
}

export interface ProjectItem {
  id: string;
  name: string;
  /** Per-project system prompt; user-authored, so scrubbed before injection. */
  instructions?: string;
  /** Cosmetic accent (one of PROJECT_COLORS); falls back to "indigo" in the UI. */
  color?: ProjectColor;
  /**
   * Per-project chat defaults — all optional (unset = use the global setting), so
   * items encrypted before these fields existed keep decoding unchanged. They only
   * SEED a chat's initial state when it is opened/created in this project
   * (see `resolveProjectChatSeed`); later per-chat changes always win.
   */
  /** Chat model to preselect (a ChatModel id, e.g. "anthropic/claude-sonnet-4.5"). */
  defaultModelId?: string;
  /** Protection level to start chats with (the UI offers none / local / review). */
  defaultProtection?: ProtectionLevel;
  /** Reasoning effort to start chats with (applied as the per-chat override). */
  defaultReasoningEffort?: ReasoningEffort;
  /** Entity types to turn off for this project's chats (drop-list; unset = global). */
  defaultDisabledEntityTypes?: string[];
  createdAt: number;
  updatedAt: number;
}

const IDB = "projects" as const;

let items: ProjectItem[] = [];
let loadStarted = false;
const listeners = new Set<() => void>();
const changeListeners = new Set<(item: ProjectItem) => void>();
const deleteListeners = new Set<(ids: string[]) => void>();

/** Stable order: oldest first, so groups don't jump around when edited. */
function sortItems(list: ProjectItem[]): ProjectItem[] {
  return [...list].sort((a, b) => a.createdAt - b.createdAt);
}

/** Load persisted projects from IndexedDB once. */
function ensureLoaded(): void {
  if (loadStarted || typeof window === "undefined") return;
  loadStarted = true;
  void (async () => {
    const stored = await idbGetAll<ProjectItem>(IDB);
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

export function useProjects(): ProjectItem[] {
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

export function createProjectId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAllProjects(): ProjectItem[] {
  ensureLoaded();
  return items;
}

export function getProject(id: string): ProjectItem | undefined {
  ensureLoaded();
  return items.find((x) => x.id === id);
}

/** Insert or update a project (fires sync push). */
export function upsertProject(item: ProjectItem): void {
  ensureLoaded();
  const next = { ...item, updatedAt: item.updatedAt || Date.now() };
  items = sortItems([next, ...items.filter((x) => x.id !== next.id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Delete a project record only (fires sync tombstone). Callers that also need to
 *  release the project's chats/items use `deleteProjectAndOrphanContent`. */
export function deleteProject(id: string): void {
  ensureLoaded();
  if (!items.some((x) => x.id === id)) return;
  items = items.filter((x) => x.id !== id);
  void idbDelete(IDB, id);
  emit();
  for (const l of deleteListeners) l([id]);
}

/** Delete a project AND release its content rather than destroying it: every chat,
 *  memory item and document scoped to this project is moved back to the global pool
 *  (projectId cleared), then the project record is tombstoned. Never deletes user
 *  content. Each released item re-syncs with a fresh updatedAt. */
export function deleteProjectAndOrphanContent(id: string): void {
  for (const s of getAllSessions()) if (s.projectId === id) setChatProject(s.id, undefined);
  for (const m of getAllMemory()) if (m.projectId === id) setMemoryProject(m.id, undefined);
  for (const d of getAllDocuments()) if (d.projectId === id) setDocumentProject(d.id, undefined);
  deleteProject(id);
}

// --- sync integration (no echo back to the server) -------------------------

export function applyRemoteProject(item: ProjectItem): void {
  ensureLoaded();
  const existing = items.find((x) => x.id === item.id);
  if (existing && existing.updatedAt >= item.updatedAt) return;
  items = sortItems([item, ...items.filter((x) => x.id !== item.id)]);
  void idbPut(IDB, item);
  emit();
}

export function applyRemoteProjectDeletion(id: string): void {
  ensureLoaded();
  if (!items.some((x) => x.id === id)) return;
  items = items.filter((x) => x.id !== id);
  void idbDelete(IDB, id);
  emit();
}

/** Reset the in-memory + cached state (called on logout). */
export function resetProjects(): void {
  items = [];
  loadStarted = false;
  void idbClear(IDB);
  emit();
}

/** SyncStore adapter consumed by `createCollectionSync`. */
export const projectSyncStore: SyncStore<ProjectItem> = {
  getAll: getAllProjects,
  idOf: (it) => it.id,
  updatedAtOf: (it) => it.updatedAt,
  applyRemote: applyRemoteProject,
  applyRemoteDeletion: applyRemoteProjectDeletion,
  onChange: (cb) => {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  },
  onDelete: (cb) => {
    deleteListeners.add(cb);
    return () => deleteListeners.delete(cb);
  },
};
