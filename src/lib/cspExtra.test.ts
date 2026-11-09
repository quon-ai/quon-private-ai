import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CSP_EXTRA_COOKIE,
  cspExtraFromCookieHeader,
  isAllowedCspExtraOrigin,
  setCspExtraCookie,
} from "./cspExtra";

/** The validator is the security boundary: whatever it accepts ends up in the
 *  page's connect-src. These tests pin the shape rules. */
describe("isAllowedCspExtraOrigin", () => {
  it("accepts a single https origin, with or without port", () => {
    expect(isAllowedCspExtraOrigin("https://myhost.tailnet-example.ts.net")).toBe(true);
    expect(isAllowedCspExtraOrigin("https://paperless.example.com:8443")).toBe(true);
  });

  it("accepts plain-http LOOPBACK only (local Paperless next to the browser)", () => {
    expect(isAllowedCspExtraOrigin("http://localhost:8100")).toBe(true);
    expect(isAllowedCspExtraOrigin("http://127.0.0.1:8100")).toBe(true);
    expect(isAllowedCspExtraOrigin("http://paperless.lan:8100")).toBe(false);
    expect(isAllowedCspExtraOrigin("http://192.168.1.5:8100")).toBe(false);
  });

  it("rejects everything that is not exactly one bare origin", () => {
    for (const bad of [
      "",
      "https://a.example https://b.example", // two origins
      "https://*.example.com", // wildcard
      "https://example.com/path", // path
      "https://example.com?x=1", // query
      "javascript:alert(1)",
      "wss://example.com", // scheme smuggling
      "https://exam ple.com",
      "https://-bad.example.com", // label can't start with '-'
      `https://${"a".repeat(120)}.com`, // over length bound
    ]) {
      expect(isAllowedCspExtraOrigin(bad), bad).toBe(false);
    }
  });
});

describe("cspExtraFromCookieHeader", () => {
  it("extracts and validates the cookie value", () => {
    const h = `quon_lang=de; ${CSP_EXTRA_COOKIE}=${encodeURIComponent("https://paperless.example.com")}; other=1`;
    expect(cspExtraFromCookieHeader(h)).toBe("https://paperless.example.com");
  });

  it("lowercases before validating (cookie values survive manual edits)", () => {
    const h = `${CSP_EXTRA_COOKIE}=${encodeURIComponent("HTTPS://Paperless.Example.COM")}`;
    expect(cspExtraFromCookieHeader(h)).toBe("https://paperless.example.com");
  });

  it("drops malformed values silently: a bad cookie must never break delivery", () => {
    expect(cspExtraFromCookieHeader(`${CSP_EXTRA_COOKIE}=javascript%3Aalert(1)`)).toBeNull();
    expect(cspExtraFromCookieHeader(`${CSP_EXTRA_COOKIE}=%E0%A4%A`)).toBeNull(); // bad escape
    expect(cspExtraFromCookieHeader(null)).toBeNull();
    expect(cspExtraFromCookieHeader("quon_lang=de")).toBeNull();
  });
});

describe("setCspExtraCookie (browser side)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubDocumentCookie(): { get: () => string } {
    let jar = "";
    vi.stubGlobal("document", {
      get cookie() {
        return jar;
      },
      set cookie(v: string) {
        jar = v; // last write wins - enough to assert the written attributes
      },
    });
    vi.stubGlobal("location", { protocol: "https:" });
    return { get: () => jar };
  }

  it("writes the validated origin with path/max-age/SameSite (+Secure on https)", () => {
    const jar = stubDocumentCookie();
    setCspExtraCookie("https://paperless.example.com");
    expect(jar.get()).toContain(
      `${CSP_EXTRA_COOKIE}=${encodeURIComponent("https://paperless.example.com")}`,
    );
    expect(jar.get()).toContain("SameSite=Lax");
    expect(jar.get()).toContain("Secure");
  });

  it("refuses to write an invalid origin at all", () => {
    const jar = stubDocumentCookie();
    setCspExtraCookie("https://evil.example/path");
    expect(jar.get()).toBe("");
  });

  it("null clears the cookie", () => {
    const jar = stubDocumentCookie();
    setCspExtraCookie(null);
    expect(jar.get()).toContain("max-age=0");
  });
});
