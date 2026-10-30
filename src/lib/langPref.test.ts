import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_LANG,
  getLangPref,
  hasExplicitLangPref,
  langFromCookieHeader,
  setLangPref,
} from "./langPref";

function stub(cookie = "") {
  const ls = new Map<string, string>();
  let doc = cookie;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => ls.get(k) ?? null,
    setItem: (k: string, v: string) => void ls.set(k, v),
    removeItem: (k: string) => void ls.delete(k),
  });
  vi.stubGlobal("document", {
    get cookie() {
      return doc;
    },
    set cookie(v: string) {
      // minimal: remember the last name=value written
      const [pair] = v.split(";");
      doc = pair;
    },
    documentElement: { lang: "" },
  });
  vi.stubGlobal("location", { protocol: "https:" });
  vi.stubGlobal("navigator", { language: "en-US" });
  return ls;
}

describe("langPref", () => {
  beforeEach(() => stub());
  afterEach(() => vi.unstubAllGlobals());

  it("parses the cookie header", () => {
    expect(langFromCookieHeader("a=1; quon_lang=de; b=2")).toBe("de");
    expect(langFromCookieHeader("quon_lang=en")).toBe("en");
    expect(langFromCookieHeader("quon_lang=fr")).toBeNull();
    expect(langFromCookieHeader("")).toBeNull();
  });

  it("falls back to the edition's default with no explicit choice, regardless of the browser locale", () => {
    // Browser is English, but there's no cookie/localStorage → the registry decides,
    // not the locale ("de" in the hosted product, "en" in the public build).
    vi.stubGlobal("navigator", { language: "en-US" });
    expect(getLangPref()).toBe(DEFAULT_LANG);
    expect(["de", "en"]).toContain(DEFAULT_LANG);
    expect(hasExplicitLangPref()).toBe(false);
  });

  it("setLangPref persists to localStorage + cookie and is then explicit", () => {
    setLangPref("en");
    expect(getLangPref()).toBe("en");
    expect(hasExplicitLangPref()).toBe(true);
    setLangPref("de");
    expect(getLangPref()).toBe("de");
  });

  it("survives storage that throws (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    });
    expect(() => setLangPref("en")).not.toThrow();
  });
});
