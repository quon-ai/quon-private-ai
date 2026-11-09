import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlobIn, PushResponse } from "./api/syncApi";

/**
 * The timing hole in the evicted-cache reset: the engine waits for the local
 * database before its first pull, but only for a bounded time. On a slow
 * device the database opens after that first pull went out with the stale
 * cursor - the reset then lands on an engine that has already asked. The
 * reset must therefore make every running engine pull again from 0.
 */
const changesCalledWith: number[] = [];

vi.mock("./api/syncApi", () => ({
  syncApi: {
    changes: vi.fn(async (_c: string, since: number) => {
      changesCalledWith.push(since);
      return { changes: [], latest_seq: 52130 };
    }),
    push: vi.fn(async (_changes: BlobIn[]): Promise<PushResponse> => ({
      results: [],
      latest_seq: 52130,
      project_latest_seqs: {},
    })),
    blob: vi.fn(),
  },
}));
vi.mock("./authStore", () => ({ getMasterKey: () => new Uint8Array(32).fill(7) }));
vi.mock("./crypto/quonCrypto", () => ({
  encryptJSON: (v: unknown) => JSON.stringify(v),
  decryptJSON: (s: string) => JSON.parse(s),
}));

import { createCollectionSync, type SyncStore } from "./collectionSync";
import { resetAllSyncCursors, SYNC_CURSOR_PREFIX } from "./syncCursor";

const disk = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => disk.get(k) ?? null,
  setItem: (k: string, v: string) => void disk.set(k, v),
  removeItem: (k: string) => void disk.delete(k),
  key: (i: number) => Array.from(disk.keys())[i] ?? null,
  get length() {
    return disk.size;
  },
};

type Item = { id: string; updatedAt: number };
function store(): SyncStore<Item> {
  return {
    getAll: () => [],
    idOf: (it) => it.id,
    updatedAtOf: (it) => it.updatedAt,
    applyRemote: () => {},
    applyRemoteDeletion: () => {},
    onChange: () => () => {},
    onDelete: () => () => {},
  };
}

beforeEach(() => {
  disk.clear();
  changesCalledWith.length = 0;
});

describe("collectionSync: a cursor reset after the first pull", () => {
  it("pulls again from 0 instead of trusting the pull that already went out with the stale cursor", async () => {
    disk.set(`${SYNC_CURSOR_PREFIX}projects_v2`, "52130"); // survived the eviction
    const engine = createCollectionSync<Item>({
      collection: "projects",
      deriveKey: () => new Uint8Array(32).fill(9),
      store: store(),
    });
    engine.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(changesCalledWith).toEqual([52130]); // the stale first pull - too early to know

    resetAllSyncCursors(); // the database opened: it was new
    await new Promise((r) => setTimeout(r, 0));
    expect(changesCalledWith).toEqual([52130, 0]); // asked again, from the beginning
    engine.stop();
  });
});
