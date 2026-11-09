import { test, expect, type Page } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * Not a regression test - an ASSET EXPORT. The trust page's data-flow diagram is
 * animated DOM + CSS (`qt-*`), so the only faithful way to reuse it outside the
 * app (beta invite, docs, slides) is to render the real thing and capture it:
 *
 *   QUON_EXPORT_ASSETS=1 npx playwright test --project=chromium \
 *     tests/e2e/trust-graphic.spec.ts
 *
 * Skipped otherwise - it writes into the repo, and the gate fails when a run
 * dirties the working tree.
 *
 * Two things a naive screenshot gets wrong, both fixed below:
 *  - LANGUAGE. The suite pins `quon_lang=en` (playwright.config) so ~300
 *    selectors keep working. A German invite needs the German render.
 *  - TIMING. Both packet trails loop 3.4s, and the `.qt-b` copies run 1.7s
 *    behind. Caught at a bad instant the packets stack into an unreadable
 *    clump. So the animation is PAUSED at a chosen phase rather than waited on:
 *    at 30% the amber packet sits ~36% along, the green ones at ~61% and ~80%,
 *    which is the frame that reads as "real data in, placeholders out".
 */
const LOOP_S = 3.4;
const PHASE = 0.3; // fraction of the loop to freeze at
const FREEZE = `
  .qt-ride-a, .qt-ride-b {
    animation-play-state: paused !important;
    animation-delay: -${(PHASE * LOOP_S).toFixed(2)}s !important;
  }
  .qt-ride-a.qt-b, .qt-ride-b.qt-b {
    animation-delay: -${((PHASE + 0.5) * LOOP_S).toFixed(2)}s !important;
  }
`;

test.skip(!process.env.QUON_EXPORT_ASSETS, "asset export — set QUON_EXPORT_ASSETS=1");

async function shoot(page: Page, lang: "de" | "en") {
  // Switch with the app's own control, after login. Setting the cookie is not
  // enough and it is not a bug: authStore adopts the ACCOUNT's stored
  // `ui_language` on /me (authStore.ts), and the shared E2E account is English,
  // so it overrides anything set beforehand. LanguageSelect switches live, no
  // reload - and `syncAccount` in Settings persists it for the session.
  await page.goto("/settings");
  // Settings opens on the detection tab; the selector lives under Account.
  await page.getByRole("tab", { name: /Account|Konto/ }).click();
  const group = page.getByRole("group", { name: /Language|Sprache/ });
  await expect(group).toBeVisible({ timeout: 30_000 });
  await group
    .getByRole("button", { name: lang === "de" ? /German|Deutsch/ : /English|Englisch/ })
    .click();

  await page.goto("/trust");
  const flow = page.locator(".qt-flow");
  await expect(flow).toBeVisible({ timeout: 30_000 });
  await page.addStyleTag({ content: FREEZE });

  const suffix = lang === "de" ? "" : "-en";
  await flow.screenshot({ path: `docs/assets/trust-dataflow${suffix}.png` });

  // A wider crop keeping the page background - an element screenshot's hard
  // edge looks pasted on in an e-mail header.
  const box = (await flow.boundingBox())!;
  await page.screenshot({
    path: `docs/assets/trust-dataflow${suffix}-wide.png`,
    clip: {
      x: Math.max(0, box.x - 28),
      y: Math.max(0, box.y - 28),
      width: box.width + 56,
      height: box.height + 56,
    },
  });
}

test("export the trust data-flow diagram (de + en)", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await login(page, sharedCreds());
  await shoot(page, "de");
  await shoot(page, "en");
});
