import { test, expect } from "@playwright/test";

import { freshEmail, login, registerAndVerify } from "./helpers/account";

// Regression for the cross-account local-data leak: a second account opened in the
// Same browser must never inherit the first account's cached chats/memory/docs.
test("a new account in the same browser sees none of the previous account's data", async ({
  page,
}) => {
  // Account A saves a private memory.
  const a = { email: freshEmail("iso-a"), password: "Iso-A-12345!" };
  const secret = `geheim-${Date.now()}`;
  await registerAndVerify(page, a);
  await login(page, a);
  await page.goto("/memory");
  await page.getByRole("button", { name: "Add Memory" }).click();
  await page.getByPlaceholder("What should QUON remember?").fill(secret);
  await page.getByRole("button", { name: "Save" }).click();
  // Wait for the modal to close before touching the page behind it: saving
  // embeds on-device and the first embed downloads the model (can take ~60-90s);
  // until it finishes the dialog stays open and aria-hides the sidebar (incl.
  // "Sign out"). Only once it's closed is the item actually in the list.
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(secret)).toBeVisible();

  // Log out via the sidebar (clears local stores + sync cursors).
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByPlaceholder("Email")).toBeVisible();

  // Account B, same browser context.
  const b = { email: freshEmail("iso-b"), password: "Iso-B-12345!" };
  await registerAndVerify(page, b);
  await login(page, b);

  // B must not see A's memory.
  await page.goto("/memory");
  await expect(page.getByText(secret)).toHaveCount(0);
});
