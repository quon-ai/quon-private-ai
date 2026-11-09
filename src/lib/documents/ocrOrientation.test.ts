import { describe, expect, it } from "vitest";

import {
  GOOD_QUALITY,
  passQuality,
  pickBestPass,
  POOR_QUALITY,
  rotationsToTry,
  verticalFraction,
  type OcrItemLike,
  type Point2D,
} from "./ocrOrientation";

/** A detector box: wide (a horizontal line) or tall (text running vertically). */
function box(w: number, h: number, x = 0, y = 0): Point2D[] {
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}
const line = (text: string, score: number, poly = box(400, 30)): OcrItemLike => ({
  text,
  score,
  poly,
});

describe("passQuality", () => {
  it("is the length-weighted mean confidence: a long confident line outweighs a fragment", () => {
    const items = [line("Sehr geehrte Damen und Herren", 0.98), line("x", 0.1)];
    expect(passQuality(items)).toBeGreaterThan(0.9);
  });
  it("is 0 for an empty pass", () => {
    expect(passQuality([])).toBe(0);
  });
});

describe("verticalFraction", () => {
  it("wide boxes -> 0, tall boxes -> 1, mixed -> the share of tall ones", () => {
    expect(verticalFraction([line("a", 0.9, box(400, 30)), line("b", 0.9, box(300, 28))])).toBe(0);
    expect(verticalFraction([line("a", 0.9, box(30, 400)), line("b", 0.9, box(28, 300))])).toBe(1);
    expect(
      verticalFraction([
        line("a", 0.9, box(30, 400)),
        line("b", 0.9, box(400, 30)),
        line("c", 0.9, box(28, 300)),
        line("d", 0.9, box(400, 30)),
      ]),
    ).toBe(0.5);
  });
  it("ignores items without a usable polygon", () => {
    expect(verticalFraction([{ text: "a", score: 0.9 }, line("b", 0.9, box(30, 400))])).toBe(1);
    expect(verticalFraction([{ text: "a", score: 0.9 }])).toBe(0);
  });
});

describe("rotationsToTry", () => {
  it("a clean upright page earns no retry", () => {
    expect(
      rotationsToTry([line("Rechnung Nr. 4711", 0.97), line("Betrag 120,00 €", 0.95)]),
    ).toEqual([]);
  });

  it("a landscape scan: tall boxes: tries the two quarter turns (the operator's report)", () => {
    const sideways = [
      line("l;3jk", 0.31, box(28, 380)),
      line("q0r", 0.27, box(30, 410)),
      line("Hf|", 0.44, box(26, 350)),
    ];
    expect(rotationsToTry(sideways)).toEqual([90, 270]);
  });

  it("horizontal boxes but poor confidence: probably upside down: tries 180° first", () => {
    const upsideDown = [line("uǝɥɔɐɯ", 0.35), line("ɹǝp", 0.4)];
    expect(rotationsToTry(upsideDown)).toEqual([180, 90, 270]);
  });

  it("nothing found: a photo tries every rotation, a PDF page is a blank page", () => {
    expect(rotationsToTry([])).toEqual([90, 270, 180]);
    expect(rotationsToTry([], { blankIsLikely: true })).toEqual([]);
  });

  it("the thresholds are ordered: poor below good", () => {
    expect(POOR_QUALITY).toBeLessThan(GOOD_QUALITY);
  });
});

describe("pickBestPass", () => {
  it("keeps the pass with the best quality, and the unrotated one on a tie", () => {
    const passes = [
      { rotation: 0 as const, items: [line("l;3jk", 0.31, box(28, 380))] },
      { rotation: 90 as const, items: [line("Sehr geehrte Frau Beispiel", 0.96)] },
      { rotation: 270 as const, items: [line("ǝldsıǝq nɐɹℲ", 0.4)] },
    ];
    expect(pickBestPass(passes).rotation).toBe(90);
    expect(
      pickBestPass([
        { rotation: 0 as const, items: [line("a", 0.9)] },
        { rotation: 180 as const, items: [line("b", 0.9)] },
      ]).rotation,
    ).toBe(0);
  });
});
