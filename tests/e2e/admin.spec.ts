import { test, expect } from "@playwright/test";

import { adminCreds, freshEmail, login, registerAndVerify, type Creds } from "./helpers/account";

/**
 * Admin screen: global-setup registers a DEDICATED admin account first (the
 * first-account-becomes-admin bootstrap on the fresh throwaway DB) - worker
 * slot accounts are all plain users. adminCreds() is the only way in here.
 */

test("admin sees the Admin screen: user list, stats, invite create shows the code once", async ({
  page,
}) => {
  await login(page, adminCreds());

  // Role-gated nav entry exists for the admin account.
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible();

  // User table lists the shared account itself with the admin badge.
  const ownRow = page.locator("tr", { hasText: adminCreds().email });
  await expect(ownRow).toBeVisible();
  await expect(ownRow.getByText("Admin", { exact: true }).first()).toBeVisible();

  // Stats chips render.
  await expect(page.getByText(/Accounts:/)).toBeVisible();

  // Create an invite - the code is displayed exactly once, then the list shows
  // the invite as open without any code.
  // Unique note per run - the shared DB accumulates invites across retries.
  const note = `e2e invite ${Date.now()}`;
  await page.getByPlaceholder(/Note/).fill(note);
  await page.getByRole("button", { name: "Create invite" }).click();
  await expect(page.getByText(/copy now — shown only once/)).toBeVisible();
  // Appears in the invite list (as "<note> · open") AND in the audit detail.
  await expect(page.getByText(`${note} · open`)).toBeVisible();
  await expect(page.getByText("invite.create").first()).toBeVisible();
});

test("a non-admin account has no Admin nav entry and the screen denies", async ({ page }) => {
  const creds: Creds = { email: freshEmail("admin-plain"), password: "E2e-Admin-Pass-123!" };
  await registerAndVerify(page, creds);
  await login(page, creds);

  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);

  await page.goto("/admin");
  await expect(page.getByText("This area is for instance administrators.")).toBeVisible();
});

test("admin can permanently delete an account (confirm dialog, row disappears)", async ({
  page,
}) => {
  // A throwaway victim account, created via the DB-activation shortcut.
  const victim: Creds = { email: freshEmail("admin-delete-me"), password: "E2e-Del-Pass-123!" };
  await registerAndVerify(page, victim);

  await login(page, adminCreds());
  await page.getByRole("link", { name: "Admin" }).click();
  const row = page.locator("tr", { hasText: victim.email });
  await expect(row).toBeVisible();

  await row.getByRole("button").click();
  await page.getByRole("menuitem", { name: "Delete account…" }).click();
  await expect(page.getByText(/cannot be recovered/)).toBeVisible();
  await page.getByRole("button", { name: "Delete permanently" }).click();

  // Row gone after reload of the list; audit shows the deletion.
  await expect(page.locator("tr", { hasText: victim.email })).toHaveCount(0);
  await expect(page.getByText("user.delete").first()).toBeVisible();
});
