import { afterEach, describe, expect, it, vi } from "vitest";

import {
  embed,
  http,
  isNative,
  mail,
  platformKind,
  provideEmbed,
  provideHttp,
  provideMail,
  resetForTest,
  streamingFetch,
} from "./index";
import { provideStreamHttpPlugin, type StreamHttpPlugin } from "./streamHttp";

/**
 * The seam's load-bearing property is that the WEB path is unchanged: the
 * hosted build must behave exactly as before, or every existing test stops
 * describing the shipped product.
 */

afterEach(() => {
  // Reset the injected implementation between tests.
  provideHttp({ unrestricted: false, fetch: (...a) => globalThis.fetch(...a) });
  delete (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  delete (globalThis as unknown as Record<string, unknown>).Capacitor;
});

/** The Android shell (Capacitor). Its bridge object is also present when the
 *  same bundle is opened in a browser tab - only `isNativePlatform()` decides. */
describe("the Capacitor shell", () => {
  it("is native only when the bridge says so", () => {
    resetForTest();
    (globalThis as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => false,
    };
    expect(platformKind()).toBe("web");
    expect(isNative()).toBe(false);
    expect(http().unrestricted).toBe(false);

    (globalThis as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
    };
    expect(platformKind()).toBe("capacitor");
    expect(isNative()).toBe(true);
  });

  it("routes http through the (natively patched) global fetch, resolved per call", async () => {
    resetForTest();
    (globalThis as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
    };
    const cap = http();
    expect(cap.unrestricted).toBe(true);
    const seen: unknown[] = [];
    const original = globalThis.fetch;
    // The native bridge swaps `fetch` at startup; the capability must pick up
    // whatever is installed at CALL time, not what it captured earlier.
    globalThis.fetch = (async (...a: unknown[]) => {
      seen.push(a[0]);
      return new Response("ok");
    }) as typeof globalThis.fetch;
    try {
      await cap.fetch("https://example.test/health");
    } finally {
      globalThis.fetch = original;
    }
    expect(seen).toEqual(["https://example.test/health"]);
  });

  it("streams the chat answer through the native StreamHttp plugin, not CapacitorHttp", async () => {
    resetForTest();
    (globalThis as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
    };
    const started: unknown[] = [];
    const fake: StreamHttpPlugin = {
      async start(opts) {
        started.push(opts.url);
        // The native thread answers with the head right away.
        queueMicrotask(() => heads.forEach((cb) => cb({ id: opts.id, status: 200, headers: {} })));
        return { id: opts.id };
      },
      async cancel() {},
      addListener(event, cb) {
        if (event === "head") heads.push(cb);
        return { remove() {} };
      },
    };
    const heads: Array<(d: Record<string, unknown>) => void> = [];
    provideStreamHttpPlugin(fake);
    try {
      // Never the (patched) global fetch - that one buffers.
      globalThis.fetch = (() => {
        throw new Error("global fetch must not be used for a streamed response");
      }) as typeof globalThis.fetch;
      const res = await streamingFetch()("https://api.test/chat/stream", { method: "POST" });
      expect(res.status).toBe(200);
      expect(started).toEqual(["https://api.test/chat/stream"]);
    } finally {
      provideStreamHttpPlugin(null);
    }
  });

  it("on the web, streamingFetch is the plain fetch (it already streams)", () => {
    resetForTest();
    const plain = ((..._a: unknown[]) =>
      Promise.resolve(new Response("x"))) as typeof globalThis.fetch;
    provideHttp({ unrestricted: false, fetch: plain });
    expect(streamingFetch()).toBe(plain);
  });

  it("has no mail / files / embed host yet: those stay null, like the web", () => {
    resetForTest();
    (globalThis as unknown as Record<string, unknown>).Capacitor = {
      isNativePlatform: () => true,
    };
    expect(mail()).toBeNull();
    expect(embed()).toBeNull();
  });
});

/**
 * An install step the router kicks off without awaiting loses the race against
 * the first health poll: that poll goes out through the browser fetch, is
 * refused by CORS, and the native app shows "QUON nicht erreichbar" against a
 * healthy API. Asking for the capability must be enough, with nothing having
 * run first.
 */
describe("the native capability cannot be raced", () => {
  it("routes natively on the very first call, with no install step", () => {
    // Deliberately not calling provideHttp: this is a cold start.
    resetForTest();
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(http().unrestricted).toBe(true);
  });

  it("still reports the web capability when there is no host", () => {
    resetForTest();
    expect(http().unrestricted).toBe(false);
  });
});

describe("platform detection", () => {
  it("is web unless the Tauri host injected itself", () => {
    expect(platformKind()).toBe("web");
    expect(isNative()).toBe(false);
  });

  it("is tauri when the host is present", () => {
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(platformKind()).toBe("tauri");
    expect(isNative()).toBe(true);
  });
});

describe("http capability", () => {
  it("defaults to the page's own fetch, origin-bound", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const cap = http();
    expect(cap.unrestricted).toBe(false);
    await cap.fetch("https://example.com/x");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("uses an installed native implementation instead", async () => {
    const native = vi.fn(async () => new Response("native"));
    provideHttp({ unrestricted: true, fetch: native as unknown as typeof globalThis.fetch });
    const cap = http();
    expect(cap.unrestricted).toBe(true);
    expect(await (await cap.fetch("https://example.com/x")).text()).toBe("native");
  });

  it("survives being destructured: the default must stay bound", async () => {
    // An unbound globalThis.fetch throws "Illegal invocation" in some engines,
    // and every call site destructures.
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok"));
    const { fetch: f } = http();
    await expect(f("https://example.com/x")).resolves.toBeInstanceOf(Response);
    spy.mockRestore();
  });
});

describe("mail capability", () => {
  it("is null on the web: a browser has no TCP, the source simply doesn't exist", () => {
    resetForTest();
    expect(mail()).toBeNull();
  });

  it("exists in the native shell without any install step", () => {
    resetForTest();
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(mail()).not.toBeNull();
  });

  it("an injected implementation wins (tests / mocks)", async () => {
    resetForTest();
    const fake = {
      storePassword: async () => {},
      deletePassword: async () => {},
      listFolders: async () => ["INBOX"],
      search: async () => [],
      read: async () => ({
        uid: 1,
        messageId: null,
        from: null,
        to: null,
        date: null,
        subject: null,
        body: "",
      }),
      fetchSince: async () => ({
        uidValidity: 1,
        reset: false,
        messages: [],
        lastUid: 0,
        more: false,
      }),
    };
    provideMail(fake);
    expect(await mail()!.listFolders("h", 993, "u")).toEqual(["INBOX"]);
    provideMail(null); // and null can be forced (a web-mode test in a shell)
    expect(mail()).toBeNull();
  });
});

describe("embed capability", () => {
  it("is null on the web: the browser worker path stays as before", () => {
    resetForTest();
    expect(embed()).toBeNull();
  });

  it("exists in the native shell (Rust embedder, no WASM in the webview)", () => {
    resetForTest();
    (globalThis as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    expect(embed()).not.toBeNull();
  });

  it("an injected implementation wins, and null can be forced", async () => {
    resetForTest();
    provideEmbed({ warm: async () => {}, embed: async () => [[1, 2, 3]] });
    expect(await embed()!.embed(["x"])).toEqual([[1, 2, 3]]);
    provideEmbed(null);
    expect(embed()).toBeNull();
  });
});
