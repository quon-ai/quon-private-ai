import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { captureCsrf, clearCsrf, csrfToken } from "./csrf";

/** Forget the module's in-memory copy without touching localStorage - what an
 *  app restart looks like from the module's point of view. */
async function reload() {
  vi.resetModules();
  return (await import("./csrf")) as typeof import("./csrf");
}

/**
 * The load-bearing case is the NATIVE one: there, `document.cookie` is empty
 * for the session's cookies (the Rust jar holds them), so without capture the
 * token is "" and every write 403s. The web path must be untouched.
 */

const TAURI = "__TAURI_INTERNALS__";

function setNative(on: boolean) {
  if (on) (globalThis as unknown as Record<string, unknown>)[TAURI] = {};
  else delete (globalThis as unknown as Record<string, unknown>)[TAURI];
}

function res(setCookie?: string | string[]): Response {
  const headers = new Headers();
  // Mimic what the Tauri plugin does: override `headers` with an object that
  // carries set-cookie (browsers strip it as a forbidden response header).
  const r = new Response("", { status: 200 });
  if (setCookie !== undefined) {
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    // append, not set: that is how several Set-Cookie headers really arrive,
    // and it is what makes getSetCookie() split them again.
    for (const c of list) headers.append("set-cookie", c);
  }
  Object.defineProperty(r, "headers", { value: headers });
  return r;
}

/**
 * The suite runs in `node` (no DOM) on purpose - see vitest.config.ts. A
 * two-line cookie stub keeps it that way; the code only ever reads
 * `document.cookie` as a string.
 */
function setCookieJar(value: string) {
  (globalThis as unknown as Record<string, unknown>).document = { cookie: value };
}

beforeEach(() => {
  clearCsrf();
  setCookieJar("");
  globalThis.localStorage.clear();
});

afterEach(() => {
  setNative(false);
  clearCsrf();
  delete (globalThis as unknown as Record<string, unknown>).document;
});

describe("web", () => {
  it("reads the token from document.cookie", () => {
    setCookieJar("quon_csrf=web-token");
    expect(csrfToken()).toBe("web-token");
  });

  it("ignores set-cookie entirely: the cookie jar is authoritative", () => {
    setCookieJar("quon_csrf=web-token");
    captureCsrf(res("quon_csrf=from-header; Path=/"));
    expect(csrfToken()).toBe("web-token");
  });
});

describe("native", () => {
  beforeEach(() => setNative(true));

  it("captures the token from set-cookie when document.cookie cannot see it", () => {
    expect(csrfToken()).toBe("");
    captureCsrf(res("quon_csrf=native-token; Path=/; SameSite=Lax"));
    expect(csrfToken()).toBe("native-token");
  });

  it("picks ours out of several cookies on one response", () => {
    captureCsrf(
      res([
        "quon_session=abc.def; Path=/; HttpOnly",
        "quon_csrf=the-real-one; Path=/",
        "other=x; Path=/",
      ]),
    );
    expect(csrfToken()).toBe("the-real-one");
  });

  it("does not match a cookie whose name merely ends in ours", () => {
    captureCsrf(res("not_quon_csrf=wrong; Path=/"));
    expect(csrfToken()).toBe("");
  });

  it("keeps the previous token when a response sets no cookie", () => {
    captureCsrf(res("quon_csrf=first; Path=/"));
    captureCsrf(res());
    expect(csrfToken()).toBe("first");
  });

  it("adopts a fresh token on re-login", () => {
    captureCsrf(res("quon_csrf=first; Path=/"));
    captureCsrf(res("quon_csrf=second; Path=/"));
    expect(csrfToken()).toBe("second");
  });

  it("forgets the token on sign-out", () => {
    captureCsrf(res("quon_csrf=first; Path=/"));
    clearCsrf();
    expect(csrfToken()).toBe("");
    expect(globalThis.localStorage.getItem("quon_csrf_native")).toBeNull();
  });

  /**
   * In the macOS app the host's cookie jar persists the 30-day session cookie
   * across a restart, so the app comes back already signed in - but the server
   * only sends `quon_csrf` when it issues a session. A token kept only in memory
   * is gone by then, and the first write of the new run would 403 while
   * everything looked fine.
   */
  it("survives an app restart, because the session cookie does", async () => {
    captureCsrf(res("quon_csrf=persisted; Path=/"));
    // A restart: module state is gone, localStorage and the host jar are not.
    const fresh = await reload();
    expect(fresh.csrfToken()).toBe("persisted");
  });

  it("does not hand a stored token to the web build", async () => {
    captureCsrf(res("quon_csrf=persisted; Path=/"));
    const fresh = await reload();
    setNative(false);
    setCookieJar("");
    expect(fresh.csrfToken()).toBe("");
  });
});
