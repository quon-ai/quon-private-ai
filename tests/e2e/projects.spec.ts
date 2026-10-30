import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

test("create a project and it appears in the list", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/projects");

  const name = `Steuer ${Date.now()}`;
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(name);
  await page.getByRole("button", { name: "Create" }).click();

  // Create navigates to the project's detail; the list must then show it too.
  // (The name also appears in the sidebar's project groups, hence .first().)
  await page.goto("/projects");
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
});
