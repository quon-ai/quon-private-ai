import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyFontScale, FONT_SCALE_OPTIONS, FONT_SCALE_PERCENT, isFontScale } from "./fontScale";

describe("fontScale", () => {
  it("maps each step to the expected root percentage", () => {
    expect(FONT_SCALE_PERCENT.standard).toBe(100);
    expect(FONT_SCALE_PERCENT.larger).toBe(112.5);
    expect(FONT_SCALE_PERCENT.large).toBe(125);
  });

  it("lists the three steps in ascending order", () => {
    expect(FONT_SCALE_OPTIONS).toEqual(["standard", "larger", "large"]);
  });

  it("recognizes valid scales and rejects everything else", () => {
    expect(isFontScale("standard")).toBe(true);
    expect(isFontScale("larger")).toBe(true);
    expect(isFontScale("large")).toBe(true);
    expect(isFontScale("huge")).toBe(false);
    expect(isFontScale(undefined)).toBe(false);
    expect(isFontScale(125)).toBe(false);
  });

  describe("applyFontScale", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("is a no-op without a DOM (SSR / plain Node test env)", () => {
      expect(typeof document).toBe("undefined");
      expect(() => applyFontScale("large")).not.toThrow();
    });

    describe("with a stubbed document", () => {
      let style: { fontSize: string };

      beforeEach(() => {
        style = { fontSize: "" };
        vi.stubGlobal("document", { documentElement: { style } });
      });

      it("sets the root font-size percentage for each step", () => {
        applyFontScale("standard");
        expect(style.fontSize).toBe("100%");
        applyFontScale("larger");
        expect(style.fontSize).toBe("112.5%");
        applyFontScale("large");
        expect(style.fontSize).toBe("125%");
      });
    });
  });
});
