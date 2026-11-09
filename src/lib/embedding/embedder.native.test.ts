/**
 * The load-bearing native invariant: when the Rust embed capability is
 * present, the webview must never construct the Web Worker - that worker is
 * what loads the ~20MB ONNX/WASM runtime whose WebKit compilation gets the
 * WebContent process CPU-killed. Proving "no WASM in the webview" as a
 * race-free code invariant beats archaeology on a running process's mmaps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// resetModules gives each test a FRESH module graph, so platform + embedder
// must be imported together per test - otherwise provideEmbed lands on a
// different platform instance than the embedder sees.
async function freshModules(embedImpl: unknown) {
  vi.resetModules();
  const platform = await import("@/lib/platform");
  (platform.provideEmbed as (i: unknown) => void)(embedImpl);
  const embedder = await import("./embedder");
  return { platform, embedder };
}

// A Worker constructor that screams if the native path ever touches it.
const workerCtor = vi.fn();

beforeEach(() => {
  workerCtor.mockReset();
  vi.stubGlobal(
    "Worker",
    class {
      constructor(...args: unknown[]) {
        workerCtor(...args);
      }
      postMessage() {}
      terminate() {}
    },
  );
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("native embedding routes around the WASM worker", () => {
  it("warmEmbedder + embedText use the capability and never new a Worker", async () => {
    const { embedder: mod } = await freshModules({
      warm: vi.fn(async () => {}),
      embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
    });

    mod.warmEmbedder();
    const vec = await mod.embedText("hallo welt");

    expect(vec).toEqual([0.1, 0.2, 0.3]);
    expect(workerCtor).not.toHaveBeenCalled();
  });

  it("readiness flips through the capability's warm(), not a worker status message", async () => {
    let resolveWarm!: () => void;
    const { embedder: mod } = await freshModules({
      warm: () => new Promise<void>((r) => (resolveWarm = r)),
      embed: async () => [[0]],
    });

    expect(mod.isEmbedderReady()).toBe(false);
    mod.warmEmbedder();
    expect(mod.isEmbedderLoading()).toBe(true);
    resolveWarm();
    await vi.waitFor(() => expect(mod.isEmbedderReady()).toBe(true));
    expect(workerCtor).not.toHaveBeenCalled();
  });

  it("with no capability (web), it does build the worker: the fallback still works", async () => {
    const { embedder: mod } = await freshModules(null);
    mod.warmEmbedder();
    expect(workerCtor).toHaveBeenCalledTimes(1);
  });
});
