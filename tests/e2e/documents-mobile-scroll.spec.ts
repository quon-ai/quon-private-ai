import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * Regression for the mobile "Dokumente Scrollbereich unten zu klein" bug (#8):
 * the document list used to be a SECOND, nested scroll container
 * (`flex-1 overflow-y-auto`) inside the page's own scroll container, so on a
 * short phone viewport it got almost no height and the last rows were trapped in
 * a cramped inner scroller. The fix makes the page a SINGLE scroll container
 * (outer scrolls; the list is a plain block).
 *
 * This asserts that invariant directly (cheap, no store fill needed): the outer
 * container scrolls, the inner list does NOT. It fails on the pre-fix code
 * (inner overflow-y: auto) and passes on the fix (inner overflow-y: visible).
 */
test("documents screen has a single scroll container on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, sharedCreds());
  await page.goto("/documents");

  const scroller = page.getByTestId("documents-scroll");
  const list = page.getByTestId("documents-list");
  await expect(scroller).toBeVisible();
  await expect(list).toBeVisible();

  const outerOverflow = await scroller.evaluate((el) => getComputedStyle(el).overflowY);
  const innerOverflow = await list.evaluate((el) => getComputedStyle(el).overflowY);

  expect(outerOverflow).toBe("auto"); // the page is the scroller
  expect(innerOverflow).toBe("visible"); // the list is NOT its own (nested) scroller
});
