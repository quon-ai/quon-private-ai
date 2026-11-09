import { describe, expect, it } from "vitest";

import { isChunkLoadError, isOutdated } from "./appVersion";

/**
 * The banner this drives is the only thing standing between a deploy and a user
 * who keeps testing yesterday's JavaScript (an installed PWA never reloads on
 * its own). So the rule has to be right in both directions: it must notice a
 * new build, and it must never cry wolf - a permanent "new version" bar on a
 * current app would train the user to ignore it.
 */
describe("isOutdated", () => {
  it("flags a build that differs from the deployed one", () => {
    expect(isOutdated("abc123-m1", "def456-m2")).toBe(true);
  });

  it("stays quiet when they match", () => {
    expect(isOutdated("abc123-m1", "abc123-m1")).toBe(false);
    expect(isOutdated("abc123-m1", "  abc123-m1  ")).toBe(false); // whitespace only
  });

  it("stays quiet when the answer is unusable: a hiccup is not an update", () => {
    // Offline, a proxy error page, a truncated body: "don't know" must never
    // render as "outdated", or the bar never goes away.
    for (const bad of [null, undefined, "", "   ", 42, {}, []]) {
      expect(isOutdated("abc123-m1", bad)).toBe(false);
    }
  });

  it("is disabled for an unstamped build (dev server, tests)", () => {
    // Local dev has no stamp; nagging there would be noise in every session.
    expect(isOutdated("dev", "abc123-m1")).toBe(false);
    expect(isOutdated("", "abc123-m1")).toBe(false);
  });
});

/**
 * Reported from the photo scanner: "Failed to fetch dynamically imported
 * module: .../assets/ocr-BAbKNXTD.js". That is not a broken scanner - it is an
 * instance that outlived its build, asking for a chunk hash the deploy
 * replaced. Recognising it is what turns an alarming dead end into "reload".
 */
describe("isChunkLoadError", () => {
  it("recognises the wording of each engine", () => {
    for (const msg of [
      "Failed to fetch dynamically imported module: https://app.quon.example.com/assets/ocr-BAbKNXTD.js",
      "error loading dynamically imported module",
      "Importing a module script failed.", // Safari
    ]) {
      expect(isChunkLoadError(new Error(msg))).toBe(true);
    }
  });

  it("does not swallow unrelated failures", () => {
    // These must keep their own message - telling someone to reload when the
    // camera was denied is worse than saying nothing.
    for (const msg of [
      "No readable text found in this photo.",
      "NotAllowedError",
      "network error",
    ]) {
      expect(isChunkLoadError(new Error(msg))).toBe(false);
    }
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
