import { test, expect } from "@playwright/test";

import { login, purgeAccountBlobs, sharedCreds } from "./helpers/account";

/**
 * Data portability: memories export to a Markdown file on the device. The
 * download is built entirely on-device from decrypted items (nothing leaves the
 * browser); we assert the browser download fires with the expected file.
 */
test("memories can be exported to a Markdown file", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/memory");

  // Ensure there is at least one memory to export (idempotent-ish: unique text).
  const fact = `Export-Test ${Date.now()}`;
  await page.getByRole("button", { name: "Add Memory" }).click();
  await page.getByPlaceholder("What should QUON remember?").fill(fact);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(fact)).toBeVisible({ timeout: 60_000 });

  // Export -> a real browser download named quon-erinnerungen.md.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("quon-erinnerungen.md");

  // CLEAN UP: remove the created memory. Shared-account residue makes every
  // later chat-send spec run retrieval (embedder init inside the send) - the
  // class that made the webkit pass time out (it inherits chromium's leftovers).
  await page
    .locator("div.rounded-xl")
    .filter({ hasText: fact })
    .getByRole("button", { name: "Delete memory" })
    .first()
    .click();
  await expect(page.getByText(fact)).toHaveCount(0);
  purgeAccountBlobs("memory", sharedCreds().email);
});
