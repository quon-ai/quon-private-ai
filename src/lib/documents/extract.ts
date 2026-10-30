/**
 * In-browser document text extraction (zero-knowledge: bytes never leave the
 * device). Mirrors the formats of the backend `DefaultExtractor`:
 *   - PDF  → pdf.js (`pdfjs-dist`)
 *   - DOCX → mammoth
 *   - txt / md / csv / json / log → decoded natively (JSON pretty-printed)
 *   - html / xml → tags stripped via DOMParser
 *
 * This whole module is heavy (pdf.js + mammoth); the UI imports it lazily
 * (`await import(...)`) only when the user actually uploads a file.
 */

import mammoth from "mammoth";

// Polyfilled + worker-wired pdf.js — the shared setup also used by the viewer.
import { pdfjs } from "./pdfjs";
import { pageNeedsOcr } from "./pageText";

export interface ExtractResult {
  text: string;
  pageCount?: number;
  /** Pages whose text came from the on-device OCR (scanned-PDF fallback). */
  ocrPages?: number;
  /** Pages detected as scans (empty/near-empty text layer) that OCR was asked to
   *  read — diagnostic for the "scanned PDF won't import" case. */
  scannedPages?: number;
  /** Set when the on-device OCR engine could not start (model/WASM download
   *  blocked, e.g. on a flaky mobile connection) — the reason string. When set on
   *  a text-less PDF, the ingest surfaces it instead of a generic error, so a
   *  device repro reveals WHY the scan didn't read. */
  ocrError?: string;
}

const TEXT_EXT = /\.(txt|text|md|markdown|rst|csv|tsv|json|jsonl|log|ya?ml|ini|cfg|toml)$/i;

/** PURE: the user-facing reason a document produced no text, distinguishing a
 *  scanned PDF whose on-device OCR couldn't START (engine/model download blocked)
 *  from one where OCR RAN but read nothing (low-quality scan) from a plain
 *  no-text file. Lets a device repro reveal the real cause. */
export function noTextReason(
  r: Pick<ExtractResult, "scannedPages" | "ocrPages" | "ocrError">,
): string {
  const scanned = r.scannedPages ?? 0;
  if (scanned > 0 && r.ocrError) {
    return `Scanned PDF — on-device text recognition couldn't start on this device (${r.ocrError}). It may not have loaded on a slow/blocked connection.`;
  }
  if (scanned > 0 && (r.ocrPages ?? 0) === 0) {
    return "Scanned PDF — on-device text recognition found no readable text (low-quality scan?).";
  }
  return "No extractable text in this file";
}
const HTML_EXT = /\.(html?|xhtml|xml)$/i;

export async function extractText(file: File): Promise<ExtractResult> {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();

  if (name.endsWith(".pdf") || type.includes("pdf")) {
    return extractPdf(file);
  }
  if (name.endsWith(".docx") || type.includes("wordprocessingml")) {
    return extractDocx(file);
  }
  if (HTML_EXT.test(name) || type.includes("html") || type.includes("xml")) {
    return { text: stripHtml(await file.text()) };
  }
  if (TEXT_EXT.test(name) || type.startsWith("text/") || type.includes("json")) {
    let raw = await file.text();
    if (/\.(json|jsonl)$/i.test(name) || type.includes("json")) {
      try {
        raw = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        /* not valid JSON — index as-is */
      }
    }
    return { text: raw };
  }

  // Unknown extension: attempt a tolerant text decode, else fail closed.
  const raw = await file.text();
  if (raw && isMostlyPrintable(raw)) {
    return { text: raw };
  }
  throw new Error(
    `Unsupported file type "${file.name}". Supported: txt, md, csv, json, html, pdf, docx.`,
  );
}

// The scan predicate lives in ./pageText so the document VIEWER can import it
// without dragging pdf.js + mammoth into the main bundle. Both must agree; see
// that module's header for what went wrong when they didn't.
export { pageNeedsOcr } from "./pageText";

/** Scanned pages are OCRed up to this cap — beyond it we keep whatever the
 *  text layer gave (a 300-page scan would otherwise stall the tab). */
export const MAX_OCR_PAGES = 40;

/** Longest canvas edge for a page render sent to OCR (matches the cloud-OCR
 *  re-encode cap; PP-OCR gains nothing above this). */
const OCR_RENDER_MAX_PX = 2000;

/** Resolves once the tab is visible (immediately when it already is). */
function waitForVisible(): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.visibilityState !== "hidden") {
        document.removeEventListener("visibilitychange", onChange);
        resolve();
      }
    };
    document.addEventListener("visibilitychange", onChange);
  });
}

async function extractPdf(file: File): Promise<ExtractResult> {
  const data = new Uint8Array(await file.arrayBuffer());
  // Keep the loading task so we can dispose it correctly (pdf.js v6 dropped
  // `destroy()` from the document proxy — cleanup lives on the loading task).
  const loadingTask = pdfjs.getDocument({ data });
  try {
    const doc = await loadingTask.promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      parts.push(pageText);
    }

    // Scanned-PDF fallback (the Paperless-class case): pages with no usable
    // text layer are rendered and read by the on-device OCR engine — same
    // ZK story as the photo scan, nothing leaves the device. OCR failures
    // (engine unavailable / blank page) degrade to the text-layer behavior,
    // never fail the whole extraction.
    const scanned = parts
      .map((t, idx) => ({ t, idx }))
      .filter(({ t }) => pageNeedsOcr(t))
      .slice(0, MAX_OCR_PAGES);
    let ocrPages = 0;
    let ocrError: string | undefined;
    if (scanned.length > 0 && typeof document !== "undefined") {
      try {
        const { ocrCanvas } = await import("./ocr");
        for (const { idx } of scanned) {
          // Chromium stalls image decodes inside pdf.js renders while the tab
          // is HIDDEN (same class as the img.decode() hang the photo path
          // works around) — if the user switched tabs mid-processing, wait for
          // visibility instead of wedging the document in "processing".
          await waitForVisible();
          const page = await doc.getPage(idx + 1);
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(3, OCR_RENDER_MAX_PX / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          // Belt-and-braces: a page render must never hang the whole ingest —
          // on timeout this page keeps its (empty) text layer and we move on.
          const rendered = await Promise.race([
            page
              .render({ canvas, viewport })
              .promise.then(() => true)
              .catch(() => false),
            new Promise<boolean>((res) => setTimeout(() => res(false), 30_000)),
          ]);
          if (!rendered) continue;
          const res = await ocrCanvas(canvas);
          if (res.text.trim()) {
            parts[idx] = res.text;
            ocrPages++;
          }
        }
      } catch (e) {
        // Engine download blocked / WASM unavailable — keep the text layer, but
        // REMEMBER why so a text-less scan reports the real cause (not a generic
        // "no text"). Common on flaky mobile connections (model tar from CDN).
        ocrError = e instanceof Error ? e.message : String(e);
      }
    }

    return {
      text: parts.join("\n\n"),
      pageCount: doc.numPages,
      ocrPages,
      scannedPages: scanned.length,
      ocrError,
    };
  } catch (err) {
    // Surface a friendly message instead of a cryptic pdf.js/runtime error.
    const detail = err instanceof Error ? err.message : "extraction failed";
    throw new Error(`Couldn't read this PDF on this device (${detail}). Try a smaller PDF.`);
  } finally {
    try {
      await loadingTask.destroy();
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function extractDocx(file: File): Promise<ExtractResult> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return { text: result.value };
}

function stripHtml(html: string): string {
  if (typeof DOMParser === "undefined") {
    return html.replace(/<[^>]+>/g, " ");
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style").forEach((el) => el.remove());
  return (doc.body?.textContent ?? "").replace(/\s+\n/g, "\n").trim();
}

function isMostlyPrintable(s: string): boolean {
  const sample = s.slice(0, 1000);
  if (!sample) return false;
  let printable = 0;
  for (const ch of sample) {
    if (ch === "\n" || ch === "\t" || ch === "\r" || ch >= " ") printable++;
  }
  return printable / sample.length > 0.85;
}
