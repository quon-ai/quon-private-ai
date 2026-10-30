/**
 * What a document turns into when it LEAVES QUON — as a download, or as an
 * upload to Dropbox/Paperless.
 *
 * One rule, one place: the Download button and every export target must agree
 * on the filename and bytes, or the same document arrives differently
 * depending on which button was pressed. The rule itself is the one the
 * viewer's download has always used:
 *
 *   - original bytes present (PDF/DOCX/image) → send those, under their own
 *     name. The original is the truth; the extracted text is our derivative.
 *   - otherwise → send the extracted text, honestly renamed `.txt`, because
 *     that IS what is being sent. A Markdown document keeps its name: there
 *     the text is the source, not an extraction.
 *
 * Pure — no store, no network — so it is unit-testable and callable from both
 * the UI and the chat tool.
 */

export interface ExportPayload {
  filename: string;
  mime: string;
  blob: Blob;
  /** True when the recipient gets our extracted text rather than the original
   *  file. The UI says so: a scanned PDF's text export is a lossy thing to
   *  hand to a document archive, and the user should know before it lands. */
  isTextFallback: boolean;
}

export function buildExportPayload(args: {
  filename: string;
  mime: string;
  /** Original bytes when this device has them (or fetched them). */
  bytes?: Uint8Array | null;
  /** On-device extracted text — the fallback. */
  text: string;
  /** Viewer's originalKind ("md" means the text is the source). */
  kind?: string;
}): ExportPayload {
  const { filename, mime, bytes, text, kind } = args;
  if (bytes && bytes.length) {
    return {
      filename,
      mime: mime || "application/octet-stream",
      // slice() so the Blob owns its buffer — the caller may reuse/clear theirs.
      blob: new Blob([bytes.slice()], { type: mime || "application/octet-stream" }),
      isTextFallback: false,
    };
  }
  const base = filename.replace(/\.[^.]+$/, "");
  const isMd = kind === "md" || /\.mdx?$/i.test(filename);
  const name = isMd ? filename : `${base}.txt`;
  const type = isMd ? "text/markdown" : "text/plain";
  return {
    filename: name,
    mime: type,
    blob: new Blob([text], { type: `${type};charset=utf-8` }),
    // Markdown is not a fallback — the text is the document.
    isTextFallback: !isMd,
  };
}
