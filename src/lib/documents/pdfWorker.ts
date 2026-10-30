/**
 * Custom pdf.js worker entry.
 *
 * pdf.js v6's worker bundle (`pdf.worker.min.mjs`) calls `Promise.withResolvers()`,
 * which iOS Safari < 17.4 lacks. A Web Worker runs in its OWN global scope, so the
 * main-thread polyfill (`src/lib/polyfills`, loaded by `extract.ts`) never reaches
 * it — the worker still crashed on older iPhones with "undefined is not a function".
 *
 * This module is bundled as the worker (`./pdfWorker?worker&url` → workerSrc) so the
 * polyfill is installed in the worker's scope FIRST, before pdf.js's worker code runs.
 */
import "@/lib/polyfills";
import "pdfjs-dist/build/pdf.worker.min.mjs";
