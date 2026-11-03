import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test, expect } from "@playwright/test";

/**
 * Language: a visitor without a cookie sees the build's default language
 * (DEFAULT_LANG in src/lib/features.ts: German here, English in the public
 * build), and the other language is a live, no-reload switch. The rest of the
 * suite pins English via the quon_lang cookie (playwright.config.ts) so its
 * English selectors stay valid; here we DROP that cookie to see the real
 * default, and exercise the switch on the public auth screen (no account
 * needed, so no dependency on the shared account's stored language).
 *
 * The default is read from the source file rather than imported: features.ts
 * pulls in icon components, and a spec must not load app code into Node. The
 * public build's first CI run failed on exactly this spec (2026-11-03) because
 * it had the German default hard-coded.
 */
const DEFAULT_LANG = (/DEFAULT_LANG: Lang = "(de|en)"/.exec(
  readFileSync(join(process.cwd(), "src/lib/features.ts"), "utf8"),
)?.[1] ?? "de") as "de" | "en";

// Accessible names on the auth screen, per UI language. Language options are
// labelled in the CURRENT language ("Englisch" while German, "German" while
// English). The register form has no toggle back, so "Konto erstellen" is
// unambiguous once the form is open.
const COPY = {
  de: {
    signIn: "Anmelden",
    openRegister: "Konto erstellen",
    otherLang: "Englisch",
    submitAfterSwitch: "Create account",
    ownLangAfterSwitch: "German",
  },
  en: {
    signIn: "Sign in",
    openRegister: "Create an account",
    otherLang: "German",
    submitAfterSwitch: "Konto erstellen",
    ownLangAfterSwitch: "Englisch",
  },
}[DEFAULT_LANG];

test.describe("UI language", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(`defaults to ${DEFAULT_LANG === "de" ? "German" : "English"}, and the register-form switch flips the language live`, async ({
    page,
  }) => {
    await page.goto("/");

    // The default language: the sign-in submit button carries its label.
    await expect(page.getByRole("button", { name: COPY.signIn, exact: true })).toBeVisible();

    // Open the register form; it carries the language switch.
    await page.getByRole("button", { name: COPY.openRegister, exact: true }).click();
    // The other language is offered, labelled in the current language.
    const otherLang = page.getByRole("button", { name: COPY.otherLang, exact: true });
    await expect(otherLang).toBeVisible();

    // Switch, live, no reload: the submit button changes language ...
    await otherLang.click();
    await expect(
      page.getByRole("button", { name: COPY.submitAfterSwitch, exact: true }),
    ).toBeVisible();
    // ... and so do the language options themselves.
    await expect(
      page.getByRole("button", { name: COPY.ownLangAfterSwitch, exact: true }),
    ).toBeVisible();
  });
});
