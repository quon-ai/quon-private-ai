/**
 * Page-orientation recovery for on-device OCR — the pure decisions.
 *
 * The engine (PaddleOCR PP-OCRv6 tiny, ocr.ts) has no angle classifier: it
 * detects text regions in any orientation but RECOGNISES only horizontal,
 * upright lines. A page photographed or scanned in landscape (the operator's
 * report, 2026-09-14: „im Querformat gescannt … nur garbage") therefore comes
 * back as a list of short, low-confidence nonsense strings — every line was
 * read sideways. EXIF-upright decoding (ocr.ts) does not help: a scanner app
 * or a stripped photo carries no orientation to honour.
 *
 * The recovery uses what the first pass already tells us:
 *
 * - **Box geometry.** The detector's polygons are honest about the direction
 *   text runs in. Horizontal lines give wide boxes; a page rotated by ±90°
 *   gives TALL boxes. A majority of tall boxes → try 90° and 270°.
 * - **Recognition confidence.** Sideways or upside-down text scores low
 *   (garbage typically < 0.6; clean print > 0.85). Horizontal boxes with a poor
 *   score → the page is probably upside down (180°), so try that, then the
 *   quarter turns.
 *
 * Each retry is one more engine pass (~1 s on tiny); the best pass by
 * length-weighted confidence wins, and a good-enough pass stops the search.
 * Pure functions only — the canvas rotation and the engine calls live in ocr.ts.
 */

export type Point2D = [number, number];
export type Rotation = 0 | 90 | 180 | 270;

export interface OcrItemLike {
  poly?: Point2D[];
  text: string;
  score: number;
}

/** Below this length-weighted confidence a pass is treated as unreadable. */
export const POOR_QUALITY = 0.6;
/** At or above this the pass is accepted without trying further rotations. */
export const GOOD_QUALITY = 0.85;
/** A box is "tall" when its height exceeds its width by this factor. */
const TALL_RATIO = 1.5;

/** Length-weighted mean confidence — a long confident line counts for more
 *  than a two-character fragment. 0 when nothing was recognised. */
export function passQuality(items: readonly OcrItemLike[]): number {
  let weight = 0;
  let sum = 0;
  for (const it of items) {
    const w = Math.max(1, it.text.trim().length);
    weight += w;
    sum += w * (it.score ?? 0);
  }
  return weight === 0 ? 0 : sum / weight;
}

/** Fraction of boxes that are taller than wide (text running vertically).
 *  Items without a polygon are ignored; 0 when nothing can be measured. */
export function verticalFraction(items: readonly OcrItemLike[]): number {
  let measured = 0;
  let tall = 0;
  for (const it of items) {
    const p = it.poly;
    if (!p || p.length < 3) continue;
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    if (w <= 0 && h <= 0) continue;
    measured += 1;
    if (h > w * TALL_RATIO) tall += 1;
  }
  return measured === 0 ? 0 : tall / measured;
}

/**
 * Which extra rotations a first pass earns, best guess first.
 *
 * `blankIsLikely`: for a page of a scanned PDF an empty result is a normal
 * blank page, not a sideways one — never spend three passes on it. For a
 * photo the user just took, "nothing found" is far more often a sideways page.
 */
export function rotationsToTry(
  items: readonly OcrItemLike[],
  opts: { blankIsLikely?: boolean } = {},
): Rotation[] {
  if (items.length === 0) return opts.blankIsLikely ? [] : [90, 270, 180];
  if (verticalFraction(items) >= 0.5) return [90, 270];
  if (passQuality(items) < POOR_QUALITY) return [180, 90, 270];
  return [];
}

export interface OrientedPass<T extends OcrItemLike = OcrItemLike> {
  rotation: Rotation;
  items: T[];
}

/** The pass with the best quality; ties keep the earlier (unrotated) one. */
export function pickBestPass<T extends OcrItemLike>(
  passes: readonly OrientedPass<T>[],
): OrientedPass<T> {
  let best = passes[0];
  let bestQ = passQuality(best.items);
  for (const p of passes.slice(1)) {
    const q = passQuality(p.items);
    if (q > bestQ) {
      best = p;
      bestQ = q;
    }
  }
  return best;
}
