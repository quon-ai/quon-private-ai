/**
 * The single, correctly-configured pdf.js instance — shared by text extraction
 * (extract.ts) and the layout viewer (DocumentViewer). Import `pdfjs` from here
 * instead of "pdfjs-dist" directly, so the iOS polyfill + worker wiring exist
 * exactly once. Heavy: only ever `await import(...)` this module.
 */

// MUST come before the pdfjs import: pdfjs v6 calls Promise.withResolvers() at
// runtime, which iOS Safari < 17.4 lacks. The polyfill defines it first.
import "@/lib/polyfills";

import * as pdfjs from "pdfjs-dist";
// Use our wrapper worker (./pdfWorker) instead of pdf.js's raw worker bundle: it
// installs the Promise.withResolvers polyfill inside the worker scope (which the
// main-thread polyfill can't reach) before pdf.js's worker code runs — required
// for PDF upload on iOS Safari < 17.4. Vite bundles it and returns its URL.
import pdfWorkerUrl from "./pdfWorker?worker&url";

// pdf.js needs a worker; point it at our polyfilled worker bundle.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export { pdfjs };
