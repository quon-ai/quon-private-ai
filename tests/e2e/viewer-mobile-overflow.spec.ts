import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * Regression: the document viewer must not overflow a mobile viewport. A long
 * filename used to blow the DialogHeader ~558px past the screen (its min-width
 * defaulted to auto as a grid child, so the non-wrapping title couldn't shrink
 * and the title was clipped off-screen — the reported bug). The fix is `min-w-0`
 * down the header chain so the title truncates instead. A wide table inside the
 * body may still scroll horizontally — that's expected — so the assertion is
 * scoped to the HEADER/title, which must stay within the viewport.
 */
test("document viewer keeps a long title within a mobile viewport", async ({ page }, testInfo) => {
  test.slow();
  await page.setViewportSize({ width: 390, height: 800 });
  await login(page, sharedCreds());
  await page.goto("/documents");

  // A deliberately long, non-wrapping filename (the trigger) + a wide table body.
  const fname = `Zusammenfassung-Berufsunfaehigkeitsversicherungen-BU-Gesamtuebersicht-${testInfo.project.name}-${Date.now()}.html`;
  const html = `<h3>Gesamtübersicht</h3><table>
<tr><th>Vertrag</th><th>Anbieter</th><th>Monatsrente</th><th>Wert bis</th><th>Nach Überschuss</th></tr>
<tr><td>Alte Leipziger (Schicht 1, kombiniert)</td><td>Alte Leipziger</td><td>2.400,00 EUR</td><td>31.07.2056</td><td>93,60 EUR</td></tr>
</table><p>Fazit: zweigleisige Absicherung.</p>`;
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/html",
    buffer: Buffer.from(html),
  });

  const docRow = page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) });
  await expect(docRow).toBeVisible({ timeout: 120_000 });
  await docRow.click();

  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();

  // The title (the truncating filename span) must not extend past the viewport.
  const overflow = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]') as HTMLElement;
    const title = dlg.querySelector(".truncate") as HTMLElement;
    return {
      titleOverflow: Math.round(title.getBoundingClientRect().right - window.innerWidth),
      bodyHorizScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  // ≤ 2px tolerance for sub-pixel rounding. On the old code this was ~558.
  expect(overflow.titleOverflow).toBeLessThanOrEqual(2);
  // The page itself must never gain a horizontal scrollbar.
  expect(overflow.bodyHorizScroll).toBeLessThanOrEqual(0);
});
