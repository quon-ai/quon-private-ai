import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * On iPhones a screen that pre-warms the on-device embedder on mount gets the
 * page killed within seconds of boot: a 113 MB model, a 16 MB tokenizer and a
 * ~23 MB WASM runtime WebKit then compiles is the footprint that gets a WebKit
 * page jetsam'd on a 4 GB phone. The policy (src/lib/deviceClass.ts) says: on
 * iOS, nothing loads the embedder ahead of need.
 *
 * Asserted at the network boundary: with an iPhone user agent, opening the
 * screens that would otherwise warm the model must produce no model/runtime request
 * at all - and the diagnostics log must say the skip happened, so a future
 * report shows the policy in force. Desktop behaviour is untouched (the
 * control case at the end).
 */
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1";

const MODEL_REQUEST = /\.onnx(\?|$)|ort-wasm|huggingface\.co|\/e2e-models\//;

test.describe("iPhone: the embedder never loads ahead of need", () => {
  test.use({ userAgent: IPHONE_UA });

  test("opening Documents, Memory and Chat requests no model, and the log says why", async ({
    page,
  }) => {
    const modelRequests: string[] = [];
    page.on("request", (r) => {
      if (MODEL_REQUEST.test(r.url())) modelRequests.push(r.url());
    });

    await login(page, sharedCreds());
    for (const path of ["/documents", "/memory", "/chat"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({
        timeout: 30_000,
      });
      // Give a pre-warm every chance to fire before we look.
      await page.waitForTimeout(1_500);
    }
    expect(modelRequests).toEqual([]);

    const diag = await page.evaluate(() => localStorage.getItem("quon_diag_v1") ?? "");
    expect(diag).toContain("prewarm skipped (policy=constrained)");
    expect(diag).toContain("boot summary:");
  });
});

/**
 * Desktop control: the boot summary is a CONSTRAINED-only diagnostic
 * (bootSummary.ts) - a normal session must not add it to the diag log, the
 * same way it never pre-warmed anything before this feature existed.
 *
 * Only that is asserted here. Whether an empty diag log makes the feedback
 * dialog say "nothing to report" is feedback.spec.ts's own contract, already
 * covered there - repeating it here would just duplicate that assertion
 * (and its known sensitivity to a real, incidental `visibilitychange` event
 * Playwright/Chromium can fire independent of anything the app does).
 */
test("desktop control: a normal boot does not log a boot summary", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/documents");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 30_000 });
  // Give the (skipped) boot summary the same window the iPhone case gets.
  await page.waitForTimeout(1_500);
  const diag = await page.evaluate(() => localStorage.getItem("quon_diag_v1") ?? "");
  expect(diag).not.toContain("boot summary:");
});
