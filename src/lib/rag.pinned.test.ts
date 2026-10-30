import { beforeEach, describe, expect, it, vi } from "vitest";

// Pinned-document context: rag.ts injects pinned docs (the user's explicit
// "always use this") into every in-scope send, bypassing relevance retrieval.
// Mock the doc store so this runs without IndexedDB; memory store is real.

vi.mock("./embedding/embedder", () => ({
  EMBED_MODEL: "test-embed",
  EMBED_DIM: 3,
  embedText: vi.fn(async () => [1, 0, 0]),
  embedBatch: vi.fn(async (t: string[]) => t.map(() => [1, 0, 0])),
  isEmbedderReady: () => true,
  isEmbedderLoading: () => false,
  onEmbedderReady: () => () => {},
  warmEmbedder: () => {},
}));

const docs: Record<string, unknown>[] = [];
vi.mock("./documentStore", () => ({
  allDocChunks: () => [],
  getAllDocuments: () => docs,
  getDocumentText: (d: { fullText?: string }) => d.fullText ?? "",
}));

import { hasInjectableContext, hasPinnedDocs, pinnedDocContext } from "./rag";
import { resetMemory } from "./memoryStore";

function doc(over: Record<string, unknown>): Record<string, unknown> {
  return { id: "d1", filename: "vertrag.pdf", status: "ready", fullText: "Inhalt.", ...over };
}

beforeEach(() => {
  docs.length = 0;
  resetMemory();
});

describe("pinned document context", () => {
  it("only pinned, ready, in-scope docs with text count", () => {
    docs.push(doc({ id: "a", pinned: true, fullText: "AAA", projectId: undefined }));
    docs.push(doc({ id: "b", pinned: false, fullText: "BBB" })); // not pinned
    docs.push(doc({ id: "c", pinned: true, status: "processing", fullText: "CCC" })); // not ready
    docs.push(doc({ id: "e", pinned: true, fullText: "  " })); // empty text
    docs.push(doc({ id: "p", pinned: true, fullText: "PROJ", projectId: "p1" })); // other scope

    expect(hasPinnedDocs(undefined)).toBe(true);
    const ctx = pinnedDocContext(undefined);
    expect(ctx.sources.map((s) => s.itemId)).toEqual(["a"]);
    expect(ctx.text).toContain("AAA");
    expect(ctx.text).not.toContain("BBB");
    expect(ctx.text).not.toContain("PROJ");
    expect(ctx.sources[0]).toMatchObject({ kind: "document", score: 1, title: "vertrag.pdf" });
  });

  it("project scope sees only that project's pinned docs", () => {
    docs.push(doc({ id: "g", pinned: true, fullText: "GLOBAL", projectId: undefined }));
    docs.push(doc({ id: "p", pinned: true, fullText: "PROJ", projectId: "p1" }));
    expect(pinnedDocContext("p1").sources.map((s) => s.itemId)).toEqual(["p"]);
    expect(pinnedDocContext("p1").text).toContain("PROJ");
  });

  it("hasInjectableContext is true from a pinned doc even with no memory", () => {
    expect(hasInjectableContext(undefined)).toBe(false);
    docs.push(doc({ id: "a", pinned: true, fullText: "AAA" }));
    expect(hasInjectableContext(undefined)).toBe(true);
  });

  it("empty when nothing is pinned", () => {
    docs.push(doc({ id: "b", pinned: false, fullText: "BBB" }));
    expect(hasPinnedDocs(undefined)).toBe(false);
    expect(pinnedDocContext(undefined)).toEqual({ text: "", sources: [] });
  });
});
