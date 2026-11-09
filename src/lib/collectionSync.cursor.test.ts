import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BlobIn, PushResponse } from "./api/syncApi";

/**
 * Cross-device chat loss: phone and laptop each show chats the other does not
 * have, seconds apart.
 *
 * Cause: a PUSH response reports the user's latest server seq - including
 * everything other devices wrote since our last pull. A pushing device that
 * adopts that as its pull cursor jumps over blobs it has never fetched. Since
 * the cursor only moves forward, those blobs are never seen again: a chat
 * written on the phone silently never reaches the laptop.
 *
 * The rule this pins: only a pull that actually APPLIED the changes may move the
 * cursor.
 */

/** Server seq of a blob another device wrote while we were editing. */
const OTHER_DEVICE_SEQ = 41;
/** What the server reports after our push - already past the other device's blob. */
const LATEST_AFTER_PUSH = 42;

const changesCalledWith: number[] = [];
let pulled = 0;

vi.mock("./api/syncApi", () => ({
  syncApi: {
    changes: vi.fn(async (_c: string, since: number) => {
      changesCalledWith.push(since);
      // The other device's blob is only returned while the cursor is behind it.
      if (since < OTHER_DEVICE_SEQ) {
        pulled++;
        return {
          changes: [
            { id: "from-other-device", ciphertext: OTHER_CIPHERTEXT, deleted: false, seq: 41 },
          ],
          latest_seq: LATEST_AFTER_PUSH,
        };
      }
      return { changes: [], latest_seq: LATEST_AFTER_PUSH };
    }),
    push: vi.fn(async (_changes: BlobIn[]): Promise<PushResponse> => ({
      results: [],
      latest_seq: LATEST_AFTER_PUSH,
      project_latest_seqs: {},
    })),
    blob: vi.fn(),
  },
}));
vi.mock("./authStore", () => ({ getMasterKey: () => new Uint8Array(32).fill(7) }));
// Plain JSON instead of libsodium: this test is about the pull CURSOR, and the
// real crypto needs an async sodium init that has nothing to do with it.
vi.mock("./crypto/quonCrypto", () => ({
  encryptJSON: (v: unknown) => JSON.stringify(v),
  decryptJSON: (s: string) => JSON.parse(s),
}));

import { createCollectionSync, type SyncStore } from "./collectionSync";

const KEY = new Uint8Array(32).fill(9);
const OTHER_CIPHERTEXT = JSON.stringify({ id: "from-other-device", updatedAt: 1000 });

const disk = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => disk.get(k) ?? null,
  setItem: (k: string, v: string) => void disk.set(k, v),
  removeItem: (k: string) => void disk.delete(k),
};
function emitter() {
  const map = new Map<string, Set<() => void>>();
  return {
    addEventListener: (t: string, cb: () => void) => {
      if (!map.has(t)) map.set(t, new Set());
      map.get(t)!.add(cb);
    },
    removeEventListener: (t: string, cb: () => void) => void map.get(t)?.delete(cb),
  };
}
(globalThis as Record<string, unknown>).document = Object.assign(emitter(), {
  visibilityState: "visible",
});
(globalThis as Record<string, unknown>).window = emitter();

interface Item {
  id: string;
  updatedAt: number;
}
const tick = () => new Promise((r) => setTimeout(r, 5));

describe("collectionSync pull cursor", () => {
  beforeEach(() => {
    disk.clear();
    changesCalledWith.length = 0;
    pulled = 0;
  });

  it("does not skip another device's blob when we push our own", async () => {
    const applied: Item[] = [];
    let onChange: (it: Item) => void = () => {};
    const store: SyncStore<Item> = {
      getAll: () => [],
      idOf: (i) => i.id,
      updatedAtOf: (i) => i.updatedAt,
      applyRemote: (i) => void applied.push(i),
      applyRemoteDeletion: () => {},
      onChange: (cb) => {
        onChange = cb;
        return () => {};
      },
      onDelete: () => () => {},
    };

    const sync = createCollectionSync<Item>({
      collection: "chat",
      deriveKey: () => KEY,
      store,
      debounceMs: 1,
    });
    sync.start();
    await tick();

    // We are at the cursor the start-up pull left us with - behind the other
    // device's blob, because it landed after we last looked.
    disk.set("quon_sync_seq_chat_v2", "0");
    applied.length = 0;

    // Our own local edit -> debounced push -> the reconciling pull.
    onChange({ id: "mine", updatedAt: 2000 });
    await new Promise((r) => setTimeout(r, 30));

    // The guarantee: the reconciling pull asked from before the other device's
    // blob, and applied it. Pre-fix the push response (seq 42) had already
    // become the cursor, so this pull asked from 42 and the blob was lost.
    expect(applied.map((i) => i.id)).toContain("from-other-device");
    expect(Math.min(...changesCalledWith)).toBeLessThan(OTHER_DEVICE_SEQ);
  });

  it("advances the cursor only after a pull that applied the changes", async () => {
    const store: SyncStore<Item> = {
      getAll: () => [],
      idOf: (i) => i.id,
      updatedAtOf: (i) => i.updatedAt,
      applyRemote: () => {},
      applyRemoteDeletion: () => {},
      onChange: () => () => {},
      onDelete: () => () => {},
    };
    const sync = createCollectionSync<Item>({
      collection: "chat",
      deriveKey: () => KEY,
      store,
      debounceMs: 1,
    });
    sync.start();
    await tick();
    // The start-up pull fetched everything and may move the cursor to the top.
    expect(Number(disk.get("quon_sync_seq_chat_v2"))).toBe(LATEST_AFTER_PUSH);
    expect(pulled).toBe(1);
  });
});
