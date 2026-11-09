import { test, expect } from "@playwright/test";

import { freshEmail, login, registerAndVerify } from "./helpers/account";

test("register -> verify -> login, and the ZK session survives a reload", async ({ page }) => {
  const creds = { email: freshEmail("reg"), password: "Reg-Test-12345!" };

  await registerAndVerify(page, creds);
  await login(page, creds);
  await expect(page.getByText("Protection Level")).toBeVisible();

  // The Argon2id-derived master key lives in sessionStorage; a reload must keep us
  // unlocked (not bounce back to the sign-in screen).
  await page.reload();
  await expect(page.getByText("Protection Level")).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toHaveCount(0);
});
