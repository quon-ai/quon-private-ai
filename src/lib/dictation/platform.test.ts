// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { isIos, micPlatform } from "./platform";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36";

const nav = (o: Record<string, unknown>): Navigator =>
  ({ userAgent: "", platform: "", maxTouchPoints: 0, ...o }) as unknown as Navigator;

describe("isIos", () => {
  it("recognises an iPhone", () => {
    expect(isIos(nav({ userAgent: IPHONE }))).toBe(true);
  });

  it("recognises an iPad, which claims to be a Mac — touch points are the tell", () => {
    expect(isIos(nav({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 }))).toBe(
      true,
    );
  });

  it("does not mistake a real Mac for one", () => {
    expect(isIos(nav({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 }))).toBe(false);
  });
});

describe("micPlatform — picks which keyboard instructions to show", () => {
  it("names each platform", () => {
    expect(micPlatform(nav({ userAgent: IPHONE }))).toBe("ios");
    expect(micPlatform(nav({ userAgent: ANDROID }))).toBe("android");
    expect(micPlatform(nav({ userAgent: MAC, platform: "MacIntel" }))).toBe("macos");
    expect(micPlatform(nav({ userAgent: WINDOWS }))).toBe("windows");
    expect(micPlatform(nav({ userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/141.0" }))).toBe(
      "other",
    );
  });

  it("sends an iPad to the iOS instructions, not the macOS ones", () => {
    // The Mac branch would otherwise win: an iPad's UA says "Macintosh".
    expect(
      micPlatform(nav({ userAgent: IPAD_AS_MAC, platform: "MacIntel", maxTouchPoints: 5 })),
    ).toBe("ios");
  });
});
