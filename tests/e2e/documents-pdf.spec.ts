import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

// The regression test for the Safari/iOS bug: pdf.js uses ReadableStream async
// iteration, which WebKit lacks. Running this on the `webkit` project is what would
// have caught it. (See src/lib/polyfills.ts.)
test("PDF upload extracts + indexes without the Safari ReadableStream crash", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));

  await login(page, sharedCreds());
  await page.goto("/documents");

  await page.setInputFiles('input[type="file"]', "tests/e2e/fixtures/sample.pdf");

  // The document shows up (extraction kicked off). `.first()` because a retry
  // re-pulls the sample.pdf its earlier attempt already synced to the shared
  // account, so more than one entry can be present — the crash guards below are
  // count-independent and are what this test actually asserts.
  await expect(page.getByText("sample.pdf").first()).toBeVisible({ timeout: 90_000 });

  // …and the extraction error the Safari bug produced never appears.
  await expect(page.getByText(/Couldn't read this PDF/i)).toHaveCount(0);
  expect(pageErrors.join("\n")).not.toMatch(/readableStream|undefined is not a function/i);
});
