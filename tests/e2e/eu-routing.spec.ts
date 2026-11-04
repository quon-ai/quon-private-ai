import { test, expect } from "@playwright/test";

import { login, openChat, sharedCreds } from "./helpers/account";

/**
 * Strict EU routing: the backend reports region "eu" and no web search. The
 * chat must not offer the Web toggle, settings must say so, and the trust page
 * must name it. Hermetic — the settings read is rewritten (fetches only; the
 * app's own /settings page passes through).
 */
async function mockEu(page: import("@playwright/test").Page) {
  // The chat and the trust page read the region from the health poll; the
  // settings card from the settings read. Only API fetches are rewritten —
  // the app's own /settings PAGE passes through.
  for (const pattern of ["**/health", "**/settings"]) {
    await page.route(pattern, async (route) => {
      const req = route.request();
      if (req.method() !== "GET" || !["fetch", "xhr"].includes(req.resourceType())) {
        return route.fallback();
      }
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({
        response: res,
        json: { ...body, region: "eu", web_search_available: false },
      });
    });
  }
}

test("in EU routing the chat offers no Web toggle, settings and trust say EU", async ({ page }) => {
  await mockEu(page);
  await login(page, sharedCreds());
  await openChat(page);
  await expect(page.getByRole("button", { name: "Filter" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Web" })).toHaveCount(0);

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Providers" }).click();
  await expect(page.getByTestId("eu-routing-badge")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/processed in the EU only/)).toBeVisible();

  await page.goto("/trust");
  await expect(page.getByTestId("trust-eu-routing")).toBeVisible({ timeout: 30_000 });
});

test("in global routing the Web toggle is there and nothing says EU", async ({ page }) => {
  await login(page, sharedCreds());
  await openChat(page);
  await expect(page.getByRole("button", { name: "Web" })).toBeVisible({ timeout: 30_000 });
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Providers" }).click();
  await expect(page.getByRole("tab", { name: "Providers" })).toHaveAttribute(
    "data-state",
    "active",
  );
  await expect(page.getByTestId("eu-routing-badge")).toHaveCount(0);
});
