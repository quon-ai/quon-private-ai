import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HeavyWorkPolicy } from "@/lib/deviceClass";

/**
 * The boot summary must stay CONSTRAINED-only. It exists to give a future
 * crash report numbers (#68, #76), but logging it on every ordinary boot
 * would make the diag buffer non-empty for every healthy desktop/Android
 * user — and the feedback dialog reads "empty" as "nothing to report"
 * (tests/e2e/feedback.spec.ts). An earlier version of this function ran
 * unconditionally and broke exactly that contract; this test is the
 * regression lock.
 */

let policy: HeavyWorkPolicy;
vi.mock("@/lib/deviceClass", () => ({ currentPolicy: () => policy }));

const appended: string[] = [];
vi.mock("@/lib/diagLog", () => ({ diagAppend: (m: string) => appended.push(m) }));
vi.mock("@/lib/documentStore", () => ({
  getAllDocuments: () => [],
  whenDocumentsLoaded: () => Promise.resolve(),
}));
vi.mock("@/lib/documents/originalStore", () => ({ originalKind: () => null }));
vi.mock("@/lib/memoryStore", () => ({ getAllMemory: () => [] }));

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
const CONSTRAINED: HeavyWorkPolicy = { ...NORMAL, reason: "constrained" };
const SAFE_MODE: HeavyWorkPolicy = { ...NORMAL, reason: "safe-mode" };

beforeEach(() => {
  appended.length = 0;
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function fresh() {
  vi.resetModules();
  return import("./bootSummary");
}

describe("logBootSummary", () => {
  it("a normal-policy boot logs NOTHING — the diag buffer stays empty for a healthy user", async () => {
    policy = NORMAL;
    const { logBootSummary } = await fresh();
    await logBootSummary();
    expect(appended).toEqual([]);
  });

  it("a constrained device logs the summary line", async () => {
    policy = CONSTRAINED;
    const { logBootSummary } = await fresh();
    await logBootSummary();
    expect(appended).toHaveLength(1);
    expect(appended[0]).toContain("boot summary:");
    expect(appended[0]).toContain("policy=constrained");
  });

  it("safe mode logs it too — that is exactly the case with numbers worth having", async () => {
    policy = SAFE_MODE;
    const { logBootSummary } = await fresh();
    await logBootSummary();
    expect(appended[0]).toContain("policy=safe-mode");
  });

  it("only ever logs once per session, whichever policy runs first", async () => {
    policy = CONSTRAINED;
    const { logBootSummary } = await fresh();
    await logBootSummary();
    await logBootSummary();
    expect(appended).toHaveLength(1);
  });
});
