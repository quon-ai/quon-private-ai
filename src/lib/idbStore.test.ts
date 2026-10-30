import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SYNC_CURSOR_PREFIX } from "./syncCursor";

/**
 * Feedback #88: „Meine Projekte werden nicht mehr angezeigt obwohl ich welche
 * habe" — the browser evicted the IndexedDB cache, the sync cursors in
 * localStorage survived, and the device never asked the server again.
 * Opening the database must notice it had to CREATE it and reset the cursors;
 * a blocked or outdated upgrade must open the stored version instead of
 * hanging every store.
 */
vi.mock("./localVault", () => ({
  whenLocalCacheKey: async () => {},
  openLocal: () => null,
  sealLocal: () => null,
  openLocalBytes: () => null,
  sealLocalBytes: () => null,
}));
const diag = vi.fn();
vi.mock("./diagLog", () => ({ diagAppend: (m: string) => diag(m) }));

type Req = {
  onupgradeneeded: ((ev: { oldVersion: number }) => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  result: unknown;
  error: { name: string } | null;
};
function fakeDb(version: number) {
  return {
    version,
    objectStoreNames: { contains: () => false },
    createObjectStore: vi.fn(),
    close: vi.fn(),
    onversionchange: null as (() => void) | null,
  };
}
/** A fake `indexedDB` whose on-disk version is `stored` (0 = no database). */
function installFakeIndexedDB(stored: number, mode: "normal" | "blocked" = "normal") {
  const opens: Array<{ version?: number; req: Req }> = [];
  const idb = {
    open(_name: string, version?: number): Req {
      const req: Req = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        result: null,
        error: null,
      };
      opens.push({ version, req });
      setTimeout(() => {
        if (version !== undefined && version > stored) {
          if (mode === "blocked") return req.onblocked?.(); // and never completes
          req.result = fakeDb(version);
          req.onupgradeneeded?.({ oldVersion: stored });
          req.onsuccess?.();
        } else if (version !== undefined && version < stored) {
          req.error = { name: "VersionError" };
          req.onerror?.();
        } else {
          req.result = fakeDb(stored);
          req.onsuccess?.();
        }
      }, 0);
      return req;
    },
  };
  vi.stubGlobal("indexedDB", idb);
  return opens;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  diag.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("idbStore — opening the local database", () => {
  it("a database that had to be created resets the surviving sync cursors (evicted cache, #88)", async () => {
    localStorage.setItem(`${SYNC_CURSOR_PREFIX}projects_v2`, "52130");
    localStorage.setItem(`${SYNC_CURSOR_PREFIX}memory_v2`, "52130");
    installFakeIndexedDB(0);
    const { whenLocalDbOpened } = await import("./idbStore");
    await whenLocalDbOpened();
    expect(localStorage.getItem(`${SYNC_CURSOR_PREFIX}projects_v2`)).toBeNull();
    expect(localStorage.getItem(`${SYNC_CURSOR_PREFIX}memory_v2`)).toBeNull();
    expect(diag).toHaveBeenCalledWith(expect.stringContaining("re-pulling everything"));
  });

  it("a genuine first run (no cursors) says nothing — empty diag = healthy", async () => {
    installFakeIndexedDB(0);
    const { whenLocalDbOpened } = await import("./idbStore");
    await whenLocalDbOpened();
    expect(diag).not.toHaveBeenCalled();
  });

  it("an ordinary version upgrade keeps the cursors — the data is still there", async () => {
    localStorage.setItem(`${SYNC_CURSOR_PREFIX}projects_v2`, "52130");
    installFakeIndexedDB(5);
    const { whenLocalDbOpened } = await import("./idbStore");
    await whenLocalDbOpened();
    expect(localStorage.getItem(`${SYNC_CURSOR_PREFIX}projects_v2`)).toBe("52130");
    expect(diag).not.toHaveBeenCalled();
  });

  it("an upgrade blocked by another open window falls back to the stored version instead of hanging", async () => {
    const opens = installFakeIndexedDB(5, "blocked");
    const { whenLocalDbOpened } = await import("./idbStore");
    await Promise.race([
      whenLocalDbOpened(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("hung")), 2000)),
    ]);
    expect(opens.map((o) => o.version)).toEqual([expect.any(Number), undefined]); // versioned, then current
    expect(diag).toHaveBeenCalledWith(
      expect.stringContaining("blocked by another open QUON window"),
    );
  });

  it("a database already upgraded by a newer build is opened at its version, not refused", async () => {
    const opens = installFakeIndexedDB(99);
    const { whenLocalDbOpened } = await import("./idbStore");
    await whenLocalDbOpened();
    expect(opens.map((o) => o.version)).toEqual([expect.any(Number), undefined]);
    expect(diag).toHaveBeenCalledWith(expect.stringContaining("newer QUON build"));
  });
});
