/**
 * Global text-size preference (feedback #62, item 2 — an iPhone-PWA user found
 * QUON's small text hard to read). Three discrete steps, not a slider —
 * "Standard / Größer / Groß" — set via a root font-size PERCENTAGE.
 *
 * Tailwind v4's type scale (`text-xs`, `text-sm`, …) is rem-based, so scaling
 * `document.documentElement`'s font-size scales every rem-sized element with
 * it — no per-component changes needed. The handful of hardcoded pixel sizes
 * in the app (`text-[10px]` etc.) do NOT scale; accepted trade-off, most of
 * the UI already uses Tailwind's rem scale.
 *
 * Device-local (see quonStore.ts's `fontScale` field docstring) — this reads
 * as a display preference of THIS device, not a synced account setting.
 */
export type FontScale = "standard" | "larger" | "large";

export const FONT_SCALE_OPTIONS: readonly FontScale[] = ["standard", "larger", "large"];

/** Root font-size as a percentage of the browser/device default (16px), per step. */
export const FONT_SCALE_PERCENT: Record<FontScale, number> = {
  standard: 100,
  larger: 112.5,
  large: 125,
};

export function isFontScale(v: unknown): v is FontScale {
  return v === "standard" || v === "larger" || v === "large";
}

/** Apply a scale to the document root. No-op outside the browser (SSR, or a
 *  Node test environment with no DOM). */
export function applyFontScale(scale: FontScale): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.fontSize = `${FONT_SCALE_PERCENT[scale]}%`;
}
