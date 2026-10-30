// Self-host the pinned ONNX Runtime WASM runtime used by the on-device photo-OCR
// engine (src/lib/documents/ocr.ts). The enforcing CSP (src/server.ts) allows
// scripts only from 'self', so ORT's dynamically-imported glue module MUST be
// same-origin — putting a CDN in script-src would mean executing third-party JS
// with full page access (a bigger trust grant than fetching sandboxed WASM
// bytes). Self-hosting also drops the runtime jsdelivr dependency for OCR.
//
// Copies the exact NON-JSEP artifacts from onnxruntime-web@<pinned> into
// public/ort/ (git-ignored) so `vite dev` and `vite build` serve them at /ort/.
// WebKit needs the non-JSEP build specifically — see ocr.ts. Wired as
// predev/prebuild so it runs locally AND on the mini-PC build (node_modules is
// installed there); the .mjs resolves its sibling .wasm via import.meta.url, so
// both files must sit together.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(root, "node_modules/onnxruntime-web/dist");
const dstDir = resolve(root, "public/ort");
const FILES = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

mkdirSync(dstDir, { recursive: true });
for (const f of FILES) {
  copyFileSync(resolve(srcDir, f), resolve(dstDir, f));
}
console.log(`[copy-ort] self-hosted ${FILES.length} ORT runtime files → public/ort/`);
