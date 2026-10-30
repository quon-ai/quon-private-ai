/**
 * The "is this page really a scan?" predicate — and nothing else.
 *
 * It lives in its own module on purpose. `extract.ts` owns it logically, but that
 * module pulls in pdf.js AND mammoth and is only ever `await import()`ed for that
 * reason. Two callers need this one-line rule *without* the megabytes:
 *
 *  - extraction, to decide whether a page must go through OCR, and
 *  - the document viewer, to decide whether it can place detection marks on a
 *    rendered page at all.
 *
 * Those two answers must agree. When they didn't, a scanned page carrying a
 * header stamp or a page number cleared the viewer's naive "has any text?" check,
 * so the viewer believed it could mark the page while the body text had actually
 * come from OCR — and the page rendered clean, which reads as "nothing found
 * here". One predicate, one threshold, imported by both.
 */

/** A page whose extractable text layer is this small is treated as a SCAN
 *  (image-only page). 30 non-whitespace chars keeps stamps/page numbers from
 *  masking a scanned page, while a real text page (even a terse one) comfortably
 *  clears it. */
export function pageNeedsOcr(pageText: string): boolean {
  return pageText.replace(/\s+/g, "").length < 30;
}

/** Join pdf.js text items into page text the SAME way extraction does, so the
 *  predicate above sees the same string in both places. */
export function joinPdfItems(items: Array<{ str?: unknown }>): string {
  return items.map((it) => (typeof it.str === "string" ? it.str : "")).join(" ");
}
