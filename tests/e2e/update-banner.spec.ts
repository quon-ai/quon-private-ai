import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * The banner that closes the gap every deploy leaves: a running instance keeps
 * the JavaScript it loaded, and an installed PWA is never reloaded just because
 * we deployed — so the user keeps testing the old build. That once produced a
 * bug report for a feature that was already live.
 *
 * Hermetic: /version.json is route-mocked to report a build that isn't the one
 * running. It must never reload on its own (a surprise reload would discard a
 * half-typed message) — the user gets the choice.
 */
test("a newer deployed build offers a reload, and only reloads when asked", async ({ page }) => {
  await page.route("**/version.json", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ build: "some-other-build-id" }),
    }),
  );

  await login(page, sharedCreds());

  const banner = page.getByText("A new version of QUON is available.");
  await expect(banner).toBeVisible({ timeout: 30_000 });

  // Nothing reloaded by itself: the page we are on is still the page we were on.
  const reloads: string[] = [];
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) reloads.push(f.url());
  });
  await page.waitForTimeout(1500);
  expect(reloads).toEqual([]);

  // Asking for it reloads.
  await page.getByRole("button", { name: "Reload" }).click();
  await page.waitForLoadState("load");
  await expect(page.getByText("A new version of QUON is available.")).toBeVisible({
    timeout: 30_000,
  });
});

/** The current build must NOT nag — a permanent bar would train the user to
 *  ignore it, which defeats the entire point. */
test("a matching deployed build shows no banner", async ({ page }) => {
  await login(page, sharedCreds());
  await page.waitForTimeout(1500);
  await expect(page.getByText("A new version of QUON is available.")).toHaveCount(0);
});
