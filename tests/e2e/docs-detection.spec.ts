import { test, expect } from "@playwright/test";

/**
 * The public "how we test the filter" page (/docs/detection): the end-user
 * companion to /demo. No cookie, no login. English by default with its own
 * German switch, and the demo page hands its chosen language over via ?lang,
 * so a German reader never lands on an English page mid-flow.
 */
test.describe("detection docs page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor reads the four test kinds, in both languages", async ({ page }) => {
    await page.goto("/docs/detection");
    await expect(
      page.getByRole("heading", { name: "How we test the privacy filter" }),
    ).toBeVisible();
    // The four pillars and the honest-limits section are all on the page.
    await expect(page.getByRole("heading", { name: "Every mistake becomes a test" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What the filter cannot promise" }),
    ).toBeVisible();

    // The local switch translates in place, without touching any app state.
    await page.getByRole("button", { name: "Deutsch" }).click();
    await expect(
      page.getByRole("heading", { name: "So testen wir den Privatsphäre-Filter" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Jeder Fehler wird zum Test" })).toBeVisible();
  });

  test("the demo page links here and hands its language over", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Deutsch" }).click();
    await page.getByRole("link", { name: "So testen wir den Filter" }).click();
    await expect(page).toHaveURL(/\/docs\/detection\?lang=de/);
    // Arrives already in German — the hand-over, not the default.
    await expect(
      page.getByRole("heading", { name: "So testen wir den Privatsphäre-Filter" }),
    ).toBeVisible();
  });
});
