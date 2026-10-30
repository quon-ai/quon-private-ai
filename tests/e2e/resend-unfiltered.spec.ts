import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

// "Resend without filter" (RedactionDetail → ScreenChat.resendWithoutFilter, see
// src/lib/unfilteredResend.ts): a one-shot, per-message escape hatch for when the
// scrubber false-positives on casual text and mangles the question. Deliberately
// NOT a permanent allow-list — clicking it only bypasses detection for ONE resend
// of THIS message's original text, appended as a brand-new turn. We assert the
// full round trip: the first (real, unmocked /scrub) send redacts the PII on the
// wire, expanding the detail + confirming the resend then puts the CLEAR original
// text on the wire for the SECOND relay call, and the resent bubble is labeled
// distinctly ("Sent without filter") — never mistaken for "0 redacted" or the
// existing "Sent unprotected" (protection-level-None) chip.

test("resend without filter sends the clear original text and labels the bubble distinctly", async ({
  page,
}) => {
  const bodies: string[] = [];
  await page.route("**/chat/stream", async (route) => {
    bodies.push(route.request().postData() ?? "");
    const n = bodies.length;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: n === 1 ? "Erste Antwort." : "Zweite Antwort." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  // Unique per-run content so a serial shared-account run never collides with
  // another spec's messages/bubbles.
  const tag = Date.now();
  const email = `resend-${tag}@example.com`;
  const original = `Bitte an ${email} weiterleiten (${tag})`;

  await page.getByPlaceholder("Ask anything, keep your data personal").fill(original);
  await clickSend(page);

  // 1) The real (unmocked) scrubber redacts the email — bubble + wire both prove it.
  await expect(page.getByText("Erste Antwort.")).toBeVisible({ timeout: 30_000 });
  const redactedBubbleStatus = page.getByRole("button", { name: "1 item redacted" });
  await expect(redactedBubbleStatus).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain("[EMAIL_1]");
  expect(bodies[0]).not.toContain(email);

  // Sending minted a session id in the URL (?c=...) — remember it. Navigating to
  // bare "/chat" (no ?c=) always starts a FRESH chat, so returning to THIS chat
  // after visiting the dashboard must go back to this exact URL.
  const chatUrl = page.url();
  expect(chatUrl).toContain("/chat?c=");

  // Snapshot the dashboard's live "kept private" trust counter BEFORE the resend,
  // so we can assert it does not grow afterwards (nothing is redacted by an
  // unfiltered send). The shared e2e account accumulates this across the whole
  // suite, so we compare before/after rather than an absolute value.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Change" }).click();
  const trustLineBefore = await page
    .getByText(/personal items? kept private so far\./)
    .textContent();
  expect(trustLineBefore).toBeTruthy();

  await page.goto(chatUrl);

  // 2) Expand the redaction detail on that message and arm the resend action.
  await redactedBubbleStatus.click();
  const resendButton = page.getByRole("button", { name: "Resend without filter" });
  await expect(resendButton).toBeVisible();
  await resendButton.click();

  // Armed state: a plain, honest sentence — no scare language — plus an explicit
  // confirm. Nothing is sent yet (still only the first request recorded).
  await expect(
    page.getByText("Sends your original text — nothing will be redacted."),
  ).toBeVisible();
  const confirmButton = page.getByRole("button", { name: "Send unprotected" });
  await expect(confirmButton).toBeVisible();
  expect(bodies).toHaveLength(1);

  await confirmButton.click();

  // 3) The SECOND relay call's LAST turn (the resend) carries the CLEAR original
  // text with no placeholder. The EARLIER turns in the same payload legitimately
  // still contain "[EMAIL_1]" — prior history is never retroactively unscrubbed
  // (see toRelayHistory / relayHistory.ts) — so we assert on the last message
  // specifically, not the raw JSON string.
  await expect(page.getByText("Zweite Antwort.")).toBeVisible({ timeout: 30_000 });
  expect(bodies).toHaveLength(2);
  const secondPayload = JSON.parse(bodies[1]) as { messages: Array<{ content: string }> };
  const resentTurn = secondPayload.messages.at(-1)?.content;
  expect(resentTurn).toBe(original);
  expect(resentTurn).not.toContain("[EMAIL_1]");
  // The history's FIRST turn is untouched — still the placeholder, proving this
  // resend didn't retroactively unscrub the earlier (garbled) message.
  expect(secondPayload.messages[0]?.content).toContain("[EMAIL_1]");

  // 4) The new bubble is labeled distinctly — never "N items redacted" (that would
  // claim scrubbing happened) and never the existing "Sent unprotected" chip used
  // for protection-level None (that's a different, ongoing trust signal, not a
  // one-shot per-message choice).
  await expect(page.getByText("Sent without filter")).toBeVisible();
  await expect(page.getByRole("button", { name: "1 item redacted" })).toHaveCount(1); // only the FIRST bubble
  await expect(page.getByText("Sent unprotected")).toHaveCount(0);

  // 5) The trust counter must NOT have grown from the unfiltered resend.
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Change" }).click();
  const trustLineAfter = await page
    .getByText(/personal items? kept private so far\./)
    .textContent();
  expect(trustLineAfter).toBe(trustLineBefore);
});

// The resend action must not appear at all on a message with nothing redacted —
// there is nothing to fall back to, and offering it would be a confusing no-op.
test("a message with no redactions has no resend-without-filter action", async ({ page }) => {
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Ok." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  const tag = Date.now();
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill(`Was ist die Hauptstadt von Frankreich? (${tag})`);
  await clickSend(page);

  await expect(page.getByText("Ok.")).toBeVisible({ timeout: 30_000 });
  // "No personal data found" renders but is a plain, unclickable line (no detail
  // to expand) — so the resend action is unreachable, not merely hidden-by-toggle.
  await expect(page.getByText("No personal data found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend without filter" })).toHaveCount(0);
});
