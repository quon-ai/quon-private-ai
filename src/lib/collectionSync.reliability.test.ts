import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlobIn, PushResponse } from "./api/syncApi";

// The reliability net: a queued delete/edit must be pushed the moment the page
// is hidden (mobile background/close would otherwise drop it before the debounce
// fires), and a remote change must be pulled when the page becomes visible or
// the network returns — so a device left merely open still learns about a delete
// made elsewhere. This is what makes a cross-device deletion actually propagate.

const pushed: BlobIn[][] = [];
let changesCalls = 0;
vi.mock("./api/syncApi", () => ({
  syncApi: {
    changes: vi.fn(async () => {
      changesCalls++;
      return { changes: [], latest_seq: 0 };
    }),
    push: vi.fn(async (changes: BlobIn[]): Promise<PushResponse> => {
      pushed.push(changes);
      return { results: [], latest_seq: 1, project_latest_seqs: {} };
    }),
    blob: vi.fn(),
  },
}));
vi.mock("./authStore", () => ({ getMasterKey: () => new Uint8Array(32).fill(7) }));

import { createCollectionSync, type SyncStore } from "./collectionSync";

// Minimal localStorage + document/window for the node test env. collectionSync
// guards these with `typeof … !== "undefined"`, so they must exist to exercise
// the visibility/pagehide/online listeners.
const disk = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => disk.get(k) ?? null,
  setItem: (k: string, v: string) => void disk.set(k, v),
  removeItem: (k: string) => void disk.delete(k),
};

function makeEmitter() {
  const map = new Map<string, Set<() => void>>();
  return {
    addEventListener: (t: string, cb: () => void) => {
      if (!map.has(t)) map.set(t, new Set());
      map.get(t)!.add(cb);
    },
    removeEventListener: (t: string, cb: () => void) => void map.get(t)?.delete(cb),
    emit: (t: string) => {
      for (const cb of map.get(t) ?? []) cb();
    },
  };
}
const doc = Object.assign(makeEmitter(), { visibilityState: "visible" });
const win = makeEmitter();
(globalThis as Record<string, unknown>).document = doc;
(globalThis as Record<string, unknown>).window = win;

const PK = new Uint8Array(32).fill(1);
const tick = () => new Promise((r) => setTimeout(r, 5));

interface Item {
  id: string;
  updatedAt: number;
  text: string;
}

function makeStore(): SyncStore<Item> & { fireDelete: (ids: string[]) => void } {
  let deleteCb: ((ids: string[]) => void) | null = null;
  return {
    getAll: () => [],
    idOf: (i) => i.id,
    updatedAtOf: (i) => i.updatedAt,
    applyRemote: () => {},
    applyRemoteDeletion: () => {},
    onChange: () => () => {},
    onDelete: (cb) => {
      deleteCb = cb;
      return () => {};
    },
    fireDelete: (ids) => deleteCb?.(ids),
  };
}

beforeEach(() => {
  pushed.length = 0;
  changesCalls = 0;
  disk.clear();
  doc.visibilityState = "visible";
});

describe("collectionSync reliability net (cross-device delete propagation)", () => {
  it("flushes a queued delete tombstone when the page is hidden, before the debounce fires", async () => {
    const store = makeStore();
    // Huge debounce so the ONLY thing that can push the tombstone is the hidden
    // flush — proving the reliability net, not the timer.
    const sync = createCollectionSync<Item>({
      collection: "documents",
      deriveKey: () => PK,
      store,
      debounceMs: 10 * 60_000,
    });
    sync.start();
    await tick();
    pushed.length = 0; // ignore the start() push

    store.fireDelete(["doc-1"]); // queues a tombstone (debounce won't fire for 10min)
    await tick();
    expect(pushed).toHaveLength(0); // nothing pushed yet

    doc.visibilityState = "hidden";
    doc.emit("visibilitychange");
    await tick();

    const allBlobs = pushed.flat();
    const tombstone = allBlobs.find((b) => b.id === "doc-1");
    expect(tombstone).toMatchObject({ id: "doc-1", deleted: true, ciphertext: "" });
    sync.stop();
  });

  it("also flushes on pagehide (navigation / tab close)", async () => {
    const store = makeStore();
    const sync = createCollectionSync<Item>({
      collection: "documents",
      deriveKey: () => PK,
      store,
      debounceMs: 10 * 60_000,
    });
    sync.start();
    await tick();
    pushed.length = 0;

    store.fireDelete(["doc-2"]);
    win.emit("pagehide");
    await tick();

    expect(pushed.flat().some((b) => b.id === "doc-2" && b.deleted)).toBe(true);
    sync.stop();
  });

  it("pulls remote changes when the page becomes visible or the network returns", async () => {
    const store = makeStore();
    const sync = createCollectionSync<Item>({
      collection: "documents",
      deriveKey: () => PK,
      store,
      debounceMs: 10 * 60_000,
    });
    sync.start();
    await tick();
    changesCalls = 0; // ignore the start() pull

    doc.visibilityState = "visible";
    doc.emit("visibilitychange");
    await tick();
    expect(changesCalls).toBeGreaterThanOrEqual(1); // a pull happened on becoming visible

    changesCalls = 0;
    win.emit("online");
    await tick();
    expect(changesCalls).toBeGreaterThanOrEqual(1); // and on reconnect
    sync.stop();
  });

  it("removes its listeners on stop (no pull/flush after teardown)", async () => {
    const store = makeStore();
    const sync = createCollectionSync<Item>({
      collection: "documents",
      deriveKey: () => PK,
      store,
      debounceMs: 10 * 60_000,
    });
    sync.start();
    await tick();
    sync.stop();
    changesCalls = 0;
    pushed.length = 0;

    store.fireDelete(["doc-3"]);
    doc.visibilityState = "hidden";
    doc.emit("visibilitychange");
    win.emit("online");
    await tick();
    expect(pushed).toHaveLength(0);
    expect(changesCalls).toBe(0);
  });
});
