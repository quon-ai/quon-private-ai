import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

// Fail closed: if the scrubber is unreachable the chat must block
// sending and preserve the input - never forward unscrubbed text. This locks that
// invariant end-to-end: with /scrub failing, no /chat/stream request may go out,
// an error is surfaced, and the typed message stays in the composer.
test("scrubber unreachable -> send is blocked, input preserved, nothing forwarded", async ({
  page,
}) => {
  // Fail the scrub at the network boundary (as if the scrubber were down).
  await page.route("**/scrub", (route) => route.abort());

  // Spy: any hit to the relay is a fail-closed violation (unscrubbed text leaving).
  let relayHits = 0;
  await page.route("**/chat/stream", async (route) => {
    relayHits += 1;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  const secret = "Schreib eine Mail an kontakt@example.com";
  await page.getByPlaceholder("Ask anything, keep your data personal").fill(secret);
  await clickSend(page);

  // Fail-closed error is surfaced to the user (hosted-user wording, no "start
  // the scrubber" jargon; see ScreenChat.tsx's scrub catch).
  await expect(page.getByText(/privacy filter can.t be reached/i)).toBeVisible({
    timeout: 30_000,
  });

  // The message stays on the device (composer keeps the exact text - do not type,
  // typing clears the error state).
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toHaveValue(secret);

  // The guarantee: nothing was forwarded to the relay.
  expect(relayHits).toBe(0);
});

/**
 * The same guarantee for an ATTACHMENT. A send can involve up to four
 * independent /scrub calls (context, project instruction, attachment, message)
 * which go out as one parallel wave - so "the attachment couldn't be
 * scrubbed" is not a plain try/catch around a single await, but a
 * per-source decision on a settled result. Getting that wrong would send the
 * message and silently drop the document the user attached, or worse. This
 * pins the two things that must hold: nothing reaches the relay, and the
 * attachment is still staged so the user can retry.
 *
 * The message's own scrub is mocked to SUCCEED, so only the attachment's
 * failure can cause the abort - otherwise the test would pass for the wrong
 * reason (i.e. the case above).
 */
test("attachment scrub fails -> nothing sent, the attachment stays staged", async ({ page }) => {
  test.slow();

  const attachmentText = "Vertragspartnerin ist Anna Müller, IBAN DE02120300000000202051.";

  // Route by request BODY: the attachment's text fails, everything else scrubs
  // normally. `scrubLarge` may split a big attachment, so match on content.
  await page.route("**/scrub", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("Vertragspartnerin")) {
      await route.abort();
      return;
    }
    await route.continue();
  });

  let relayHits = 0;
  await page.route("**/chat/stream", async (route) => {
    relayHits += 1;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  const fname = `fail-closed-${Date.now()}.txt`;
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(attachmentText),
  });
  await expect(page.getByText(fname)).toBeVisible({ timeout: 30_000 });

  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Fasse das zusammen");
  await clickSend(page);

  // Honest, actionable error - not a silent drop.
  await expect(page.getByText(/couldn.t remove personal data from the attachment/i)).toBeVisible({
    timeout: 30_000,
  });

  // The guarantee: the relay never saw this send at all.
  expect(relayHits).toBe(0);
  // And the work isn't lost: attachment still staged, message still typed.
  await expect(page.getByRole("button", { name: "Remove attachment" })).toBeVisible();
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toHaveValue(
    "Fasse das zusammen",
  );
});

/**
 * The other half of the same rule, and the reason it can't just be "abort on any
 * failure": retrieved CONTEXT is optional. If its scrub fails the context is
 * simply not sent - the user's question must still go through. Getting this
 * backwards (aborting) would make an unrelated document break every chat; the
 * dangerous mistake in the other direction (sending the context unscrubbed) is
 * what the relay assertion below rules out.
 */
test("context scrub fails -> the message still sends, without the context", async ({ page }) => {
  test.slow(); // on-device indexing of the pinned document

  const contextMarker = "Kontextdokument Zebrastreifen";

  await page.route("**/scrub", async (route) => {
    const body = route.request().postData() ?? "";
    if (body.includes("Zebrastreifen")) {
      await route.abort(); // only the CONTEXT scrub fails
      return;
    }
    await route.continue();
  });

  let relayBody = "";
  await page.route("**/chat/stream", async (route) => {
    relayBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Antwort ohne Kontext." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());

  // A pinned document is unconditional context (no dependence on retrieval scores).
  const fname = `ctx-fail-${Date.now()}.txt`;
  await page.goto("/documents");
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(`${contextMarker}: alles Weitere steht hier drin.`),
  });
  await expect(page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });
  const row = page
    .locator("div.rounded-xl")
    .filter({ has: page.getByText(fname, { exact: true }) })
    .first();
  await row.getByRole("button", { name: "Always use as context" }).click();

  await openChat(page);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Was steht da?");
  await clickSend(page);

  // The send goes through despite the failed context scrub...
  await expect(page.getByText("Antwort ohne Kontext.")).toBeVisible({ timeout: 60_000 });
  // ...and the un-scrubbed context was not smuggled along.
  expect(relayBody).not.toContain(contextMarker);

  // Restore the shared account's state (this spec pinned a synced document).
  await page.goto("/documents");
  const after = page
    .locator("div.rounded-xl")
    .filter({ has: page.getByText(fname, { exact: true }) })
    .first();
  await after.getByRole("button", { name: "Don't always use as context" }).click();
  await after.getByRole("button", { name: "Delete document" }).click();
});
