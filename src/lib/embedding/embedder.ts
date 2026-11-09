/**
 * In-browser text embeddings - main-thread proxy to `embedder.worker.ts`.
 *
 * Embeddings are computed **on-device** so Memory/Document text never leaves the
 * browser (the cornerstone of QUON's zero-knowledge model). The actual ONNX/WASM
 * inference runs in a **Web Worker** so a large document can index without
 * freezing the tab - this module just forwards requests and tracks readiness,
 * keeping the same async API the rest of the app already uses.
 *
 * The model id/dim live in `./model` (shared with the worker). Changing the model
 * invalidates existing vectors; `src/lib/reembed.ts` re-embeds lazily.
 */

import { embed as embedCap } from "@/lib/platform";
import { currentPolicy } from "@/lib/deviceClass";
import { diagAppend } from "@/lib/diagLog";

export { EMBED_MODEL, EMBED_DIM } from "./model";

/**
 * Native embedding path (desktop app): the Rust host runs the same quantized
 * MiniLM (src-tauri/src/embed.rs), so the webview never loads the ~20MB
 * ONNX/WASM runtime whose compilation gets the WebContent process CPU-killed.
 * Retrieval-equivalent to the browser vectors (embed_parity.rs), so no
 * re-embedding and one embModel id across shells. Falls through to the worker
 * on the web, where embedCap() is null.
 */
function nativeEmbed() {
  return embedCap();
}

let worker: Worker | null = null;
let loading = false;
let ready = false;
let nextId = 1;
// Idle release (constrained devices): the worker holds a ~113 MB model, a
// 16 MB tokenizer tree and a compiled ~23 MB WASM runtime - on an iPhone that
// footprint sitting idle is what gets the page killed. After the policy's
// idle time with nothing in flight, terminate it; the next request loads it
// again from the browser cache (seconds, not a download).
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let announcedLoad = false;

function armIdleRelease(): void {
  const ms = currentPolicy().releaseEmbedderIdleMs;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (!ms || !worker) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (!worker || pending.size > 0) return;
    worker.terminate();
    worker = null;
    loading = false;
    ready = false;
    announcedLoad = false;
    emitReady();
    diagAppend(`embedder: released after ${Math.round(ms / 1000)}s idle`);
  }, ms);
}
const pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();
const readyListeners = new Set<(ready: boolean) => void>();

function emitReady(): void {
  for (const l of readyListeners) l(ready);
}

type WorkerMessage =
  | { type: "status"; loading: boolean; ready: boolean }
  | { type: "result"; id: number; vectors: number[][] }
  | { type: "error"; id?: number; message: string };

function getWorker(): Worker {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("embeddings are browser-only");
  }
  if (!worker) {
    // Loading is itself completely ordinary on a normal device - every screen
    // that opens Documents/Memory does this. Logging it unconditionally would
    // make the diag buffer non-empty for every healthy user and break the
    // feedback dialog's "nothing to report" reading of an empty log (same
    // contract as bootSummary.ts). Worth a line only where it is NEWS: a
    // constrained device or safe mode loading anyway despite the skip policy.
    if (!announcedLoad && currentPolicy().reason !== "normal") {
      announcedLoad = true;
      diagAppend(`embedder: loading (policy=${currentPolicy().reason})`);
    }
    worker = new Worker(new URL("./embedder.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "status") {
        loading = msg.loading;
        ready = msg.ready;
        emitReady();
      } else if (msg.type === "result") {
        pending.get(msg.id)?.resolve(msg.vectors);
        pending.delete(msg.id);
        if (pending.size === 0) armIdleRelease();
      } else if (msg.type === "error" && msg.id != null) {
        pending.get(msg.id)?.reject(new Error(msg.message));
        pending.delete(msg.id);
        if (pending.size === 0) armIdleRelease();
      }
    };
    worker.onerror = () => {
      // Fatal worker error: fail every in-flight request and reset so the next
      // call spins up a fresh worker.
      const err = new Error("embedding worker crashed");
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
      loading = false;
      ready = false;
      emitReady();
    };
  }
  return worker;
}

function runEmbed(texts: string[]): Promise<number[][]> {
  const native = nativeEmbed();
  if (native) return native.embed(texts);
  const w = getWorker();
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const id = nextId++;
  return new Promise<number[][]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ type: "embed", id, texts });
  });
}

/** True once the model is loaded in the worker and ready to embed. */
export function isEmbedderReady(): boolean {
  return ready;
}

/** True while the model is downloading/initialising. */
export function isEmbedderLoading(): boolean {
  return loading;
}

/** Subscribe to embedder readiness changes (drives the "preparing..." UI state). */
export function onEmbedderReady(cb: (ready: boolean) => void): () => void {
  readyListeners.add(cb);
  return () => readyListeners.delete(cb);
}

let announcedSkip = false;

/** Kick off model loading in the worker (call when the user opens Memory/Documents).
 *  A no-op where the policy says so: on a constrained device or in safe mode
 *  the model loads only when something the user did needs it (deviceClass.ts). */
export function warmEmbedder(): void {
  const native = nativeEmbed();
  if (!native && !currentPolicy().prewarmEmbedder) {
    if (!announcedSkip) {
      announcedSkip = true;
      diagAppend(`embedder: prewarm skipped (policy=${currentPolicy().reason})`);
    }
    return;
  }
  if (native) {
    if (ready) return;
    loading = true;
    emitReady();
    void native
      .warm()
      .then(() => {
        loading = false;
        ready = true;
        emitReady();
      })
      .catch(() => {
        loading = false;
        ready = false;
        emitReady();
      });
    return;
  }
  if (typeof window === "undefined" || typeof Worker === "undefined") return;
  try {
    getWorker().postMessage({ type: "warm" });
  } catch {
    /* surfaced via onEmbedderReady / thrown again on embed */
  }
}

/** Embed a single string -> a 384-dim L2-normalized vector. */
export async function embedText(text: string): Promise<number[]> {
  const out = await runEmbed([text]);
  return out[0];
}

/**
 * Max inputs per worker inference call. The batch is padded to the longest
 * sequence and run as one tensor, so an unbounded batch (a large document) would
 * exhaust the worker's WASM heap (`std::bad_alloc`). Embedding in fixed
 * sub-batches keeps peak memory flat and lets us report progress.
 */
const EMBED_BATCH_SIZE = 16;

/** The batch for this device: the policy shrinks it where the worker's WASM
 *  heap is the thing that gets the page killed. */
function embedBatchSize(): number {
  return Math.max(1, Math.min(EMBED_BATCH_SIZE, currentPolicy().embedBatchSize));
}

/**
 * Embed many strings -> one vector per input, in bounded sub-batches handed to
 * the worker. `onProgress(done, total)` fires after each sub-batch.
 */
export async function embedBatch(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const vectors: number[][] = [];
  const batch = embedBatchSize();
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch);
    const out = await runEmbed(slice);
    for (const vec of out) vectors.push(vec);
    onProgress?.(vectors.length, texts.length);
  }
  return vectors;
}
