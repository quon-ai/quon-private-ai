import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

// Timeouts here are 60s, not 30s, and that is MEASURED, not generous: on the
// CI runner (the mini PC) these attach flows take 27-28s when the box is
// healthy - the green 89b8cab run shows exactly that, with this spec failing at
// 36s and passing on retry at 8.6s. A 30s ceiling over a 28s baseline is a coin
// flip that reads as a regression; three deploy rounds were stalled by it.
// Locally the same flows take 9-16s, so the wide ceiling costs nothing there.
//
// Regression for the "0 redacted" bug: a PDF attachment whose values were scrubbed
// must be COUNTED in the redaction panel, not shown as 0.
test("an attached document's redactions are counted, not shown as 0", async ({ page }) => {
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Alles klar." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  // Attach the sample PDF (contains an email) plus a no-PII question.
  await page.setInputFiles('input[type="file"]', "tests/e2e/fixtures/sample.pdf");
  await expect(page.getByText("sample.pdf")).toBeVisible({ timeout: 60_000 });
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Was steht da drin?");
  await clickSend(page);

  // The panel counts the attachment's redactions - >=1, not the buggy 0.
  // The bubble's redaction summary counts the attachment's redactions - >=1, not
  // the buggy 0. (The count moved onto the message bubble; it's no longer a
  // separate "Redacted N" bar.)
  await expect(page.getByText(/[1-9]\d* items? redacted/)).toBeVisible({
    timeout: 60_000,
  });
});
