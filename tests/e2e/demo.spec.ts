import { test, expect } from "@playwright/test";

/**
 * The scrub-only demo (/demo): a visitor without an account pastes a text and
 * sees placeholders where the personal data was. No cookie, no login; the
 * backend of the suite runs with DEMO_SCRUB_ENABLED=true and a contact URL
 * and address (playwright.config). The page is English by default whatever
 * the build's language, with its own switch to German.
 */
test.describe("scrub demo", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a visitor without an account sees placeholders instead of personal data", async ({
    page,
  }) => {
    await page.goto("/demo");
    // English by default, whatever the instance's language.
    await expect(page.getByRole("button", { name: "Redact", exact: true })).toBeVisible();
    await expect(page.getByTestId("demo-how").getByRole("listitem")).toHaveCount(4);

    await page
      .getByRole("textbox")
      .fill(
        "Bitte schreib an jana.beispiel@example.org oder ruf +49 30 1234567 an. IBAN DE89 3704 0044 0532 0130 00.",
      );
    await page.getByRole("button", { name: "Redact", exact: true }).click();

    const result = page.getByTestId("demo-result");
    await expect(result).toContainText("[EMAIL_1]");
    await expect(result).toContainText("[IBAN_1]");
    await expect(result).not.toContainText("jana.beispiel@example.org");
    // The mapping shows the visitor what was replaced, and by which placeholder.
    const found = page.getByTestId("demo-found");
    await expect(found).toContainText("jana.beispiel@example.org");
    await expect(found).toContainText("[EMAIL_1]");

    // Interested visitors go to the operator's contact, not to the sign-in.
    const cta = page.getByTestId("demo-cta");
    await expect(cta.getByRole("link", { name: "Get early access" })).toHaveAttribute(
      "href",
      "https://example.org/waitlist",
    );
    await expect(cta.getByRole("link", { name: /Write to hello@example\.org/ })).toHaveAttribute(
      "href",
      /^mailto:hello@example\.org/,
    );
  });

  test("the page switches to German without touching the app's language", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: "Deutsch", exact: true }).click();
    await expect(page.getByRole("button", { name: "Schwärzen", exact: true })).toBeVisible();
    await expect(page.getByText("So funktioniert es")).toBeVisible();
    // The switch is page-local: no quon_lang cookie was written.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "quon_lang")).toBeUndefined();
  });
});
