import { beforeEach, describe, expect, it, vi } from "vitest";

// No network in tests: the scrub + relay calls are mocked; everything else
// (stores, dedup, clustering) runs for real, in memory — same pattern as
// memoryExtract.test.ts.
vi.mock("./quonApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quonApi")>();
  return { ...actual, scrubText: vi.fn(), chatComplete: vi.fn() };
});

vi.mock("./embedding/embedder", () => ({
  EMBED_MODEL: "test-embed",
  EMBED_DIM: 3,
  embedText: vi.fn(async () => [1, 0, 0]),
  embedBatch: vi.fn(async (texts: string[]) => texts.map(() => [1, 0, 0])),
  isEmbedderReady: () => true,
  isEmbedderLoading: () => false,
  onEmbedderReady: () => () => {},
  warmEmbedder: () => {},
}));

import { EMBED_MODEL } from "./embedding/embedder";
import { applyMergeSuggestion, planTidy, runTidy, type TidyCluster } from "./memoryTidy";
import {
  getAllMemory,
  getMemoryItem,
  resetMemory,
  upsertMemoryItem,
  type MemoryItem,
} from "./memoryStore";
import {
  addMemorySuggestions,
  getAllMemorySuggestions,
  resetMemorySuggestions,
  type MemorySuggestion,
} from "./memorySuggestionStore";
import { chatComplete, scrubText, type ScrubResult } from "./quonApi";

const scrubMock = vi.mocked(scrubText);
const chatMock = vi.mocked(chatComplete);

function memItem(
  id: string,
  key: string,
  text: string,
  embedding: number[],
  overrides: Partial<MemoryItem> = {},
): MemoryItem {
  return {
    id,
    kind: "fact",
    key,
    text,
    tags: [],
    embedding,
    dim: embedding.length,
    embModel: EMBED_MODEL,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function scrubResult(
  scrubbed: string,
  entities: Array<{ placeholder: string; value: string }> = [],
): ScrubResult {
  return {
    scrubbed,
    original_length: scrubbed.length,
    scrubbed_length: scrubbed.length,
    entities: entities.map((e) => ({ ...e, type: "PERSON", confidence: 0.9 })),
    metadata: {
      model_used: "test",
      processing_time_ms: 1,
      fallback_mode: false,
      language_detected: "en",
    },
  };
}

beforeEach(() => {
  resetMemory();
  resetMemorySuggestions();
  scrubMock.mockReset();
  chatMock.mockReset();
});

// ---------------------------------------------------------------------------

describe("planTidy (pure clustering, no network)", () => {
  it("clusters ≥3 active items connected by cosine ≥ SIM_UPDATE", () => {
    // All pairwise-identical vectors → one connected component of 3.
    upsertMemoryItem(memItem("a", "K1", "text a", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "K2", "text b", [1, 0, 0]));
    upsertMemoryItem(memItem("c", "K3", "text c", [1, 0, 0]));
    const plan = planTidy(undefined);
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0].reason).toBe("similarity");
    expect(new Set(plan.clusters[0].itemIds)).toEqual(new Set(["a", "b", "c"]));
    expect(plan.estimatedRelayCalls).toBe(1);
  });

  it("does NOT cluster a pair (< 3 members) on similarity alone", () => {
    upsertMemoryItem(memItem("a", "K1", "text a", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "K2", "text b", [1, 0, 0]));
    expect(planTidy(undefined).clusters).toEqual([]);
  });

  it("does not connect items below SIM_UPDATE", () => {
    upsertMemoryItem(memItem("a", "K1", "text a", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "K2", "text b", [0, 1, 0])); // orthogonal — cosine 0
    upsertMemoryItem(memItem("c", "K3", "text c", [1, 0, 0]));
    // "a" and "c" are similar but that's still only 2 connected members.
    expect(planTidy(undefined).clusters).toEqual([]);
  });

  it("includes an unresolved key-conflict pair even at just 2 members", () => {
    upsertMemoryItem(memItem("a", "Adresse", "Hamburg", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "Adresse", "Berlin", [0, 1, 0])); // low cosine, but same key
    const plan = planTidy(undefined);
    expect(plan.clusters).toHaveLength(1);
    expect(plan.clusters[0].reason).toBe("key-conflict");
    expect(new Set(plan.clusters[0].itemIds)).toEqual(new Set(["a", "b"]));
  });

  it("does not double-count a key-conflict pair already inside a similarity cluster", () => {
    // 3 items, all near-identical cosine (one sim cluster), two of them ALSO
    // share a key with different text (would otherwise also be a conflict pair).
    upsertMemoryItem(memItem("a", "Adresse", "Hamburg", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "Adresse", "Berlin", [1, 0, 0]));
    upsertMemoryItem(memItem("c", "Sonstiges", "unrelated but similar vector", [1, 0, 0]));
    const plan = planTidy(undefined);
    expect(plan.clusters).toHaveLength(1); // not 2 — the pair is subsumed
    expect(plan.clusters[0].reason).toBe("similarity");
  });

  it("excludes non-active items", () => {
    upsertMemoryItem(memItem("a", "K1", "text a", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "K2", "text b", [1, 0, 0]));
    upsertMemoryItem(memItem("c", "K3", "text c", [1, 0, 0], { status: "superseded" }));
    // Only 2 ACTIVE connected members — below the ≥3 similarity threshold.
    expect(planTidy(undefined).clusters).toEqual([]);
  });

  it("respects scope isolation", () => {
    upsertMemoryItem(memItem("a", "K1", "text a", [1, 0, 0], { projectId: "p1" }));
    upsertMemoryItem(memItem("b", "K2", "text b", [1, 0, 0], { projectId: "p1" }));
    upsertMemoryItem(memItem("c", "K3", "text c", [1, 0, 0], { projectId: "p1" }));
    expect(planTidy(undefined).clusters).toEqual([]); // nothing global
    expect(planTidy("p1").clusters).toHaveLength(1);
  });
});

describe("runTidy (mocked scrub/relay, real queue)", () => {
  const cluster = (itemIds: string[]): TidyCluster => ({
    id: itemIds.join("+"),
    itemIds,
    reason: "similarity",
  });

  it("queues a 'merge' suggestion carrying every cluster member as targetIds", async () => {
    upsertMemoryItem(memItem("a", "Adresse", "Hamburg", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "Adresse", "Berlin", [1, 0, 0]));
    scrubMock.mockResolvedValue(scrubResult("- Adresse: [CITY]\n- Adresse: Berlin", []));
    chatMock.mockResolvedValue({
      answer: '[{"kind":"fact","key":"Adresse","text":"Berlin (aktuell)","tags":[]}]',
      model: "m",
    });

    const res = await runTidy({ scope: undefined, model: "m", clusters: [cluster(["a", "b"])] });
    expect(res).toEqual({ suggested: 1, failed: 0 });
    const sug = getAllMemorySuggestions()[0];
    expect(sug.mode).toBe("merge");
    expect(new Set(sug.targetIds)).toEqual(new Set(["a", "b"]));
    expect(sug.text).toBe("Berlin (aktuell)");
    // Nothing was written to Memory itself — still just 2 (untouched) items.
    expect(getAllMemory()).toHaveLength(2);
    expect(getMemoryItem("a")?.status).toBeUndefined();
    expect(getMemoryItem("b")?.status).toBeUndefined();
  });

  it("re-hydrates placeholders locally — the relay only ever saw scrubbed text", async () => {
    upsertMemoryItem(memItem("a", "Person", "Anna Müller arbeitet bei Contoso", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "Person", "Anna arbeitet bei Contoso GmbH", [1, 0, 0]));
    scrubMock.mockResolvedValue(
      scrubResult("- Person: [PERSON_1] arbeitet bei [ORG_1]", [
        { placeholder: "[PERSON_1]", value: "Anna Müller" },
        { placeholder: "[ORG_1]", value: "Contoso" },
      ]),
    );
    chatMock.mockResolvedValue({
      answer: '[{"kind":"fact","key":"Person","text":"[PERSON_1] arbeitet bei [ORG_1]","tags":[]}]',
      model: "m",
    });

    await runTidy({ scope: undefined, model: "m", clusters: [cluster(["a", "b"])] });
    expect(chatMock).toHaveBeenCalledWith(
      [
        expect.objectContaining({ role: "system" }),
        { role: "user", content: "- Person: [PERSON_1] arbeitet bei [ORG_1]" },
      ],
      "m",
      true,
      undefined,
    );
    expect(getAllMemorySuggestions()[0].text).toBe("Anna Müller arbeitet bei Contoso");
  });

  it("fails soft per cluster — one cluster's relay failure doesn't abort the rest", async () => {
    upsertMemoryItem(memItem("a", "K", "a", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "K", "b", [1, 0, 0]));
    upsertMemoryItem(memItem("c", "K2", "c", [1, 0, 0]));
    upsertMemoryItem(memItem("d", "K2", "d", [1, 0, 0]));
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock
      .mockResolvedValueOnce({ answer: "not json", model: "m" }) // cluster 1 fails to parse
      .mockResolvedValueOnce({
        answer: '[{"kind":"fact","key":"K2","text":"merged","tags":[]}]',
        model: "m",
      });

    const res = await runTidy({
      scope: undefined,
      model: "m",
      clusters: [cluster(["a", "b"]), cluster(["c", "d"])],
    });
    expect(res).toEqual({ suggested: 1, failed: 1 });
  });

  it("skips a cluster whose members no longer have ≥2 active items (edited/removed since planning)", async () => {
    upsertMemoryItem(memItem("a", "K", "a", [1, 0, 0]));
    // "b" was deleted after planning — only 1 active member left.
    const res = await runTidy({ scope: undefined, model: "m", clusters: [cluster(["a", "b"])] });
    expect(res).toEqual({ suggested: 0, failed: 0 });
    expect(scrubMock).not.toHaveBeenCalled();
  });

  it("a tidy run supersedes a pending suggestion that targets a merged member", async () => {
    upsertMemoryItem(memItem("a", "K", "a", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "K", "b", [1, 0, 0]));
    addMemorySuggestions([
      {
        id: "stale-update",
        kind: "fact",
        text: "some stale refinement",
        tags: [],
        mode: "update",
        targetId: "a", // targets a member this tidy run is about to merge away
        createdAt: 0,
      } satisfies MemorySuggestion,
    ]);
    scrubMock.mockResolvedValue(scrubResult("t"));
    chatMock.mockResolvedValue({
      answer: '[{"kind":"fact","key":"K","text":"merged","tags":[]}]',
      model: "m",
    });

    await runTidy({ scope: undefined, model: "m", clusters: [cluster(["a", "b"])] });
    expect(getAllMemorySuggestions().some((s) => s.id === "stale-update")).toBe(false);
  });

  it("onProgress fires (done, total) for every cluster, success or failure", async () => {
    upsertMemoryItem(memItem("a", "K", "a", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "K", "b", [1, 0, 0]));
    scrubMock.mockRejectedValue(new Error("scrubber down"));
    const progress: Array<[number, number]> = [];
    await runTidy({
      scope: undefined,
      model: "m",
      clusters: [cluster(["a", "b"])],
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([[1, 1]]);
  });
});

describe("applyMergeSuggestion (P5 — reversible accept)", () => {
  it("creates one new active item and supersedes every targetId", async () => {
    upsertMemoryItem(memItem("a", "Adresse", "Hamburg", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "Adresse", "Berlin", [1, 0, 0]));
    const suggestion: MemorySuggestion = {
      id: "sug1",
      kind: "fact",
      key: "Adresse",
      text: "Berlin (aktuell)",
      tags: [],
      mode: "merge",
      targetIds: ["a", "b"],
      createdAt: Date.now(),
    };
    addMemorySuggestions([suggestion]);

    const merged = await applyMergeSuggestion(suggestion);
    expect(merged.text).toBe("Berlin (aktuell)");
    expect(merged.status).toBeUndefined(); // the merged item itself is active

    expect(getMemoryItem("a")?.status).toBe("superseded");
    expect(getMemoryItem("a")?.supersededBy).toBe(merged.id);
    expect(getMemoryItem("b")?.status).toBe("superseded");
    expect(getMemoryItem("b")?.supersededBy).toBe(merged.id);
    // Nothing deleted — both originals still exist in the store.
    expect(getAllMemory().map((m) => m.id)).toEqual(expect.arrayContaining(["a", "b", merged.id]));

    // The suggestion is consumed.
    expect(getAllMemorySuggestions()).toHaveLength(0);
  });

  it("is reversible via reviveMemoryItem on either original", async () => {
    const { reviveMemoryItem } = await import("./memoryStore");
    upsertMemoryItem(memItem("a", "Adresse", "Hamburg", [1, 0, 0]));
    upsertMemoryItem(memItem("b", "Adresse", "Berlin", [1, 0, 0]));
    const suggestion: MemorySuggestion = {
      id: "sug1",
      kind: "fact",
      key: "Adresse",
      text: "Berlin (aktuell)",
      tags: [],
      mode: "merge",
      targetIds: ["a", "b"],
      createdAt: Date.now(),
    };
    await applyMergeSuggestion(suggestion);
    reviveMemoryItem("a");
    expect(getMemoryItem("a")?.status).toBeUndefined();
  });

  it("throws for a non-merge suggestion", async () => {
    const suggestion: MemorySuggestion = {
      id: "sug1",
      kind: "fact",
      text: "x",
      tags: [],
      mode: "create",
      createdAt: Date.now(),
    };
    await expect(applyMergeSuggestion(suggestion)).rejects.toThrow();
  });
});
