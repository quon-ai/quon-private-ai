import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * The composer controls row on a phone.
 *
 * Two ways this row breaks on a phone: the model label collapses to a blank
 * circle, or the Bot icon renders outside the pill border. Same cause both
 * times: when the model trigger is the row's only shrinkable flex item, every
 * pill added beside it (Web, reasoning effort) crushes it further, eventually
 * below its own icon width. The row scrolls instead of crushing; these tests
 * pin the two invariants at a Pixel's own viewport width.
 */

// 412 = a Pixel's viewport width. 320 = the tightest real
// device class - there the old layout always crushed the trigger, in any
// language, which is what makes it the fails-on-old width (at 412 the crush
// needed the German labels + the Kontext pill, which the harness account
// doesn't have).
for (const width of [412, 320]) {
  test.describe(`viewport ${width}px`, () => {
    test.use({ viewport: { width, height: 915 } });

    test(`the model chip keeps its icon inside its border`, async ({ page }) => {
      await login(page, sharedCreds());
      await page.goto("/chat");

      const picker = page.getByRole("combobox").first();
      await expect(picker).toBeVisible({ timeout: 30_000 });

      // The failure shape: the trigger shrinks below its content and the Bot
      // icon spills out of the rounded border. The icon's box must sit
      // fully inside the trigger's box (1px tolerance for rounding). Both
      // rects are read in one evaluate - the composer slides in on mount, and
      // two sequential boundingBox() calls can straddle animation frames
      // (WebKit flaked exactly that way).
      const boxes = await picker.evaluate((el) => {
        const svg = el.querySelector("svg");
        if (!svg) return null;
        const p = el.getBoundingClientRect();
        const i = svg.getBoundingClientRect();
        return {
          pill: { x: p.x, y: p.y, w: p.width, h: p.height },
          icon: { x: i.x, y: i.y, w: i.width, h: i.height },
        };
      });
      expect(boxes).not.toBeNull();
      const { pill, icon } = boxes!;
      expect(icon.x).toBeGreaterThanOrEqual(pill.x - 1);
      expect(icon.x + icon.w).toBeLessThanOrEqual(pill.x + pill.w + 1);
      expect(icon.y).toBeGreaterThanOrEqual(pill.y - 1);
      expect(icon.y + icon.h).toBeLessThanOrEqual(pill.y + pill.h + 1);

      // And the trigger itself must not be a crushed sliver: it needs room for
      // icon + chevron + padding at minimum.
      expect(pill.w).toBeGreaterThanOrEqual(40);
    });

    test(`every pill stays reachable: the row scrolls instead of crushing`, async ({ page }) => {
      await login(page, sharedCreds());
      await page.goto("/chat");

      const row = page.getByTestId("chat-controls-row");
      await expect(row).toBeVisible({ timeout: 30_000 });

      // No pill may be squeezed below its content (the crush failure mode):
      // for every control in the row, rendered width == content width.
      const crushed = await row.evaluate((el) => {
        const items = el.querySelectorAll("button, [role='combobox']");
        const bad: string[] = [];
        for (const it of items) {
          // scrollWidth > clientWidth means the control is clipped.
          if (it.scrollWidth > it.clientWidth + 1) {
            bad.push(`${(it.textContent ?? "?").trim() || it.tagName}`);
          }
        }
        return bad;
      });
      expect(crushed).toEqual([]);

      // If the pills genuinely don't fit the viewport, the row must be
      // scrollable to its end - the rightmost pill (reasoning effort) becomes
      // fully visible after scrolling, rather than being cut off forever.
      // POLLED, not measured once: WebKit applies the programmatic scroll
      // asynchronously (same frame-race class as the icon measurement above -
      // a single boundingBox() read raced it in CI).
      const effortPill = page.getByLabel(/weitere chat-optionen|more chat options/i);
      await expect(effortPill).toBeVisible();
      const viewport = page.viewportSize()!;
      await expect
        .poll(
          async () => {
            await row.evaluate((el) => {
              el.scrollLeft = el.scrollWidth;
            });
            const box = await effortPill.boundingBox();
            return box ? box.x + box.width : Number.POSITIVE_INFINITY;
          },
          { timeout: 10_000 },
        )
        .toBeLessThanOrEqual(viewport.width + 1);
    });
  });
}
