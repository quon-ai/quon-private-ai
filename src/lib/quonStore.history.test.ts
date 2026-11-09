/**
 * The streaming write path: the emit gate and the coalescer.
 *
 * Both exist because `saveChatSession` runs once per streamed token (ScreenChat
 * persists on every `messages` change). Before this, each token re-rendered the
 * sidebar/dashboard/projects AND synchronously re-serialized + re-encrypted the
 * whole history into localStorage - measured at ~8 ms / ~62 ms / ~221 ms for a
 * light / mid / heavy history.
 *
 * Runs in the default `node` environment on purpose: under jsdom, libsodium
 * rejects the realm's Uint8Array ("unsupported input type for message"), so
 * encryptJSON throws, sealLocal swallows it, nothing is ever written and every
 * assertion here would pass vacuously. A real cache key is required for the
 * same reason - sealLocal returns null while locked.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureReady } from "./crypto/quonCrypto";
import { setLocalCacheKey } from "./localVault";
import {
  clearChatHistory,
  flushChatHistoryWrite,
  renameChatSession,
  saveChatSession,
  setChatProject,
  subscribeChatHistory,
  togglePinChatSession,
  type StoredChatMessage,
} from "./quonStore";

const turn = (n: number): StoredChatMessage[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, role: "user" as const, text: `m${i}` }));

beforeAll(async () => {
  await ensureReady();
  setLocalCacheKey(new Uint8Array(32).fill(3)); // unlocked, so sealLocal writes
});

beforeEach(() => {
  clearChatHistory();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("emit gate", () => {
  it("does not repaint the sidebar for a streamed token", () => {
    saveChatSession("c1", turn(1), { bump: true }); // the send
    const cb = vi.fn();
    const off = subscribeChatHistory(cb);

    // Streaming: content grows, bump:false, nothing the sidebar renders changes.
    for (let i = 2; i <= 30; i++) saveChatSession("c1", turn(i), { bump: false });

    expect(cb).not.toHaveBeenCalled();
    off();
  });

  it("still emits for everything the sidebar does render", () => {
    saveChatSession("c1", turn(1), { bump: true });

    for (const [label, act] of [
      ["a new session", () => saveChatSession("c2", turn(1), { bump: true })],
      ["a rename", () => renameChatSession("c1", "Renamed")],
      ["a pin", () => togglePinChatSession("c1")],
      ["a project move", () => setChatProject("c1", "p1")],
      ["a send (bump)", () => saveChatSession("c1", turn(2), { bump: true })],
    ] as Array<[string, () => void]>) {
      // Fake timers freeze Date.now(), so without this a bump would reuse the
      // previous `updatedAt` and correctly register as "nothing to repaint".
      vi.advanceTimersByTime(10);
      const cb = vi.fn();
      const off = subscribeChatHistory(cb);
      act();
      expect(cb, label).toHaveBeenCalled();
      off();
    }
  });

  it("emits when the title is still being derived from the first message", () => {
    // Early in a chat the derived title changes as the first message grows -
    // the sidebar must follow that.
    const cb = vi.fn();
    const off = subscribeChatHistory(cb);
    saveChatSession("c1", [{ id: 1, role: "user", text: "Hallo" }], { bump: false });
    saveChatSession("c1", [{ id: 1, role: "user", text: "Hallo Welt" }], { bump: false });
    expect(cb).toHaveBeenCalled();
    off();
  });
});

describe("coalescer", () => {
  it("folds a burst of streamed tokens into a single write", () => {
    const spy = vi.spyOn(localStorage, "setItem");
    saveChatSession("c1", turn(1), { bump: true }); // structural -> immediate
    spy.mockClear();

    for (let i = 2; i <= 50; i++) saveChatSession("c1", turn(i), { bump: false });
    expect(spy).not.toHaveBeenCalled(); // still pending

    vi.advanceTimersByTime(500);
    expect(spy).toHaveBeenCalledTimes(1); // 49 tokens -> one write
    spy.mockRestore();
  });

  it("writes a structural change immediately, never deferred", () => {
    saveChatSession("c1", turn(1), { bump: true });
    const spy = vi.spyOn(localStorage, "setItem");
    renameChatSession("c1", "Wichtig");
    expect(spy).toHaveBeenCalled(); // before any timer runs
    spy.mockRestore();
  });

  it("flushes a pending write on demand (what visibilitychange/pagehide call)", () => {
    saveChatSession("c1", turn(1), { bump: true });
    const spy = vi.spyOn(localStorage, "setItem");
    saveChatSession("c1", turn(2), { bump: false }); // pending
    spy.mockClear();

    flushChatHistoryWrite();

    expect(spy).toHaveBeenCalledTimes(1); // the tokens got out before suspend
    spy.mockRestore();
  });

  it("flush is a no-op when nothing is pending", () => {
    saveChatSession("c1", turn(1), { bump: true }); // structural -> already written
    const spy = vi.spyOn(localStorage, "setItem");
    flushChatHistoryWrite();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not lose the last token: the trailing write persists final state", () => {
    saveChatSession("c1", turn(1), { bump: true });
    const spy = vi.spyOn(localStorage, "setItem");
    saveChatSession("c1", turn(9), { bump: false });
    spy.mockClear();
    vi.advanceTimersByTime(500);

    // The coalesced write serializes CURRENT state, so the final token is in it.
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
