import { test, expect, type Page } from "@playwright/test";

import { login, openChat, sharedCreds } from "./helpers/account";

// Included-AI-budget UI (GET /account/usage -> ScreenChat hint + Settings UsageCard).
// The throwaway stack has no provisioning, so we mock /account/usage directly.

async function mockUsage(page: Page, body: Record<string, unknown>) {
  await page.route("**/account/usage", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  });
}

test("provisioned near-limit: chat hint + Settings card show; not-provisioned hides both", async ({
  page,
}) => {
  // 4.2 / 5 = 0.84 -> over the 0.8 hint threshold -> "~84% used".
  await mockUsage(page, {
    provisioned: true,
    usage_usd: 4.2,
    limit_usd: 5,
    limit_remaining_usd: 0.8,
    disabled: false,
  });

  await login(page, sharedCreds());
  await openChat(page);

  // Chat composer hint appears above the input.
  const hint = page.getByText(/included AI budget is ~84% used/);
  await expect(hint).toBeVisible({ timeout: 30_000 });

  // Dismiss hides it (persists in sessionStorage for the rest of this context).
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(hint).toHaveCount(0);

  // Settings Providers shows the "Included AI budget" card with the exact figures.
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Providers" }).click();
  await expect(page.getByText("Included AI budget")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("$4.20 of $5.00 used")).toBeVisible();

  // Flip to not-provisioned (self-host / BYOK). Clear the sessionStorage dismissal
  // so the chat hint's ABSENCE proves the provisioned:false path, not the dismissal.
  await mockUsage(page, {
    provisioned: false,
    usage_usd: null,
    limit_usd: null,
    limit_remaining_usd: null,
    disabled: false,
  });
  await page.evaluate(() => sessionStorage.removeItem("quon-budget-hint-dismissed"));

  await page.goto("/settings");
  await page.getByRole("tab", { name: "Providers" }).click();
  // Give the card's async fetch a beat, then assert it never renders.
  await expect(page.getByText("Reasoning effort").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Included AI budget")).toHaveCount(0);

  await openChat(page);
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/included AI budget is ~/)).toHaveCount(0);
});
