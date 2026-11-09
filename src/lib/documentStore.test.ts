import { beforeEach, describe, expect, it } from "vitest";

import {
  addDocumentRedactTerm,
  collectRedactTerms,
  documentSyncStore,
  getDocument,
  getDocumentText,
  removeDocumentRedactTerm,
  renameDocument,
  resetDocuments,
  setDocumentProject,
  type DocItem,
  upsertDocument,
} from "./documentStore";

function doc(partial: Partial<DocItem>): DocItem {
  return {
    id: "d1",
    filename: "f.txt",
    mime: "text/plain",
    status: "ready",
    chunks: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("getDocumentText", () => {
  it("returns the clean fullText when present", () => {
    expect(getDocumentText(doc({ fullText: "hello world" }))).toBe("hello world");
  });

  it("reconstructs from chunks in index order", () => {
    const out = getDocumentText(
      doc({
        chunks: [
          { index: 1, text: "Second part." },
          { index: 0, text: "First part." },
        ],
      }),
    );
    expect(out.indexOf("First")).toBeLessThan(out.indexOf("Second"));
  });

  it("strips the chunker's overlap seam (no duplicated text)", () => {
    // chunk 1 repeats the tail of chunk 0, as the overlapping chunker produces.
    const out = getDocumentText(
      doc({
        chunks: [
          { index: 0, text: "The quick brown fox jumps" },
          { index: 1, text: "fox jumps over the lazy dog" },
        ],
      }),
    );
    expect(out).toContain("The quick brown fox jumps over the lazy dog");
    expect(out.match(/fox jumps/g)?.length).toBe(1);
  });

  it("prefers fullText over chunk reconstruction", () => {
    const out = getDocumentText(
      doc({ fullText: "canonical", chunks: [{ index: 0, text: "from chunks" }] }),
    );
    expect(out).toBe("canonical");
  });
});

describe("renameDocument", () => {
  beforeEach(() => resetDocuments());

  it("stores the trimmed name and pushes it so other devices follow (LWW)", () => {
    upsertDocument(doc({ filename: "scan_0001.pdf", updatedAt: 1 }));
    const pushed: DocItem[] = [];
    const off = documentSyncStore.onChange((d) => pushed.push(d));
    expect(renameDocument("d1", "  Mietvertrag 2026.pdf  ")).toBe("Mietvertrag 2026.pdf");
    off();
    expect(getDocument("d1")?.filename).toBe("Mietvertrag 2026.pdf");
    expect(pushed).toHaveLength(1);
    expect(pushed[0].updatedAt).toBeGreaterThan(1);
  });

  it("keeps chunks, embeddings and the connector source: a rename is a label change only", () => {
    upsertDocument(
      doc({
        chunks: [{ index: 0, text: "chunk", embedding: [0.1] }],
        source: { connector: "dropbox", ref: "/akten/x.pdf" },
      }),
    );
    renameDocument("d1", "Neuer Name.pdf");
    const after = getDocument("d1");
    expect(after?.chunks).toEqual([{ index: 0, text: "chunk", embedding: [0.1] }]);
    // Re-import idempotency keys off `source`, so renaming must not break it.
    expect(after?.source).toEqual({ connector: "dropbox", ref: "/akten/x.pdf" });
  });

  it("no-ops on an empty, unchanged or unknown name (no push, no updatedAt churn)", () => {
    upsertDocument(doc({ filename: "f.txt", updatedAt: 5 }));
    const pushed: DocItem[] = [];
    const off = documentSyncStore.onChange((d) => pushed.push(d));
    expect(renameDocument("d1", "   ")).toBeNull();
    expect(renameDocument("d1", "f.txt")).toBeNull();
    expect(renameDocument("missing", "x.txt")).toBeNull();
    off();
    expect(pushed).toEqual([]);
    expect(getDocument("d1")?.updatedAt).toBe(5);
  });
});

describe("setDocumentProject (move between project scopes)", () => {
  beforeEach(() => resetDocuments());

  it("moves a document between projects and clears with undefined", () => {
    upsertDocument(doc({ projectId: "p1" }));
    setDocumentProject("d1", "p2");
    expect(getDocument("d1")?.projectId).toBe("p2");
    setDocumentProject("d1", undefined);
    expect(getDocument("d1")?.projectId).toBeUndefined();
  });

  it("bumps updatedAt and fires the sync push: the latest scope wins across devices (LWW)", () => {
    upsertDocument(doc({ updatedAt: 1 }));
    const pushed: DocItem[] = [];
    const off = documentSyncStore.onChange((d) => pushed.push(d));
    setDocumentProject("d1", "p1");
    off();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].projectId).toBe("p1");
    expect(pushed[0].updatedAt).toBeGreaterThan(1);
  });

  it("is pure scope reassignment: chunks/embeddings survive the move (no re-embed)", () => {
    upsertDocument(doc({ chunks: [{ index: 0, text: "chunk", embedding: [0.1, 0.2] }] }));
    setDocumentProject("d1", "p1");
    expect(getDocument("d1")?.chunks).toEqual([{ index: 0, text: "chunk", embedding: [0.1, 0.2] }]);
  });

  it("no-ops (no push, no updatedAt churn) when already in the target scope or unknown", () => {
    upsertDocument(doc({ projectId: "p1", updatedAt: 5 }));
    const pushed: DocItem[] = [];
    const off = documentSyncStore.onChange((d) => pushed.push(d));
    setDocumentProject("d1", "p1"); // same scope
    setDocumentProject("missing", "p1"); // unknown id
    off();
    expect(pushed).toEqual([]);
    expect(getDocument("d1")?.updatedAt).toBe(5);
  });
});

describe("per-document redact terms", () => {
  beforeEach(() => resetDocuments());

  it("adds a term on the document and bumps updatedAt so it syncs", () => {
    upsertDocument(doc({ id: "d1", updatedAt: 100 }));
    addDocumentRedactTerm("d1", "Vorgangscode Q7TR41");
    const d = getDocument("d1")!;
    expect(d.redactTerms).toEqual(["Vorgangscode Q7TR41"]);
    // Without the bump the change never reaches the sync push (LWW).
    expect(d.updatedAt).toBeGreaterThan(100);
  });

  it("de-dups case-insensitively, keeping the first spelling", () => {
    upsertDocument(doc({ id: "d1" }));
    addDocumentRedactTerm("d1", "Anna Muster");
    addDocumentRedactTerm("d1", "anna muster");
    expect(getDocument("d1")!.redactTerms).toEqual(["Anna Muster"]);
  });

  it("ignores blanks and unknown documents rather than throwing mid-flow", () => {
    upsertDocument(doc({ id: "d1" }));
    addDocumentRedactTerm("d1", "   ");
    addDocumentRedactTerm("missing", "x");
    expect(getDocument("d1")!.redactTerms).toBeUndefined();
  });

  it("removes a term case-insensitively", () => {
    upsertDocument(doc({ id: "d1", redactTerms: ["Anna Muster", "48213"] }));
    removeDocumentRedactTerm("d1", "ANNA MUSTER");
    expect(getDocument("d1")!.redactTerms).toEqual(["48213"]);
  });

  it("collectRedactTerms unions across documents, de-duped", () => {
    // This is what the SEND merges into always_redact - the enforcement input.
    upsertDocument(doc({ id: "d1", redactTerms: ["Anna Muster", "48213"] }));
    upsertDocument(doc({ id: "d2", filename: "g.txt", redactTerms: ["anna muster", "Q7TR41"] }));
    expect(collectRedactTerms(["d1", "d2", "missing"])).toEqual(["Anna Muster", "48213", "Q7TR41"]);
    expect(collectRedactTerms([])).toEqual([]);
  });
});
