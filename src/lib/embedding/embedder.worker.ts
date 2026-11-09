/**
 * Web Worker that runs the Transformers.js embedding model off the main thread.
 *
 * ONNX/WASM inference is synchronous and blocks whatever thread it runs on; doing
 * it on the UI thread freezes the tab ("page not responding") while a large
 * document indexes. Running it here keeps the main thread free to render. The
 * main-thread proxy with the public API lives in `embedder.ts`.
 *
 * Protocol (main -> worker): { type: "warm" } | { type: "embed", id, texts }
 *           (worker -> main): { type: "status", loading, ready }
 *                          | { type: "result", id, vectors }
 *                          | { type: "error", id?, message }
 */
import { pipeline, env } from "@huggingface/transformers";

import { EMBED_MODEL } from "./model";

// The dedicated worker's own global. Typed as Worker for postMessage/onmessage
// without pulling in the "webworker" lib (which would clash with the DOM lib).
const ctx = self as unknown as Worker;

interface FeatureExtractor {
  (
    input: string | string[],
    opts: { pooling: "mean"; normalize: boolean },
  ): Promise<{ tolist: () => number[][] }>;
}

let pipePromise: Promise<FeatureExtractor> | null = null;

function getPipe(): Promise<FeatureExtractor> {
  if (!pipePromise) {
    ctx.postMessage({ type: "status", loading: true, ready: false });
    // Fetch the model from the hub and cache it in the browser; no local files.
    env.allowLocalModels = false;
    // E2E harness only (dev builds + explicit flag - structurally unreachable
    // in production): pull the model + ORT wasm from the local mirror served
    // by the vite middleware instead of huggingface.co/jsdelivr. Fresh test
    // contexts have no cache, so without this every document-heavy spec
    // re-downloads ~100MB - that is their runtime.
    if (import.meta.env.DEV && import.meta.env.VITE_QUON_TEST_LOCAL_MODELS === "1") {
      env.remoteHost = `${self.location.origin}/e2e-models/`;
      if (env.backends.onnx.wasm)
        env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/e2e-models/twdist/`;
    }
    pipePromise = (pipeline("feature-extraction", EMBED_MODEL) as Promise<unknown>)
      .then((p) => {
        ctx.postMessage({ type: "status", loading: false, ready: true });
        return p as FeatureExtractor;
      })
      .catch((err) => {
        pipePromise = null; // allow a retry on the next request
        ctx.postMessage({ type: "status", loading: false, ready: false });
        throw err;
      });
  }
  return pipePromise;
}

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: string; id?: number; texts?: string[] };
  if (msg.type === "warm") {
    getPipe().catch(() => {
      /* surfaced to callers on the next embed request */
    });
    return;
  }
  if (msg.type === "embed" && msg.texts) {
    try {
      const pipe = await getPipe();
      const out = await pipe(msg.texts, { pooling: "mean", normalize: true });
      ctx.postMessage({ type: "result", id: msg.id, vectors: out.tolist() });
    } catch (err) {
      ctx.postMessage({
        type: "error",
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
