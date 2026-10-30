import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

// Retry-after-error (ScreenChat.retryAfterError): a provider error renders an error
// bubble with a Retry button that replays the SCRUBBED history (no re-scrub). We
// fail the first /chat/stream (HTTP 500), then let the retry succeed.
test("a provider error shows a Retry button; retrying succeeds and clears the error", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/chat/stream", async (route) => {
    calls += 1;
    if (calls === 1) {
      // First send fails hard — chatStream throws on !res.ok → error bubble.
      await route.fulfill({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "boom" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "ok" })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  await page.getByPlaceholder("Ask anything, keep your data personal").fill("bitte antworten");
  await clickSend(page);

  // Error bubble + its Retry affordance appear; the retry re-uses the mock (now armed
  // to succeed).
  const retry = page.getByRole("button", { name: "Retry" });
  await expect(page.getByText(/Model provider error/)).toBeVisible({ timeout: 30_000 });
  await expect(retry).toBeVisible();

  await retry.click();

  // The success reply renders and the error bubble is gone.
  await expect(page.locator("main").getByText("ok").last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Model provider error/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
});
