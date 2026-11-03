import { test, expect } from "@playwright/test";

/**
 * The scrub-only demo (/demo): a visitor without an account pastes a text and
 * sees placeholders where the personal data was. No cookie, no login; the
 * backend of the suite runs with DEMO_SCRUB_ENABLED=true (playwright.config).
 * The button label follows the build's default language, so both are accepted.
 */
test.describe("scrub demo", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor without an account sees placeholders instead of personal data", async ({
    page,
  }) => {
    await page.goto("/demo");
    await page
      .getByRole("textbox")
      .fill(
        "Bitte schreib an jana.beispiel@example.org oder ruf +49 30 1234567 an. IBAN DE89 3704 0044 0532 0130 00.",
      );
    await page.getByRole("button", { name: /^(Schwärzen|Redact)$/ }).click();

    const result = page.getByTestId("demo-result");
    await expect(result).toContainText("[EMAIL_1]");
    await expect(result).toContainText("[IBAN_1]");
    await expect(result).not.toContainText("jana.beispiel@example.org");
    // The mapping shows the visitor what was replaced, and by which placeholder.
    const found = page.getByTestId("demo-found");
    await expect(found).toContainText("jana.beispiel@example.org");
    await expect(found).toContainText("[EMAIL_1]");
  });
});
