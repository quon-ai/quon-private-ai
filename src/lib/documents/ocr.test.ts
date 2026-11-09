/**
 * Pure seams of the photo-OCR module. The engine itself (PaddleOCR + ONNX
 * WASM) is browser-only and validated empirically instead: CER 0 on a printed
 * German letter, <=2% on photo-simulated documents, in Chromium and WebKit.
 */
import { describe, expect, it } from "vitest";

import { bytesToB64, fitWithin, OCR_MAX_SIDE, sniffImageFormat } from "./ocr";

describe("fitWithin", () => {
  it("keeps images already within the cap untouched", () => {
    expect(fitWithin(1200, 800, 2000)).toEqual({ width: 1200, height: 800 });
    expect(fitWithin(2000, 1500, 2000)).toEqual({ width: 2000, height: 1500 });
  });

  it("never upscales small images", () => {
    expect(fitWithin(320, 240, 2000)).toEqual({ width: 320, height: 240 });
  });

  it("scales the longest side to the cap, preserving aspect ratio", () => {
    // 4032x3024 (typical 12 MP phone photo) -> 2000x1500
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 });
    // portrait
    expect(fitWithin(3024, 4032, 2000)).toEqual({ width: 1500, height: 2000 });
  });

  it("rounds to integers and never returns 0 on extreme aspect ratios", () => {
    const r = fitWithin(10000, 3, 2000);
    expect(r.width).toBe(2000);
    expect(r.height).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(r.height)).toBe(true);
  });

  it("uses a phone-RAM-friendly default cap (detection cost grows with area)", () => {
    expect(OCR_MAX_SIDE).toBeLessThanOrEqual(2048);
  });
});

describe("bytesToB64", () => {
  it("matches btoa on small inputs", () => {
    const bytes = new TextEncoder().encode("Hallo Welt");
    expect(bytesToB64(bytes)).toBe(btoa("Hallo Welt"));
  });

  it("handles empty input", () => {
    expect(bytesToB64(new Uint8Array(0))).toBe("");
  });

  it("round-trips binary data larger than one chunk (0x8000)", () => {
    const bytes = new Uint8Array(0x8000 * 2 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
    const decoded = Uint8Array.from(atob(bytesToB64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});

describe("sniffImageFormat (magic bytes: extensions and MIME lie)", () => {
  const pad = (head: number[], len = 16) => {
    const b = new Uint8Array(len);
    b.set(head);
    return b;
  };

  it("identifies png / jpeg / gif", () => {
    expect(sniffImageFormat(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(sniffImageFormat(pad([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniffImageFormat(pad([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("gif");
  });

  it("identifies webp (RIFF....WEBP)", () => {
    const b = pad([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageFormat(b)).toBe("webp");
  });

  it("tells HEIF and AVIF apart by the ftyp brand", () => {
    const ftyp = (brand: string) =>
      pad([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...[...brand].map((c) => c.charCodeAt(0))]);
    expect(sniffImageFormat(ftyp("heic"))).toBe("heif (heic)");
    expect(sniffImageFormat(ftyp("mif1"))).toBe("heif (mif1)");
    expect(sniffImageFormat(ftyp("avif"))).toBe("avif");
  });

  it("names empty and unknown honestly (the cloud-only Google-Photos class)", () => {
    expect(sniffImageFormat(new Uint8Array(0))).toBe("leer/empty");
    expect(sniffImageFormat(pad([1, 2, 3, 4]))).toBe("unbekannt/unknown");
  });
});
