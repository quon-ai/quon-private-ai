/**
 * Local cache of ORIGINAL uploaded file bytes, behind the document viewer's
 * "real layout" mode (render the actual PDF pages / DOCX formatting instead of
 * the extracted plain text).
 *
 * Device-local and best-effort — the bytes live in their own IndexedDB object
 * store ("originals", keyed by document id), sealed at rest under the local
 * cache key (idbPutBytes / localVault), and are NEVER part of the DocItem blob
 * that syncs to the server: item blobs stay small. Cross-device availability
 * comes from documents/originalSync.ts instead, which uploads the bytes as
 * separately-encrypted chunks (collection `originals`) and lazily re-fills this
 * cache on other devices when the viewer asks. Losing this cache loses nothing:
 * the text view still works, and a synced original is re-fetched on demand.
 */

import { idbClear, idbDelete, idbGetBytes, idbPutBytes } from "@/lib/idbStore";

const IDB = "originals" as const;

/** Per-file cap. Originals beyond this are neither cached nor synced (the text
 *  view still works) — it bounds the single-allocation encrypt/decrypt passes
 *  (whole-file secretbox) and keeps one huge scan from eating the 200 MB
 *  per-user server quota or the origin's IndexedDB quota. Ingest surfaces
 *  over-cap files honestly instead of silently skipping them. */
export const MAX_ORIGINAL_BYTES = 50 * 1024 * 1024;

export type OriginalKind = "pdf" | "docx" | "html" | "md" | "image";

/** Which "Original" renderer the viewer has for a file, mirroring extract.ts's
 *  type detection. pdf/docx render from the original bytes; html renders the
 *  original bytes through the allowlist sanitizer (extracted text won't do —
 *  its tags are already stripped); md renders straight from the extracted text
 *  (the text IS the source, so no bytes are ever needed); image is a scanned
 *  photo (OCR) rendered as-is — for photos the ORIGINAL is the source of
 *  truth and the text is derived, so keeping the bytes matters most here.
 *  Null = no layout view exists (plain txt/csv/json/xml/etc.). */
export function originalKind(mime: string, filename: string): OriginalKind | null {
  const name = filename.toLowerCase();
  const type = mime.toLowerCase();
  if (name.endsWith(".pdf") || type.includes("pdf")) return "pdf";
  if (name.endsWith(".docx") || type.includes("wordprocessingml")) return "docx";
  if (/\.(html?|xhtml)$/.test(name) || type.includes("html")) return "html";
  if (/\.(md|markdown)$/.test(name) || type.includes("markdown")) return "md";
  if (/\.(jpe?g|png|webp|gif|heic|heif|bmp)$/.test(name) || type.startsWith("image/"))
    return "image";
  return null;
}

/** True when a file's bytes are worth caching: a renderer that actually needs
 *  them (md renders from the extracted text alone), non-empty, under the cap. */
export function shouldStoreOriginal(mime: string, filename: string, size: number): boolean {
  const kind = originalKind(mime, filename);
  return kind !== null && kind !== "md" && size > 0 && size <= MAX_ORIGINAL_BYTES;
}

/** Outcome of caching a just-uploaded file's bytes. "toobig" is surfaced to the
 *  user (the original will never be viewable on other devices); the other
 *  non-stored cases are silent (no layout renderer / storage hiccup). */
export type SaveOriginalResult = "stored" | "toobig" | "skipped";

/** Cache a just-uploaded file's bytes. Best-effort: never throws, and callers
 *  must not await it on the ingest critical path — a failure (locked vault,
 *  quota, private mode) only costs the layout view. */
export async function saveOriginal(id: string, file: File): Promise<SaveOriginalResult> {
  try {
    const kind = originalKind(file.type || "", file.name);
    if (kind === null || kind === "md" || file.size === 0) return "skipped";
    if (file.size > MAX_ORIGINAL_BYTES) return "toobig";
    const bytes = new Uint8Array(await file.arrayBuffer());
    return (await idbPutBytes(IDB, id, bytes)) ? "stored" : "skipped";
  } catch {
    return "skipped";
  }
}

/** Cache original bytes fetched from the sync relay (already type-gated at
 *  upload time on the source device — only the size cap is re-checked). */
export async function saveOriginalBytes(id: string, bytes: Uint8Array): Promise<boolean> {
  try {
    if (bytes.length === 0 || bytes.length > MAX_ORIGINAL_BYTES) return false;
    return await idbPutBytes(IDB, id, bytes);
  } catch {
    return false;
  }
}

/** The original bytes for a document, or null when none were kept on this device. */
export async function loadOriginal(id: string): Promise<Uint8Array | null> {
  return idbGetBytes(IDB, id);
}

/** Drop a document's cached original (document deleted locally or remotely). */
export async function deleteOriginal(id: string): Promise<void> {
  return idbDelete(IDB, id);
}

/** Drop every cached original (logout / account switch, with resetDocuments). */
export async function clearOriginals(): Promise<void> {
  return idbClear(IDB);
}
