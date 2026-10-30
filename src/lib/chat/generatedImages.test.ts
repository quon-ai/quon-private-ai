import { describe, expect, it } from "vitest";

import { chunkIdFor, MAX_IMAGE_BYTES, parseImageDataUrl } from "./generatedImages";

/** A 1×1 transparent PNG — the smallest valid image payload. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("parseImageDataUrl", () => {
  it("decodes a PNG data URL into mime + bytes (the PNG magic survives)", () => {
    const parsed = parseImageDataUrl(`data:image/png;base64,${PNG_B64}`);
    expect(parsed?.mime).toBe("image/png");
    expect(Array.from(parsed!.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("lower-cases the mime and tolerates whitespace inside the base64", () => {
    const parsed = parseImageDataUrl(
      `data:image/JPEG;base64,${PNG_B64.slice(0, 20)}\n${PNG_B64.slice(20)}`,
    );
    expect(parsed?.mime).toBe("image/jpeg");
  });

  it("rejects anything that is not an inline image — a remote URL, a non-image, an empty body", () => {
    expect(parseImageDataUrl("https://example.test/x.png")).toBeNull();
    expect(parseImageDataUrl("data:text/plain;base64,aGk=")).toBeNull();
    expect(parseImageDataUrl("data:image/png;base64,")).toBeNull();
  });
});

describe("chunkIdFor", () => {
  it("keeps generated images apart from document originals in the shared collection", () => {
    expect(chunkIdFor("abc", 0)).toBe("img:abc:0");
    expect(chunkIdFor("abc", 3)).toMatch(/^img:/);
  });
});

describe("MAX_IMAGE_BYTES", () => {
  it("is generous for a provider image but bounded", () => {
    expect(MAX_IMAGE_BYTES).toBeGreaterThan(4 * 1024 * 1024);
    expect(MAX_IMAGE_BYTES).toBeLessThan(50 * 1024 * 1024);
  });
});
