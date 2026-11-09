import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

// The composer model picker shows friendly names (modelDisplay) instead of the
// raw provider slugs the backend catalog labels models with. The exact slug is
// kept only in the option's title tooltip, so it never appears as visible text.
// The model catalog is global, so the shared account is fine here.

test("model picker shows friendly names, not raw slugs", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/chat");

  // The one Select/combobox on the chat screen is the model picker (reasoning uses
  // a dropdown menu). Its trigger already shows a friendly value, never a slug.
  const picker = page.getByRole("combobox").first();
  await expect(picker).toBeVisible({ timeout: 30_000 });
  await expect(picker).not.toContainText("/"); // no "openrouter/..." / "anthropic/..."

  await picker.click();

  // Friendly names render as options once the backend catalog has loaded
  // (default catalog: Sonnet first, plus Opus/Gemini Flash/Mistral/GPT/Fusion).
  await expect(page.getByRole("option", { name: /^Claude Sonnet/ }).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("option", { name: /^Gemini Flash/ }).first()).toBeVisible();

  // The raw provider slug is never shown as visible text (only in the tooltip).
  await expect(page.getByText("~anthropic/claude-sonnet-latest", { exact: true })).toHaveCount(0);
  await expect(page.getByText("mistralai/mistral-large", { exact: true })).toHaveCount(0);
});
