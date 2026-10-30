import { test, expect } from "@playwright/test";

/**
 * Language: German is the default; English is a live, no-reload switch. The rest
 * of the suite pins English via the quon_lang cookie (playwright.config.ts) so
 * its English selectors stay valid — here we DROP that cookie to see the real
 * default, and exercise the switch on the public auth screen (no account needed,
 * so no dependency on the shared account's stored language).
 */
test.describe("UI language", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("defaults to German, and the register-form switch flips to English live", async ({
    page,
  }) => {
    await page.goto("/");

    // Default German: the sign-in submit button reads "Anmelden".
    await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();

    // Open the register form (German toggle) — it carries the language switch.
    await page.getByRole("button", { name: "Konto erstellen" }).click();
    // The German option is active; the English option is offered.
    const englishOption = page.getByRole("button", { name: "Englisch", exact: true });
    await expect(englishOption).toBeVisible();

    // Switch to English — live, no reload: the submit button becomes "Create account".
    await englishOption.click();
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    // …and the language options are now labelled in English.
    await expect(page.getByRole("button", { name: "German", exact: true })).toBeVisible();
  });
});
