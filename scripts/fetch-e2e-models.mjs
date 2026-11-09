/**
 * Pre-fetch the in-browser EMBEDDING model for the e2e harness.
 *
 * Why: every Playwright test gets a fresh, cache-less browser context, so the
 * document-heavy specs each re-download the ~100MB embedding model
 * (Xenova/paraphrase-multilingual-MiniLM-L12-v2) from huggingface.co - that is
 * their ~70s runtime. This script mirrors the model files once into the
 * git-ignored tests/e2e/.models/ tree (exact HF path layout); the vite dev
 * middleware (vite.config.ts, QUON_E2E_LOCAL_MODELS=1) then serves them from
 * localhost and the "download" becomes a local file read. Production is
 * untouched - real browsers keep loading from HF and caching normally.
 *
 * Idempotent: existing files are skipped. Misses at runtime fall back to a
 * redirect to huggingface.co (see the middleware), so a stale mirror degrades
 * to the old slow behavior, never to a broken suite.
 */
import { createWriteStream, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const ROOT = "tests/e2e/.models";
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];

async function fetchOne(rel) {
  const dest = join(ROOT, MODEL, "resolve", "main", rel);
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`  ✓ cached  ${rel}`);
    return;
  }
  const url = `https://huggingface.co/${MODEL}/resolve/main/${rel}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  console.log(`  ↓ fetched ${rel} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
}

// The ORT jsep wasm pair transformers.js loads at runtime (jsdelivr in prod) -
// copied from the package's own pinned onnxruntime-web so versions match.
function copyOrt() {
  const src = "node_modules/@huggingface/transformers/node_modules/onnxruntime-web/dist";
  const destDir = join(ROOT, "twdist");
  mkdirSync(destDir, { recursive: true });
  for (const f of [
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.wasm",
    "ort-wasm-simd-threaded.asyncify.mjs",
    "ort-wasm-simd-threaded.asyncify.wasm",
  ]) {
    const dest = join(destDir, f);
    if (!existsSync(dest)) {
      copyFileSync(join(src, f), dest);
      console.log(`  ✓ ort     ${f}`);
    }
  }
}

try {
  console.log("e2e model mirror:");
  for (const f of FILES) await fetchOne(f);
  copyOrt();
} catch (err) {
  // Never fail the suite over the mirror - the middleware redirects misses to
  // HF, so the run just stays slow.
  console.warn(`fetch-e2e-models: ${err.message} — suite will fall back to HF downloads`);
}
