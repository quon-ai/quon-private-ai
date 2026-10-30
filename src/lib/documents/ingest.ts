/**
 * Shared on-device document ingest: extract → chunk → embed → encrypted-synced
 * upsert. The single pipeline behind BOTH manual uploads (ScreenDocuments) and
 * connectors (e.g. Obsidian). The caller owns the document id, optional provenance
 * (`source`) and progress reporting, so the same code path serves a one-off file
 * and an idempotent re-import.
 */

import { currentPolicy } from "@/lib/deviceClass";
import { chunkText } from "./chunker";
import { queueOriginalUpload, reportOriginalTooBig } from "./originalSync";
import { saveOriginal, type SaveOriginalResult } from "./originalStore";
import { embedBatch, EMBED_DIM, EMBED_MODEL } from "@/lib/embedding/embedder";
import { upsertDocument, type DocItem, type DocSource } from "@/lib/documentStore";

export interface IngestInput {
  /** Stable document id. Manual: createDocumentId(); connector: derived from source.ref. */
  id: string;
  file: File;
  /** Display name (manual: file.name; connector: note title). */
  filename: string;
  mime: string;
  projectId?: string;
  /** Provenance; absent for manual uploads. */
  source?: DocSource;
  /** Preserve the original createdAt on re-ingest (so updates don't reset it). */
  createdAt?: number;
  /** Skip extraction and index THIS text instead — the photo-OCR flow passes
   *  the user-reviewed transcript here (extract.ts can't read images; the
   *  file is still kept as the encrypted original for the viewer). */
  textOverride?: string;
  /** Force keeping the original bytes even when `source` is set. Connector
   *  imports normally skip this (the connector is the source of truth), but a
   *  generated artifact IS the source — its HTML "Original" layout view needs
   *  the bytes. */
  keepOriginal?: boolean;
  onProgress?: (done: number, total: number) => void;
}

/** Run a file through the pipeline and return the resulting DocItem. Never throws:
 *  on failure it upserts (and returns) a `failed` DocItem with the error, matching
 *  the existing upload behaviour. */
export async function ingestDocument(input: IngestInput): Promise<DocItem> {
  const { id, file, filename, mime, projectId, source, onProgress } = input;
  const createdAt = input.createdAt ?? Date.now();
  const base = { id, filename, mime, projectId, source, createdAt } as const;

  upsertDocument({ ...base, status: "processing", chunks: [], updatedAt: Date.now() });
  // Keep the original bytes for the viewer's layout mode — sealed local
  // IndexedDB, strictly best-effort: kept off the ingest critical path so a
  // storage failure can never slow down or fail indexing. Connector imports skip
  // this — their source of truth is the connector and re-import is cheap.
  // On memory-constrained devices (deviceClass.ts) the bytes are cached only
  // AFTER extraction — reading the file a second time while pdf.js still holds
  // its own copy is how a large PDF came to sit in memory three times over.
  const wantOriginal = !(source && !input.keepOriginal);
  const sequential = currentPolicy().sequentialIngest;
  let savedOriginal: Promise<SaveOriginalResult> =
    wantOriginal && !sequential ? saveOriginal(id, file) : Promise.resolve("skipped");
  try {
    let text: string;
    if (input.textOverride !== undefined) {
      text = input.textOverride;
      if (!text.trim()) throw new Error("No extractable text in this file");
    } else {
      const { extractText, noTextReason } = await import("./extract");
      const res = await extractText(file);
      text = res.text;
      // Distinguish the scanned-PDF case so a device repro reveals the real cause
      // (engine couldn't start vs. ran-but-empty) instead of a generic message.
      if (!text.trim()) throw new Error(noTextReason(res));
    }
    if (wantOriginal && sequential) savedOriginal = saveOriginal(id, file);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error("Document produced no chunks");
    const embeddings = await embedBatch(
      chunks.map((c) => c.text),
      onProgress,
    );
    const ready: DocItem = {
      ...base,
      status: "ready",
      chunks: chunks.map((c, i) => ({ index: c.index, text: c.text, embedding: embeddings[i] })),
      fullText: text,
      dim: EMBED_DIM,
      embModel: EMBED_MODEL,
      updatedAt: Date.now(),
    };
    upsertDocument(ready);
    // Cross-device originals: once indexing succeeded AND the bytes were cached,
    // upload them (encrypted, chunked) in the background — fire-and-forget, so
    // sync problems (offline, quota) never affect the ingest result. Over-cap
    // files are flagged honestly (the original will only ever exist here).
    void savedOriginal.then((result) => {
      if (result === "stored") queueOriginalUpload(id);
      else if (result === "toobig") reportOriginalTooBig(id);
    });
    return ready;
  } catch (err) {
    const failed: DocItem = {
      ...base,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      chunks: [],
      updatedAt: Date.now(),
    };
    upsertDocument(failed);
    return failed;
  }
}
