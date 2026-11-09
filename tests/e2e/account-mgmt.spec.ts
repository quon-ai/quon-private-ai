import { test, expect, type Page } from "@playwright/test";

import { freshEmail, login, registerAndVerify } from "./helpers/account";

// Account self-service (Settings Account). Each test uses its own fresh account
// so it can safely rotate/delete credentials without disturbing the shared one.

async function openAccountTab(page: Page): Promise<void> {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Account" }).click();
}

test("change password: the new password unlocks, the old one is rejected", async ({ page }) => {
  // Multiple real Argon2id derivations (register, login, re-wrap, two re-logins) -
  // legitimately slow; give it headroom so it doesn't flake on the shared stack.
  test.slow();
  const creds = { email: freshEmail("pw"), password: "Old-Password-123!" };
  const NEWPW = "New-Password-456!";

  await registerAndVerify(page, creds);
  await login(page, creds);

  await openAccountTab(page);
  await page.getByLabel("Current password", { exact: true }).fill(creds.password);
  await page.getByLabel("New password", { exact: true }).fill(NEWPW);
  await page.getByLabel("Confirm new password", { exact: true }).fill(NEWPW);
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed.")).toBeVisible({ timeout: 30_000 });

  // Drop the session cookie so the next load is fully signed out (independent of
  // the Sign Out button), then reload to the sign-in screen.
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByPlaceholder("Email")).toBeVisible({ timeout: 30_000 });

  // OLD password is rejected - the verifier was rotated, so login never reaches
  // the app.
  await page.getByPlaceholder("Email").fill(creds.email);
  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Protection Level")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByPlaceholder("Email")).toBeVisible();

  // New password unwraps the UNCHANGED Master Key -> the app unlocks. (If the key
  // had been altered, unlockMasterKey would throw and login would fail here.)
  await page.getByPlaceholder("Password", { exact: true }).fill(NEWPW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 60_000 });
});

test("delete account: returns to sign-in and the old credentials stop working", async ({
  page,
}) => {
  const creds = { email: freshEmail("del"), password: "Delete-Me-1234!" };

  await registerAndVerify(page, creds);
  await login(page, creds);

  await openAccountTab(page);
  await page.getByLabel("Password", { exact: true }).fill(creds.password);
  await page.getByLabel(/Type .*DELETE.* to confirm/).fill("DELETE");
  await page.getByRole("button", { name: "Delete my account" }).click();

  // Back on the sign-in screen (auth status flipped to anonymous).
  await expect(page.getByPlaceholder("Email")).toBeVisible({ timeout: 30_000 });

  // The account is gone: its credentials no longer reach the app.
  await page.getByPlaceholder("Email").fill(creds.email);
  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Protection Level")).toHaveCount(0, { timeout: 8000 });
  await expect(page.getByPlaceholder("Email")).toBeVisible();
});
