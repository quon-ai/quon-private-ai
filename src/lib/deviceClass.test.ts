import { describe, expect, it } from "vitest";

import {
  CRASH_LOOP_SAFE_MODE_AT,
  heavyWorkPolicy,
  isConstrainedDevice,
  isIosDevice,
} from "./deviceClass";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1";
const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";

describe("isIosDevice / isConstrainedDevice", () => {
  it("every iPhone browser is iOS WebKit — Safari and Chrome alike (#68, #76)", () => {
    expect(isIosDevice({ ua: IPHONE_SAFARI })).toBe(true);
    expect(isIosDevice({ ua: IPHONE_CHROME })).toBe(true);
    expect(isConstrainedDevice({ ua: IPHONE_SAFARI })).toBe(true);
    expect(isConstrainedDevice({ ua: IPHONE_CHROME })).toBe(true);
  });

  it("iPadOS pretending to be a Mac is caught by the touch points", () => {
    expect(isIosDevice({ ua: MAC_CHROME, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ ua: MAC_CHROME, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });

  it("a desktop with plenty of memory is not constrained; Safari's missing deviceMemory does not make it so", () => {
    expect(isConstrainedDevice({ ua: MAC_CHROME, deviceMemory: 8 })).toBe(false);
    expect(isConstrainedDevice({ ua: MAC_CHROME })).toBe(false);
  });

  it("a low-memory Android reports deviceMemory ≤ 4 and is constrained; a flagship is not", () => {
    expect(isConstrainedDevice({ ua: PIXEL, deviceMemory: 4 })).toBe(true);
    expect(isConstrainedDevice({ ua: PIXEL, deviceMemory: 8 })).toBe(false);
  });
});

describe("heavyWorkPolicy", () => {
  it("normal devices keep every optimisation (the shipped behaviour)", () => {
    const p = heavyWorkPolicy(false, 0);
    expect(p).toMatchObject({
      prewarmEmbedder: true,
      backgroundReembed: true,
      backgroundOriginalsUpload: true,
      embedBatchSize: 16,
      releaseEmbedderIdleMs: 0,
      sequentialIngest: false,
      reason: "normal",
    });
    expect(p.maxAutoUploadBytes).toBe(Number.POSITIVE_INFINITY);
  });

  it("constrained devices never load the embedder ahead of need, embed in small batches, and release it when idle", () => {
    const p = heavyWorkPolicy(true, 0);
    expect(p.prewarmEmbedder).toBe(false);
    expect(p.backgroundReembed).toBe(false);
    expect(p.embedBatchSize).toBeLessThan(16);
    expect(p.releaseEmbedderIdleMs).toBeGreaterThan(0);
    // Uploads still happen — but not for the files that need ~3× their size in RAM.
    expect(p.backgroundOriginalsUpload).toBe(true);
    expect(p.maxAutoUploadBytes).toBeLessThan(50 * 1024 * 1024);
    expect(p.reason).toBe("constrained");
    expect(p.sequentialIngest).toBe(true);
  });

  it("a crash loop puts ANY device into safe mode: no optional heavy work at all", () => {
    for (const constrained of [false, true]) {
      const p = heavyWorkPolicy(constrained, CRASH_LOOP_SAFE_MODE_AT);
      expect(p.prewarmEmbedder).toBe(false);
      expect(p.backgroundReembed).toBe(false);
      expect(p.backgroundOriginalsUpload).toBe(false);
      expect(p.reason).toBe("safe-mode");
    }
    // One short crash is not a loop — could be the user force-closing the tab.
    expect(heavyWorkPolicy(false, CRASH_LOOP_SAFE_MODE_AT - 1).reason).toBe("normal");
  });
});
