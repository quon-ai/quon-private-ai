import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decryptJSON, encryptJSON, ensureReady } from "./crypto/quonCrypto";
import {
  archiveMemoryItem,
  confirmMemoryItem,
  FACT_MAX_CHARS,
  getAllMemory,
  getMemoryItem,
  isActiveMemory,
  kindForText,
  memorySyncStore,
  resetMemory,
  reviveMemoryItem,
  setMemoryProject,
  supersedeMemoryItem,
  touchMemoryUsage,
  upsertMemoryItem,
  USAGE_PUSH_DEBOUNCE_MS,
  type MemoryItem,
} from "./memoryStore";

function mem(partial: Partial<MemoryItem>): MemoryItem {
  return {
    id: "m1",
    kind: "fact",
    text: "Standard rate is 120 €/h",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

beforeEach(() => resetMemory());

describe("kindForText (fact-tier length ceiling)", () => {
  it("keeps the chosen kind for short texts", () => {
    expect(kindForText("Standard rate is 120 €/h", "fact")).toBe("fact");
    expect(kindForText("Standard rate is 120 €/h", "note")).toBe("note");
  });

  it("forces long texts to note, whatever was chosen", () => {
    const long = "x".repeat(FACT_MAX_CHARS + 1);
    expect(kindForText(long, "fact")).toBe("note");
    expect(kindForText(long, "note")).toBe("note");
  });
});

describe("setMemoryProject (move between project scopes)", () => {
  it("moves an item between projects and clears with undefined", () => {
    upsertMemoryItem(mem({ projectId: "p1" }));
    setMemoryProject("m1", "p2");
    expect(getMemoryItem("m1")?.projectId).toBe("p2");
    setMemoryProject("m1", undefined);
    expect(getMemoryItem("m1")?.projectId).toBeUndefined();
  });

  it("bumps updatedAt and fires the sync push: the latest scope wins across devices (LWW)", () => {
    upsertMemoryItem(mem({ updatedAt: 1 }));
    const pushed: MemoryItem[] = [];
    const off = memorySyncStore.onChange((it) => pushed.push(it));
    setMemoryProject("m1", "p1");
    off();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].projectId).toBe("p1");
    expect(pushed[0].updatedAt).toBeGreaterThan(1);
  });

  it("is pure scope reassignment: embeddings survive the move (no re-embed)", () => {
    upsertMemoryItem(mem({ embedding: [0.1, 0.2], dim: 2, embModel: "test-model" }));
    setMemoryProject("m1", "p1");
    const moved = getMemoryItem("m1");
    expect(moved?.embedding).toEqual([0.1, 0.2]);
    expect(moved?.embModel).toBe("test-model");
  });

  it("no-ops (no push, no updatedAt churn) when already in the target scope or unknown", () => {
    upsertMemoryItem(mem({ projectId: "p1", updatedAt: 5 }));
    const pushed: MemoryItem[] = [];
    const off = memorySyncStore.onChange((it) => pushed.push(it));
    setMemoryProject("m1", "p1"); // same scope
    setMemoryProject("missing", "p1"); // unknown id
    off();
    expect(pushed).toEqual([]);
    expect(getMemoryItem("m1")?.updatedAt).toBe(5);
  });
});

describe("MemoryItem.pinned: round-trips through the E2E-encrypted sync unchanged", () => {
  it("survives the exact encrypt/decrypt path collectionSync.ts uses to push/pull a memory item", async () => {
    // encryptJSON/decryptJSON (collectionSync.ts) serialize the whole item
    // generically (JSON.stringify -> secretbox), with no field allowlist -
    // this proves a brand-new optional field needs no sync/crypto change and
    // no migration to reach another device.
    await ensureReady();
    const key = new Uint8Array(32).fill(7);
    const item = mem({ pinned: true, key: "Notfallkontakt" });
    const ciphertext = encryptJSON(item, key);
    const roundTripped = decryptJSON<MemoryItem>(ciphertext, key);
    expect(roundTripped).toEqual(item);
    expect(roundTripped.pinned).toBe(true);
  });

  it("is undefined (not dropped/errored) for existing items that never set it", async () => {
    await ensureReady();
    const key = new Uint8Array(32).fill(7);
    const item = mem({}); // no `pinned` at all - the pre-existing shape
    const roundTripped = decryptJSON<MemoryItem>(encryptJSON(item, key), key);
    expect(roundTripped.pinned).toBeUndefined();
  });
});

describe("isActiveMemory (P5 lifecycle)", () => {
  it("absent status counts as active: every pre-P5 item", () => {
    expect(isActiveMemory({ status: undefined })).toBe(true);
  });

  it("superseded and archived are not active", () => {
    expect(isActiveMemory({ status: "superseded" })).toBe(false);
    expect(isActiveMemory({ status: "archived" })).toBe(false);
  });

  it("explicit 'active' is active", () => {
    expect(isActiveMemory({ status: "active" })).toBe(true);
  });
});

describe("touchMemoryUsage (P5 usage tracking)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("bumps lastUsedAt/useCount but never updatedAt", () => {
    upsertMemoryItem(mem({ updatedAt: 5 }));
    touchMemoryUsage("m1");
    const item = getMemoryItem("m1");
    expect(item?.useCount).toBe(1);
    expect(item?.lastUsedAt).toBeGreaterThan(0);
    expect(item?.updatedAt).toBe(5); // unchanged - see the doc comment on touchMemoryUsage

    touchMemoryUsage("m1");
    expect(getMemoryItem("m1")?.useCount).toBe(2);
  });

  it("is a no-op for an unknown id", () => {
    touchMemoryUsage("nope"); // must not throw
    expect(getMemoryItem("nope")).toBeUndefined();
  });

  it("batches multiple touches within the debounce window into one sync push", () => {
    upsertMemoryItem(mem({ updatedAt: 5 }));
    const pushed: MemoryItem[] = [];
    const off = memorySyncStore.onChange((it) => pushed.push(it));

    touchMemoryUsage("m1");
    touchMemoryUsage("m1");
    touchMemoryUsage("m1");
    expect(pushed).toHaveLength(0); // debounced - nothing pushed yet

    vi.advanceTimersByTime(USAGE_PUSH_DEBOUNCE_MS);
    off();
    expect(pushed).toHaveLength(1); // 3 touches -> exactly 1 push
    expect(pushed[0].useCount).toBe(3);
    // The pushed item's updatedAt is UNCHANGED - a stale-timestamp push can
    // never clobber a genuinely newer edit server-side (sync.py only rejects
    // an incoming write that is OLDER than what's stored).
    expect(pushed[0].updatedAt).toBe(5);
  });
});

describe("supersedeMemoryItem / reviveMemoryItem (P5: reversible, never delete)", () => {
  it("marks the loser superseded and records it on the winner's supersedes[]", () => {
    upsertMemoryItem(mem({ id: "old", updatedAt: 1 }));
    upsertMemoryItem(mem({ id: "new", updatedAt: 1 }));
    supersedeMemoryItem("old", "new");

    const old = getMemoryItem("old");
    expect(old?.status).toBe("superseded");
    expect(old?.supersededBy).toBe("new");
    expect(isActiveMemory(old!)).toBe(false);
    expect(getMemoryItem("new")?.supersedes).toEqual(["old"]);
    // Nothing is deleted - the item is still in the store.
    expect(getAllMemory().map((m) => m.id)).toEqual(expect.arrayContaining(["old", "new"]));
  });

  it("is reversible via reviveMemoryItem", () => {
    upsertMemoryItem(mem({ id: "old", updatedAt: 1 }));
    upsertMemoryItem(mem({ id: "new", updatedAt: 1 }));
    supersedeMemoryItem("old", "new");
    reviveMemoryItem("old");

    const revived = getMemoryItem("old");
    expect(isActiveMemory(revived!)).toBe(true);
    expect(revived?.status).toBeUndefined();
    expect(revived?.supersededBy).toBeUndefined();
    // The winner's provenance trail is a historical record, not a live
    // pointer - it is not retroactively cleaned up on revive.
    expect(getMemoryItem("new")?.supersedes).toEqual(["old"]);
  });

  it("no-ops for unknown ids or superseding an item by itself", () => {
    upsertMemoryItem(mem({ id: "a", updatedAt: 1 }));
    supersedeMemoryItem("a", "a"); // same id
    supersedeMemoryItem("a", "missing");
    supersedeMemoryItem("missing", "a");
    expect(getMemoryItem("a")?.status).toBeUndefined();
  });

  it("both sides fire the sync push (real edits)", () => {
    upsertMemoryItem(mem({ id: "old", updatedAt: 1 }));
    upsertMemoryItem(mem({ id: "new", updatedAt: 1 }));
    const pushed: string[] = [];
    const off = memorySyncStore.onChange((it) => pushed.push(it.id));
    supersedeMemoryItem("old", "new");
    off();
    expect(pushed).toEqual(expect.arrayContaining(["old", "new"]));
  });
});

describe("archiveMemoryItem / confirmMemoryItem", () => {
  it("archiveMemoryItem is reversible via reviveMemoryItem", () => {
    upsertMemoryItem(mem({ id: "a" }));
    archiveMemoryItem("a");
    expect(isActiveMemory(getMemoryItem("a")!)).toBe(false);
    expect(getMemoryItem("a")?.status).toBe("archived");
    reviveMemoryItem("a");
    expect(isActiveMemory(getMemoryItem("a")!)).toBe(true);
  });

  it("confirmMemoryItem bumps lastConfirmedAt but not updatedAt", () => {
    upsertMemoryItem(mem({ id: "a", updatedAt: 5 }));
    confirmMemoryItem("a");
    const item = getMemoryItem("a");
    expect(item?.lastConfirmedAt).toBeGreaterThan(0);
    expect(item?.updatedAt).toBe(5);
  });
});
