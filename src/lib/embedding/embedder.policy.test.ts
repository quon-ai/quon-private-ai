import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HeavyWorkPolicy } from "@/lib/deviceClass";

/**
 * The embedder under the device policy (deviceClass.ts): a constrained device
 * must never load the worker ahead of need, must embed in small batches, and
 * must let the worker go once idle — the footprint that got iPhone pages
 * killed at boot (#68, #76). The worker itself is faked: what matters here is
 * WHEN it is created, how many inputs each message carries, and that it is
 * terminated after the idle time.
 */

let policy: HeavyWorkPolicy;
const appended: string[] = [];
vi.mock("@/lib/deviceClass", () => ({ currentPolicy: () => policy }));
vi.mock("@/lib/diagLog", () => ({ diagAppend: (m: string) => appended.push(m) }));
vi.mock("@/lib/platform", () => ({ embed: () => null }));

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(msg: { type: string; id?: number; texts?: string[] }) {
    this.posted.push(msg);
    if (msg.type === "embed" && msg.id != null) {
      const vectors = (msg.texts ?? []).map(() => [0.1, 0.2]);
      queueMicrotask(() => this.onmessage?.({ data: { type: "result", id: msg.id, vectors } }));
    }
  }
  terminate() {
    this.terminated = true;
  }
}

const NORMAL: HeavyWorkPolicy = {
  prewarmEmbedder: true,
  backgroundReembed: true,
  backgroundOriginalsUpload: true,
  maxAutoUploadBytes: Infinity,
  embedBatchSize: 16,
  releaseEmbedderIdleMs: 0,
  sequentialIngest: false,
  reason: "normal",
};
const CONSTRAINED: HeavyWorkPolicy = {
  ...NORMAL,
  prewarmEmbedder: false,
  backgroundReembed: false,
  maxAutoUploadBytes: 8 * 1024 * 1024,
  embedBatchSize: 4,
  releaseEmbedderIdleMs: 60_000,
  sequentialIngest: true,
  reason: "constrained",
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWorker.instances = [];
  appended.length = 0;
  vi.stubGlobal("Worker", FakeWorker);
  vi.stubGlobal("window", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

async function fresh() {
  vi.resetModules();
  return import("./embedder");
}

describe("embedder under the device policy", () => {
  it("normal device: warmEmbedder starts the worker at once, and logs NOTHING — loading is ordinary here", async () => {
    policy = NORMAL;
    const m = await fresh();
    m.warmEmbedder();
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted).toEqual([{ type: "warm" }]);
    // Regression lock: an unconditional "embedder: loading" line here made the
    // diag buffer non-empty for every healthy desktop/Android user and broke
    // the feedback dialog's "nothing to report" reading of an empty log.
    expect(appended).toEqual([]);
  });

  it("a constrained device that loads anyway (something needed it) logs why", async () => {
    policy = CONSTRAINED;
    const m = await fresh();
    await m.embedText("a");
    expect(appended.some((l) => l.includes("embedder: loading (policy=constrained)"))).toBe(true);
  });

  it("constrained device: warmEmbedder is a no-op — no worker until something needs it", async () => {
    policy = CONSTRAINED;
    const m = await fresh();
    m.warmEmbedder();
    m.warmEmbedder();
    expect(FakeWorker.instances).toHaveLength(0);
    // …and a real request still works, loading on demand.
    const vec = await m.embedText("hallo");
    expect(vec).toEqual([0.1, 0.2]);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("constrained device: a batch is split into the policy's small sub-batches", async () => {
    policy = CONSTRAINED;
    const m = await fresh();
    const out = await m.embedBatch(Array.from({ length: 10 }, (_, i) => `t${i}`));
    expect(out).toHaveLength(10);
    const sizes = FakeWorker.instances[0].posted
      .filter((p) => (p as { type: string }).type === "embed")
      .map((p) => (p as { texts: string[] }).texts.length);
    expect(sizes).toEqual([4, 4, 2]);
  });

  it("normal device keeps the full batch of 16", async () => {
    policy = NORMAL;
    const m = await fresh();
    await m.embedBatch(Array.from({ length: 20 }, (_, i) => `t${i}`));
    const sizes = FakeWorker.instances[0].posted
      .filter((p) => (p as { type: string }).type === "embed")
      .map((p) => (p as { texts: string[] }).texts.length);
    expect(sizes).toEqual([16, 4]);
  });

  it("constrained device: the worker is terminated after the idle time, and recreated on the next request", async () => {
    policy = CONSTRAINED;
    const m = await fresh();
    await m.embedText("a");
    const first = FakeWorker.instances[0];
    vi.advanceTimersByTime(59_000);
    expect(first.terminated).toBe(false);
    vi.advanceTimersByTime(2_000);
    expect(first.terminated).toBe(true);
    expect(m.isEmbedderReady()).toBe(false);
    await m.embedText("b");
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("normal device: the worker is never released for being idle", async () => {
    policy = NORMAL;
    const m = await fresh();
    await m.embedText("a");
    vi.advanceTimersByTime(10 * 60_000);
    expect(FakeWorker.instances[0].terminated).toBe(false);
  });
});
