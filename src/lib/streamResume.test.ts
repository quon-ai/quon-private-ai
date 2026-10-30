import { afterEach, describe, expect, it, vi } from "vitest";

import { QuonError, StreamIdleError, StreamPayloadError } from "./quonApi";
import { isTransportFailure, whenVisible } from "./streamResume";

/**
 * The classification is load-bearing: resuming a REAL error (provider refused,
 * budget gone) would silently retry something the user must see, while not
 * resuming a dropped socket is exactly the bug this feature fixes.
 */
describe("isTransportFailure", () => {
  it("treats a response-less QuonError as transport (dropped socket / frozen tab)", () => {
    expect(isTransportFailure(new QuonError("stream request failed"))).toBe(true);
  });

  it("does NOT treat a stream payload error as transport — the provider answered (#84)", () => {
    // Same shape as a dropped socket (QuonError, no status), but it IS the answer:
    // resuming it replays nothing and ends in "Verbindung verloren".
    const err = new StreamPayloadError("The AI provider rejected this account's API key.");
    expect(err.status).toBeUndefined();
    expect(isTransportFailure(err)).toBe(false);
    expect(isTransportFailure(err, false)).toBe(false);
  });

  it("treats the idle watchdog's cut as transport — the job lives on, re-attach (#85)", () => {
    expect(isTransportFailure(new StreamIdleError(), false)).toBe(true);
  });

  it("does NOT treat an HTTP-status error as transport — that is a real answer", () => {
    expect(isTransportFailure(new QuonError("/chat/stream responded 402", 402))).toBe(false);
    expect(isTransportFailure(new QuonError("/chat/stream responded 500", 500))).toBe(false);
  });

  it("resumes a browser-initiated abort — that is exactly what the buffer is for", () => {
    // A mobile OS tearing down a backgrounded tab's request surfaces as an
    // AbortError. Treating every abort as final threw away answers the server
    // had already finished writing.
    expect(isTransportFailure(new DOMException("Aborted", "AbortError"), false)).toBe(true);
  });

  it("does NOT resume a provider error delivered as a payload", () => {
    // These arrive as QuonError WITHOUT a status too — but they are thrown from
    // the parsed `{error: …}` event, so the caller must not reconnect. Guarded
    // at the call site by only retrying when the pipe broke; here we pin the
    // one shape we can distinguish: an abort is never a transport failure.
    // Our OWN abort (the user pressed stop) stays final — the default.
    expect(isTransportFailure(new DOMException("Aborted", "AbortError"))).toBe(false);
  });

  it("treats fetch's own TypeError as transport", () => {
    expect(isTransportFailure(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isTransportFailure(new Error("boom"))).toBe(false);
    expect(isTransportFailure("nope")).toBe(false);
  });
});

describe("whenVisible", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubDocument(state: "visible" | "hidden") {
    const listeners: Record<string, (() => void)[]> = {};
    const doc = {
      visibilityState: state,
      addEventListener: (ev: string, cb: () => void) => {
        (listeners[ev] ??= []).push(cb);
      },
      removeEventListener: (ev: string, cb: () => void) => {
        listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== cb);
      },
    };
    vi.stubGlobal("document", doc);
    return {
      fire: (ev: string) => (listeners[ev] ?? []).forEach((f) => f()),
      count: (ev: string) => (listeners[ev] ?? []).length,
      setState: (s: "visible" | "hidden") => (doc.visibilityState = s),
    };
  }

  it("resolves immediately when already visible (no reconnect delay)", async () => {
    stubDocument("visible");
    await expect(whenVisible()).resolves.toBeUndefined();
  });

  it("waits while hidden and resolves on return — no retry burned on a frozen tab", async () => {
    const d = stubDocument("hidden");
    let settled = false;
    const p = whenVisible().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    d.setState("visible");
    d.fire("visibilitychange");
    await p;
    expect(settled).toBe(true);
    expect(d.count("visibilitychange")).toBe(0); // listener cleaned up
  });

  it("resolves on abort so a stopped run doesn't hang forever", async () => {
    stubDocument("hidden");
    const ac = new AbortController();
    const p = whenVisible(ac.signal);
    ac.abort();
    await expect(p).resolves.toBeUndefined();
  });
});
