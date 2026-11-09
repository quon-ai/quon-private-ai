/**
 * Document store - uploaded files, extracted + embedded **on-device**, then
 * end-to-end encrypted and synced as opaque blobs (collection `documents`).
 *
 * One blob per document (chunks nested), mirroring the chat-history pattern: a
 * `useSyncExternalStore` hook + an **IndexedDB** cache + change/delete listeners
 * the sync engine subscribes to. The server only ever stores ciphertext.
 *
 * Persistence is IndexedDB (not localStorage): documents + their embeddings
 * easily exceed localStorage's ~5MB cap. The in-memory `docs` array stays the
 * synchronous source of truth; IndexedDB loads into it asynchronously on first
 * use and is written per-record on each change.
 */

import { useSyncExternalStore } from "react";

import type { SyncStore } from "./collectionSync";
import { clearOriginals, deleteOriginal } from "./documents/originalStore";
import { EMBED_MODEL } from "./embedding/embedder";
import { idbClear, idbDelete, idbGetAll, idbPut, idbPutAll } from "./idbStore";

export type DocStatus = "processing" | "ready" | "failed";

export interface DocChunk {
  index: number;
  /** Original chunk text (encrypted at rest). */
  text: string;
  /** On-device embedding of `text`; absent if embedding failed. */
  embedding?: number[];
}

/** Where a document came from. Absent = manual upload. Additive/optional - the
 *  seam connectors hang off: idempotent re-import (`ref` is a stable id), clean
 *  removal (filter by `connector`), and future write-back/re-sync. */
export interface DocSource {
  /** Connector id, e.g. "obsidian" (matches Connector.id). */
  connector: string;
  /** Stable id within the source - for Obsidian the vault-relative path. */
  ref: string;
  /** Content hash, to skip re-embedding unchanged items on re-import. */
  hash?: string;
}

/** Manifest of a document's synced original bytes: the ciphertext lives in the
 *  `originals` collection as `chunkCount` blobs (`orig:<docId>:<i>`), `size` is
 *  the plaintext byte length (integrity check after reassembly+decrypt). Its
 *  presence tells other devices an original can be fetched - without shipping
 *  the bytes in the DocItem blob. Additive: older builds simply ignore it. */
export interface OriginalManifest {
  size: number;
  chunkCount: number;
}

export interface DocItem {
  id: string;
  filename: string;
  mime: string;
  status: DocStatus;
  error?: string;
  chunks: DocChunk[];
  /** Clean extracted text (pre-chunking) for viewing / re-attaching in chat.
   *  Absent on documents ingested before this field existed -> reconstructed from
   *  chunks by `getDocumentText`. */
  fullText?: string;
  dim?: number;
  /** Id of the embedding model the chunk vectors were produced with. */
  embModel?: string;
  /** Project this document belongs to; undefined = global pool. */
  projectId?: string;
  /** Provenance when imported by a connector; absent for manual uploads. */
  source?: DocSource;
  /** Set once the original file bytes are fully uploaded to the `originals`
   *  sync collection (documents/originalSync.ts). Absent = no synced original. */
  original?: OriginalManifest;
  /** "Always in context": a pinned document is injected into every in-scope chat
   *  send (like a pinned Memory fact), bypassing relevance retrieval. Optional +
   *  additive - syncs as ciphertext through the existing `documents` collection,
   *  no migration. */
  pinned?: boolean;
  /** Hand-redactions saved ON this document ("Immer schwärzen" in the viewer /
   *  Review panel). Merged into `always_redact` for every scrub that involves
   *  this document, so the values are enforced (scrubText verifies) without
   *  polluting the user's global Settings list. Optional + additive - syncs as
   *  ciphertext like every other doc field, no migration. */
  redactTerms?: string[];
  createdAt: number;
  updatedAt: number;
}

/** A flattened chunk with its source doc, for cross-document search. */
export interface DocChunkRef {
  docId: string;
  filename: string;
  index: number;
  text: string;
  embedding?: number[];
  /** Project of the parent document (carried through so retrieval can scope). */
  projectId?: string;
}

const STORAGE_KEY = "quon_documents_v1"; // legacy localStorage cache (migrated to IndexedDB)
const IDB = "documents" as const;

let docs: DocItem[] = [];
let loadStarted = false;
const listeners = new Set<() => void>();
const changeListeners = new Set<(doc: DocItem) => void>();
const deleteListeners = new Set<(ids: string[]) => void>();
// Local deletes only, with the full pre-delete item (see deleteDocument).
const deleteDetailListeners = new Set<(doc: DocItem) => void>();

function sortDocs(list: DocItem[]): DocItem[] {
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function normalize(list: DocItem[]): DocItem[] {
  // A doc left "processing" means ingest was interrupted (tab closed / reload) -
  // no worker survives that, so surface it as failed rather than a spinner that
  // never resolves. The user can re-upload.
  return sortDocs(
    list
      .filter((d) => d && d.id)
      .map((d) =>
        d.status === "processing"
          ? { ...d, status: "failed" as const, error: "Ingestion was interrupted — re-upload" }
          : d,
      ),
  );
}

// Resolves once the initial IndexedDB hydration has merged into `docs` - lets
// background work (the originals upload scan) wait for the real list instead of
// racing the async load with a timer. Re-armed on resetDocuments (logout) so a
// second session waits for its own hydration.
let loadedResolve: () => void;
let loadedPromise: Promise<void>;
function armLoadedPromise(): void {
  loadedPromise = new Promise<void>((res) => {
    loadedResolve = res;
  });
}
armLoadedPromise();

/** Resolves when the persisted documents have hydrated (immediately on the
 *  server, where there is nothing to load). Triggers the load if needed. */
export function whenDocumentsLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  ensureLoaded();
  return loadedPromise;
}

/** Load persisted docs from IndexedDB once, migrating any legacy localStorage cache. */
function ensureLoaded(): void {
  if (loadStarted || typeof window === "undefined") return;
  loadStarted = true;
  void (async () => {
    let stored = await idbGetAll<DocItem>(IDB);
    if (stored.length === 0) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = (JSON.parse(raw) as DocItem[]).filter((d) => d && d.id);
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
    // Merge, not overwrite: any write that landed while the async load was in
    // flight (already in `docs`) takes precedence over the loaded snapshot, so a
    // fast upsert/applyRemote isn't clobbered when the load resolves.
    const byId = new Map(normalize(stored).map((d) => [d.id, d]));
    for (const d of docs) byId.set(d.id, d);
    docs = sortDocs([...byId.values()]);
    emit();
    loadedResolve();
  })();
}

function emit(): void {
  for (const l of listeners) l();
}

export function useDocuments(): DocItem[] {
  return useSyncExternalStore(
    (l) => {
      ensureLoaded();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => docs,
    () => [],
  );
}

export function createDocumentId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getAllDocuments(): DocItem[] {
  ensureLoaded();
  return docs;
}

export function getDocument(id: string): DocItem | undefined {
  ensureLoaded();
  return docs.find((d) => d.id === id);
}

// Wider than the chunker's overlap (64) so legacy reconstruction reliably finds the
// seam between two chunks.
const _OVERLAP_WINDOW = 160;

/** A document's readable text. Newer docs carry the clean `fullText`; older ones are
 *  rebuilt by joining chunks in order and stripping the tail/head overlap the chunker
 *  added, so the viewer/attachment isn't littered with duplicated sentences. */
export function getDocumentText(doc: DocItem): string {
  if (doc.fullText) return doc.fullText;
  const ordered = [...doc.chunks].sort((a, b) => a.index - b.index);
  let out = "";
  for (const c of ordered) {
    if (!out) {
      out = c.text;
      continue;
    }
    const max = Math.min(out.length, c.text.length, _OVERLAP_WINDOW);
    let overlap = 0;
    for (let n = max; n > 0; n--) {
      if (out.endsWith(c.text.slice(0, n))) {
        overlap = n;
        break;
      }
    }
    out += (overlap === 0 ? "\n" : "") + c.text.slice(overlap);
  }
  return out;
}

/** All documents imported by a given connector (provenance query). Used for
 *  idempotent re-import and clean removal. */
export function getDocumentsByConnector(connector: string): DocItem[] {
  ensureLoaded();
  return docs.filter((d) => d.source?.connector === connector);
}

/** All chunks across all ready documents, flattened for search. */
export function allDocChunks(): DocChunkRef[] {
  ensureLoaded();
  const out: DocChunkRef[] = [];
  for (const d of docs) {
    // Only chunks embedded with the *current* model are comparable to a query
    // vector. Stale-model docs are skipped until re-embedded (ensureEmbeddingsCurrent).
    if (d.status !== "ready" || d.embModel !== EMBED_MODEL) continue;
    for (const c of d.chunks) {
      out.push({
        docId: d.id,
        filename: d.filename,
        index: c.index,
        text: c.text,
        embedding: c.embedding,
        projectId: d.projectId,
      });
    }
  }
  return out;
}

/** Insert or update a document (fires sync push). */
export function upsertDocument(doc: DocItem): void {
  ensureLoaded();
  const next = { ...doc, updatedAt: doc.updatedAt || Date.now() };
  docs = sortDocs([next, ...docs.filter((d) => d.id !== next.id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Assign (or clear, with `undefined`) the project a document belongs to.
 *  Pure metadata - chunks/embeddings are untouched. Fires sync push. */
export function setDocumentProject(id: string, projectId: string | undefined): void {
  ensureLoaded();
  const existing = docs.find((d) => d.id === id);
  if (!existing || existing.projectId === projectId) return;
  const next = { ...existing, projectId, updatedAt: Date.now() };
  docs = sortDocs([next, ...docs.filter((d) => d.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Add one saved hand-redaction to a document. Case-insensitive de-dup -
 *  matching is case-insensitive anyway, a second spelling is just a confusing
 *  duplicate. Bumps `updatedAt`, so it syncs like any doc edit. */
export function addDocumentRedactTerm(id: string, term: string): void {
  ensureLoaded();
  const t = term.trim();
  const existing = docs.find((d) => d.id === id);
  if (!t || !existing) return;
  const have = existing.redactTerms ?? [];
  if (have.some((x) => x.trim().toLowerCase() === t.toLowerCase())) return;
  const next = { ...existing, redactTerms: [...have, t], updatedAt: Date.now() };
  docs = sortDocs([next, ...docs.filter((d) => d.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Remove a saved hand-redaction (case-insensitive). Syncs like any doc edit. */
export function removeDocumentRedactTerm(id: string, term: string): void {
  ensureLoaded();
  const existing = docs.find((d) => d.id === id);
  const have = existing?.redactTerms ?? [];
  const kept = have.filter((x) => x.trim().toLowerCase() !== term.trim().toLowerCase());
  if (!existing || kept.length === have.length) return;
  const next = { ...existing, redactTerms: kept, updatedAt: Date.now() };
  docs = sortDocs([next, ...docs.filter((d) => d.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Union of saved hand-redactions across the given documents - what a scrub
 *  involving them must additionally enforce. Case-insensitive de-dup. */
export function collectRedactTerms(docIds: readonly string[]): string[] {
  ensureLoaded();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of docIds) {
    for (const t of getDocument(id)?.redactTerms ?? []) {
      const k = t.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

/** Pin/unpin a document ("always in context"). Syncs like any doc edit. */
export function setDocumentPinned(id: string, pinned: boolean): void {
  ensureLoaded();
  const existing = docs.find((d) => d.id === id);
  if (!existing || !!existing.pinned === pinned) return;
  const next = { ...existing, pinned, updatedAt: Date.now() };
  docs = sortDocs([next, ...docs.filter((d) => d.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Rename a document. The filename is only a label - chunks, embeddings and the
 *  connector `source` (which drives idempotent re-import) are untouched, so a
 *  renamed connector document is still recognised as the same file on re-import.
 *  Returns the trimmed name that was stored, or null when nothing changed. */
export function renameDocument(id: string, filename: string): string | null {
  ensureLoaded();
  const existing = docs.find((d) => d.id === id);
  const clean = filename.trim();
  if (!existing || !clean || clean === existing.filename) return null;
  const next = { ...existing, filename: clean, updatedAt: Date.now() };
  docs = sortDocs([next, ...docs.filter((d) => d.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
  return clean;
}

/** Attach (or clear, with `undefined`) the synced-original manifest - called by
 *  originalSync once every chunk is uploaded. Fires sync push, so the manifest
 *  reaches other devices through the normal `documents` collection. */
export function setDocumentOriginal(id: string, original: OriginalManifest | undefined): void {
  ensureLoaded();
  const existing = docs.find((d) => d.id === id);
  if (!existing) return;
  if (
    existing.original?.chunkCount === original?.chunkCount &&
    existing.original?.size === original?.size
  ) {
    return; // no-op - don't bump updatedAt / re-push
  }
  const next = { ...existing, original, updatedAt: Date.now() };
  docs = sortDocs([next, ...docs.filter((d) => d.id !== id)]);
  void idbPut(IDB, next);
  emit();
  for (const l of changeListeners) l(next);
}

/** Delete a document (fires sync tombstone). */
export function deleteDocument(id: string): void {
  ensureLoaded();
  const existing = docs.find((d) => d.id === id);
  if (!existing) return;
  docs = docs.filter((d) => d.id !== id);
  void idbDelete(IDB, id);
  void deleteOriginal(id); // cached original bytes must not outlive the document
  emit();
  for (const l of deleteListeners) l([id]);
  // Detail listeners get the full doc - originalSync needs `original.chunkCount`
  // to tombstone the synced byte chunks, which the id-only event can't carry.
  for (const l of deleteDetailListeners) l(existing);
}

/** Subscribe to local document deletions with the full deleted item (remote
 *  tombstones don't fire this - the deleting device cleans up its own synced
 *  original chunks). Used by documents/originalSync.ts. */
export function onDocumentDeleted(cb: (doc: DocItem) => void): () => void {
  deleteDetailListeners.add(cb);
  return () => deleteDetailListeners.delete(cb);
}

// --- sync integration (no echo back to the server) -------------------------

export function applyRemoteDocument(doc: DocItem): void {
  ensureLoaded();
  const existing = docs.find((d) => d.id === doc.id);
  if (existing && existing.updatedAt >= doc.updatedAt) return;
  docs = sortDocs([doc, ...docs.filter((d) => d.id !== doc.id)]);
  void idbPut(IDB, doc);
  emit();
}

export function applyRemoteDocumentDeletion(id: string): void {
  ensureLoaded();
  if (!docs.some((d) => d.id === id)) return;
  docs = docs.filter((d) => d.id !== id);
  void idbDelete(IDB, id);
  void deleteOriginal(id); // cached original bytes must not outlive the document
  emit();
}

/** Reset the in-memory + cached state (called on logout). */
export function resetDocuments(): void {
  docs = [];
  loadStarted = false;
  armLoadedPromise(); // the next session's scan must wait for its hydration
  void idbClear(IDB);
  void clearOriginals();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** SyncStore adapter consumed by `createCollectionSync`. */
export const documentSyncStore: SyncStore<DocItem> = {
  getAll: getAllDocuments,
  idOf: (d) => d.id,
  updatedAtOf: (d) => d.updatedAt,
  applyRemote: applyRemoteDocument,
  applyRemoteDeletion: applyRemoteDocumentDeletion,
  onChange: (cb) => {
    changeListeners.add(cb);
    return () => changeListeners.delete(cb);
  },
  onDelete: (cb) => {
    deleteListeners.add(cb);
    return () => deleteListeners.delete(cb);
  },
};
