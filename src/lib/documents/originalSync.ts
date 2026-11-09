/**
 * Cross-device sync of original document bytes (sync collection `originals`).
 *
 * Upload (background, best-effort): after a manual upload is indexed, the
 * original bytes are encrypted whole under the Master-Key-derived originals key
 * and the ciphertext is pushed as <=3 MiB chunks (`orig:<docId>:<i>`) through the
 * existing `/sync/push`. Only when every chunk is accepted does the DocItem get
 * its `original` manifest ({size, chunkCount}) - which syncs through the normal
 * `documents` collection and is what tells other devices an original exists.
 *
 * Resume: the manifest doubles as the durable upload state - absent manifest on
 * a ready manual upload whose bytes are in the local cache means "incomplete",
 * and the start-of-session scan re-uploads it (this also opportunistically
 * backfills originals saved by builds that predate syncing). Chunks can't be
 * resumed mid-file across sessions (each encryption pass has a fresh nonce), so
 * a retry restarts from chunk 0; files are <=20 MB so that's cheap.
 *
 * Download is deliberately LAZY - `originals` is not in the delta-pull loop, so
 * originals never auto-download onto every device. The viewer calls
 * `fetchOriginal` when it opens a doc whose manifest promises bytes that aren't
 * cached locally; chunks are pulled sequentially via `/sync/blob`, reassembled,
 * decrypted (size-checked) and written into the local originals cache so the
 * doc is offline-viewable afterwards.
 *
 * Quota: the server enforces a per-user byte cap on this collection and rejects
 * with the distinct push status "quota". We then tombstone the partial chunks
 * (they'd otherwise eat quota invisibly), flag the doc for the Documents-screen
 * banner, and leave the manifest absent - text sync/search are unaffected, and
 * the next app start retries once (the user may have freed space).
 *
 * Zero-knowledge invariant: the server only ever sees ciphertext; reassembly
 * and decryption happen client-side, and a failed/partial fetch falls back to
 * the extracted-text view - never plaintext to the server.
 */

import { syncApi, type BlobIn } from "@/lib/api/syncApi";
import { getMasterKey } from "@/lib/authStore";
import {
  base64ToBytes,
  bytesToBase64,
  decryptBytes,
  deriveOriginalsKey,
  encryptBytes,
} from "@/lib/crypto/quonCrypto";
import {
  getAllDocuments,
  getDocument,
  onDocumentDeleted,
  setDocumentOriginal,
  whenDocumentsLoaded,
  type DocItem,
  type OriginalManifest,
} from "@/lib/documentStore";
import {
  assembleChunks,
  chunkBytes,
  ORIGINALS_COLLECTION,
  originalChunkId,
} from "./originalChunks";
import { loadOriginal, originalKind, saveOriginalBytes } from "./originalStore";
import { currentPolicy } from "@/lib/deviceClass";
import { diagAppend } from "@/lib/diagLog";

/** Delay before the start-of-session scan, so the first remote pull has
 *  (usually) landed; the scan additionally awaits the documents store's own
 *  IndexedDB hydration (`whenDocumentsLoaded`), so this is a courtesy for the
 *  remote pull, not a race-prone guess. */
const SCAN_DELAY_MS = 4000;

// --- per-doc sync issues (drives the Documents-screen banner) ---------------

/** "quota": the server's per-user originals cap rejected the upload.
 *  "toobig": the file exceeds the per-file cap - never cached or synced.
 *  "device": cached here, but larger than this device can safely push (the
 *  upload holds the file ~3x in memory - bytes, sealed, base64 chunks - which
 *  is what kills the page at boot on iPhones). Syncs from a desktop; on this
 *  device the original stays local. */
export type OriginalSyncIssue = "quota" | "toobig" | "device";

const EMPTY_ISSUES: Readonly<Record<string, OriginalSyncIssue>> = Object.freeze({});
let issues: Readonly<Record<string, OriginalSyncIssue>> = EMPTY_ISSUES;
const issueListeners = new Set<() => void>();

/** Flag a doc whose original can never sync because the file exceeds the
 *  per-file cap (called from ingest - the only place that still has the size). */
export function reportOriginalTooBig(docId: string): void {
  setIssue(docId, "toobig");
}

function setIssue(docId: string, issue: OriginalSyncIssue | null): void {
  if ((issues[docId] ?? null) === issue) return;
  const next: Record<string, OriginalSyncIssue> = { ...issues };
  if (issue) next[docId] = issue;
  else delete next[docId];
  issues = Object.keys(next).length ? next : EMPTY_ISSUES;
  for (const l of issueListeners) l();
}

/** Snapshot of docs whose original couldn't be synced (docId -> issue).
 *  Stable reference between changes - useSyncExternalStore-compatible. */
export function getOriginalSyncIssues(): Readonly<Record<string, OriginalSyncIssue>> {
  return issues;
}

export function getOriginalSyncIssuesServer(): Readonly<Record<string, OriginalSyncIssue>> {
  return EMPTY_ISSUES;
}

export function subscribeOriginalSyncIssues(cb: () => void): () => void {
  issueListeners.add(cb);
  return () => issueListeners.delete(cb);
}

// --- upload -----------------------------------------------------------------

let stopped = true;
const inFlight = new Set<string>();

/** Tombstone every synced chunk of a document (delete or partial-upload cleanup).
 *  Best-effort - tombstones are idempotent and re-pushing costs nothing. */
export async function tombstoneOriginalChunks(docId: string, chunkCount: number): Promise<void> {
  if (chunkCount <= 0) return;
  const now = Date.now();
  const changes: BlobIn[] = Array.from({ length: chunkCount }, (_, i) => ({
    collection: ORIGINALS_COLLECTION,
    id: originalChunkId(docId, i),
    ciphertext: "",
    updated_at: now,
    deleted: true,
  }));
  try {
    await syncApi.push(changes);
  } catch {
    /* offline - the chunks linger until the doc id is re-deleted; acceptable */
  }
}

/** Pure decision: is this doc a candidate for uploading its original bytes?
 *  Connector imports (a `source`) are INCLUDED - they keep original bytes now
 *  (ingest `keepOriginal`), so a Dropbox/folder PDF's layout must reach other
 *  devices. The cached-bytes check is the real gate; this is the cheap
 *  pre-filter. Exported for the regression test (the earlier bug: this returned
 *  false for any sourced doc, so connector originals never uploaded/synced). */
export function isUploadCandidate(doc: DocItem | undefined): boolean {
  // NB: deliberately does not look at doc.source - the old bug did, which
  // excluded every connector import from ever uploading its original.
  return !!doc && doc.status === "ready" && !doc.original;
}

async function uploadOriginal(docId: string): Promise<void> {
  if (inFlight.has(docId)) return;
  inFlight.add(docId);
  try {
    const doc = getDocument(docId);
    if (!isUploadCandidate(doc)) return;
    const mk = getMasterKey();
    if (!mk) return;
    const bytes = await loadOriginal(docId);
    if (!bytes || bytes.length === 0) return; // nothing cached on this device (text/md, or older import)
    if (bytes.length > currentPolicy().maxAutoUploadBytes) {
      diagAppend(
        `originals: upload skipped, ${Math.round(bytes.length / 1048576)}MB > device cap (policy=${currentPolicy().reason})`,
      );
      setIssue(docId, "device");
      return;
    }

    const sealed = encryptBytes(bytes, deriveOriginalsKey(mk));
    const chunks = chunkBytes(sealed);
    const updatedAt = Date.now();
    for (let i = 0; i < chunks.length; i++) {
      // Doc deleted (or logout) mid-upload -> stop and clear what we pushed.
      if (stopped || !getDocument(docId)) {
        await tombstoneOriginalChunks(docId, i);
        return;
      }
      // One chunk per request: bounds memory/body size, gives early quota
      // detection, and a transient failure loses at most one chunk of progress.
      const res = await syncApi.push([
        {
          collection: ORIGINALS_COLLECTION,
          id: originalChunkId(docId, i),
          ciphertext: bytesToBase64(chunks[i]),
          updated_at: updatedAt,
        },
      ]);
      const status = res.results[0]?.status;
      if (status === "quota") {
        await tombstoneOriginalChunks(docId, i); // free the partial chunks
        setIssue(docId, "quota");
        return;
      }
      if (status !== "accepted" && status !== "stale") return; // unknown -> retry next start
    }
    setDocumentOriginal(docId, { size: bytes.length, chunkCount: chunks.length });
    setIssue(docId, null);
  } catch {
    /* transient (offline, 5xx) - manifest stays absent -> retried next start */
  } finally {
    inFlight.delete(docId);
  }
}

/** Kick off the background upload for a just-ingested document (fire-and-forget;
 *  never blocks or fails the ingest path). */
export function queueOriginalUpload(docId: string): void {
  void uploadOriginal(docId);
}

/** Upload every ready manual doc that has local original bytes but no manifest:
 *  resumes interrupted uploads AND backfills pre-sync local-only originals.
 *  Awaits the documents store's hydration first - a fixed timer alone raced the
 *  async IndexedDB load and could scan an empty list, silently skipping the
 *  whole session's backfill. */
let scanning = false;
async function scanPendingUploads(): Promise<void> {
  if (scanning) return;
  // Safe mode (deviceClass.ts): a boot that keeps dying must not start the
  // one background job that can take the whole page down 4 s after boot.
  if (!currentPolicy().backgroundOriginalsUpload) {
    diagAppend(`originals: boot scan skipped (policy=${currentPolicy().reason})`);
    return;
  }
  scanning = true;
  try {
    await whenDocumentsLoaded();
    for (const d of getAllDocuments()) {
      if (stopped) return;
      // Connector imports are included (they keep original bytes now); the
      // kind filter + uploadOriginal's own "no cached bytes" check are the gate.
      if (d.status !== "ready" || d.original) continue;
      const kind = originalKind(d.mime, d.filename);
      if (!kind || kind === "md") continue; // text formats / md keep no bytes
      await uploadOriginal(d.id); // sequential - don't saturate the connection
    }
  } finally {
    scanning = false;
  }
}

/** Re-run the pending-uploads scan on demand (Documents screen mount, or after
 *  the user freed quota). No-ops while sync is stopped or a scan is running. */
export function rescanOriginals(): void {
  if (stopped) return;
  void scanPendingUploads();
}

// --- download (lazy, viewer-driven) ------------------------------------------

/** Fetch, reassemble, decrypt and locally cache a document's original bytes.
 *  Returns null on any failure (missing chunk, wrong key, size mismatch) - the
 *  viewer then falls back to the extracted-text view. */
export async function fetchOriginal(
  docId: string,
  manifest: OriginalManifest,
  onProgress?: (fetched: number, total: number) => void,
): Promise<Uint8Array | null> {
  const mk = getMasterKey();
  if (!mk || manifest.chunkCount <= 0) return null;
  try {
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < manifest.chunkCount; i++) {
      const blob = await syncApi.blob(ORIGINALS_COLLECTION, originalChunkId(docId, i));
      if (!blob.ciphertext) return null;
      chunks.push(base64ToBytes(blob.ciphertext));
      onProgress?.(i + 1, manifest.chunkCount);
    }
    const bytes = decryptBytes(assembleChunks(chunks), deriveOriginalsKey(mk));
    if (bytes.length !== manifest.size) return null;
    void saveOriginalBytes(docId, bytes); // offline next time - best-effort
    return bytes;
  } catch {
    return null;
  }
}

// --- lifecycle (driven by syncEngine.startSync/stopSync) ----------------------

let scanTimer: ReturnType<typeof setTimeout> | null = null;
let unsubDelete: (() => void) | null = null;
const onOnline = () => rescanOriginals();

/** Begin background originals sync (idempotent). */
export function startOriginalsSync(): void {
  if (!stopped) return;
  stopped = false;
  // Locally deleted doc -> tombstone its synced chunks (client knows chunkCount
  // from the manifest). Remote tombstones are the deleting device's job.
  unsubDelete = onDocumentDeleted((doc) => {
    setIssue(doc.id, null);
    if (doc.original) void tombstoneOriginalChunks(doc.id, doc.original.chunkCount);
  });
  scanTimer = setTimeout(() => void scanPendingUploads(), SCAN_DELAY_MS);
  // A session can outlive many connectivity changes (mobile PWA left open for
  // days) - retry pending uploads whenever the device comes back online instead
  // of only at the next app start.
  window.addEventListener("online", onOnline);
}

/** Stop uploads and clear session state (logout). */
export function stopOriginalsSync(): void {
  stopped = true;
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = null;
  unsubDelete?.();
  unsubDelete = null;
  window.removeEventListener("online", onOnline);
  issues = EMPTY_ISSUES;
  for (const l of issueListeners) l();
}
