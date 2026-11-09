import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

test("PII never leaves the device in clear; the answer re-hydrates locally", async ({ page }) => {
  // Mock the LLM relay so the test is deterministic and burns no credits. We also
  // capture the OUTGOING body to prove the scrub happened at the network boundary.
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    // Echo the EMAIL placeholder back so client-side re-hydration is observable.
    const sse =
      `data: ${JSON.stringify({ delta: "Klar, ich schreibe an [EMAIL_1]." })}\n\n` +
      `data: ${JSON.stringify({ done: true })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sse,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Schreib eine Mail an kontakt@example.com");
  await clickSend(page);

  // Wait for the re-hydrated answer - that proves the full flow ran: scrub ->
  // (mocked) relay -> local re-hydration of [EMAIL_1] back to the real address.
  await expect(page.getByText("Klar, ich schreibe an kontakt@example.com.")).toBeVisible({
    timeout: 20_000,
  });

  // The user bubble flags that the email was redacted.
  await expect(page.getByText(/items? redacted/)).toBeVisible();

  // The guarantee: the real address never went over the wire - only the placeholder.
  expect(outgoing).toContain("[EMAIL_1]");
  expect(outgoing).not.toContain("kontakt@example.com");
  // Web search rides along by default (agentic server tool - the model
  // decides when to actually search; only the scrubbed text is ever used).
  expect(outgoing).toContain('"web_search":true');
});
