/**
 * Trigger a browser "save file" for in-memory data. Everything QUON exports is
 * built on-device from already-decrypted content - nothing leaves the browser,
 * this just hands bytes to the OS download flow.
 */

/** Save arbitrary bytes/blob under `filename`. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick - some browsers need the URL alive through the click.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Save `bytes` (a document's original bytes) as `filename`. */
export function downloadBytes(filename: string, bytes: Uint8Array, mime: string): void {
  downloadBlob(filename, new Blob([bytes.slice()], { type: mime || "application/octet-stream" }));
}

/** Save a text string (markdown/txt export). */
export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}
