/**
 * The sync status store — the surface that makes a wedged collection visible.
 *
 * The distinction these lock in: progress is transient (answers "is it still
 * running?"), blocked is durable (answers "this will never sync until you act").
 * Conflating them is how the original bug stayed invisible for so long.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSyncBlocked,
  getSyncStatus,
  getSyncStatusServer,
  reportSyncBlocked,
  reportSyncEnd,
  reportSyncProgress,
  reportSyncStart,
  resetSyncStatus,
  subscribeSyncStatus,
} from "./syncStatus";

beforeEach(() => resetSyncStatus());

describe("progress", () => {
  it("is idle before anything happens", () => {
    const s = getSyncStatus();
    expect(s.busy).toBe(false);
    expect(s.total).toBe(0);
    expect(s.blocked).toEqual([]);
  });

  it("aggregates concurrent collections into one counter", () => {
    // The 6 personal engines each flush on their own timer, so the banner has
    // to read as ONE operation rather than six competing ones.
    reportSyncStart("chat", 100);
    reportSyncStart("documents", 50);
    reportSyncProgress("chat", 30, 100);
    reportSyncProgress("documents", 10, 50);

    const s = getSyncStatus();
    expect(s.busy).toBe(true);
    expect(s.done).toBe(40);
    expect(s.total).toBe(150);
  });

  it("goes idle only when the last collection finishes", () => {
    reportSyncStart("chat", 10);
    reportSyncStart("memory", 10);
    reportSyncEnd("chat", true);
    expect(getSyncStatus().busy).toBe(true);
    reportSyncEnd("memory", true);
    expect(getSyncStatus().busy).toBe(false);
  });

  it("stamps lastSyncedAt on a clean finish but not a failed one", () => {
    expect(getSyncStatus().lastSyncedAt).toBeNull();
    reportSyncStart("chat", 1);
    reportSyncEnd("chat", false);
    expect(getSyncStatus().lastSyncedAt).toBeNull();

    reportSyncStart("chat", 1);
    reportSyncEnd("chat", true);
    expect(getSyncStatus().lastSyncedAt).toBeGreaterThan(0);
  });

  it("ignores progress for a collection that already stopped", () => {
    reportSyncStart("chat", 10);
    reportSyncEnd("chat", true);
    reportSyncProgress("chat", 5, 10); // late callback after stop()
    expect(getSyncStatus().busy).toBe(false);
    expect(getSyncStatus().total).toBe(0);
  });
});

describe("blocked", () => {
  it("survives the push completing — it is not progress", () => {
    // The whole point: the operation "finishes", but the item still can't sync.
    reportSyncStart("chat", 5);
    reportSyncBlocked({ collection: "chat", id: "huge", reason: "toobig", bytes: 5_000_000 });
    reportSyncEnd("chat", true);

    const s = getSyncStatus();
    expect(s.busy).toBe(false);
    expect(s.blocked).toHaveLength(1);
    expect(s.blocked[0]).toMatchObject({ collection: "chat", id: "huge", reason: "toobig" });
  });

  it("does not duplicate the same blob across repeated pushes", () => {
    // Every subsequent flush re-reports the same oversized item; the banner must
    // keep saying "1", not climb forever.
    for (let i = 0; i < 5; i++) {
      reportSyncBlocked({ collection: "chat", id: "huge", reason: "toobig", bytes: 5_000_000 });
    }
    expect(getSyncStatus().blocked).toHaveLength(1);
  });

  it("clears once the item fits again", () => {
    reportSyncBlocked({ collection: "chat", id: "huge", reason: "toobig", bytes: 5_000_000 });
    clearSyncBlocked("chat", "huge");
    expect(getSyncStatus().blocked).toEqual([]);
  });

  it("keeps blobs from different collections apart", () => {
    reportSyncBlocked({ collection: "chat", id: "x", reason: "toobig", bytes: 9 });
    reportSyncBlocked({ collection: "documents", id: "x", reason: "toobig", bytes: 9 });
    expect(getSyncStatus().blocked).toHaveLength(2);
  });
});

describe("subscription", () => {
  it("keeps a stable snapshot reference when nothing observable moved", () => {
    // useSyncExternalStore re-renders on identity change; the pull loop applies
    // hundreds of blobs, so a fresh object each time would thrash the shell.
    const before = getSyncStatus();
    clearSyncBlocked("chat", "never-blocked"); // no-op
    expect(getSyncStatus()).toBe(before);
  });

  it("notifies subscribers on a real change and stops after unsubscribe", () => {
    const cb = vi.fn();
    const off = subscribeSyncStatus(cb);
    reportSyncStart("chat", 10);
    expect(cb).toHaveBeenCalled();

    off();
    const calls = cb.mock.calls.length;
    reportSyncProgress("chat", 5, 10);
    expect(cb.mock.calls.length).toBe(calls);
  });

  it("does not re-notify when a repeated report changes nothing", () => {
    reportSyncStart("chat", 10);
    const cb = vi.fn();
    subscribeSyncStatus(cb);
    reportSyncProgress("chat", 5, 10);
    reportSyncProgress("chat", 5, 10); // identical
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("resets everything on logout", () => {
    reportSyncStart("chat", 10);
    reportSyncBlocked({ collection: "chat", id: "huge", reason: "toobig", bytes: 9 });
    resetSyncStatus();

    const s = getSyncStatus();
    expect(s.busy).toBe(false);
    expect(s.blocked).toEqual([]);
    expect(s.lastSyncedAt).toBeNull();
  });

  it("reports a constant on the server so hydration stays stable", () => {
    expect(getSyncStatusServer().busy).toBe(false);
    expect(getSyncStatusServer()).toBe(getSyncStatusServer());
  });
});
