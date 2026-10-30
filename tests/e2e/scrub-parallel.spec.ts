import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

/**
 * Send-path latency: a protected message can need up to four independent /scrub
 * round trips (retrieved context, project instruction, attachment, the typed
 * message). Each costs a network hop plus the backend's cloud-LLM pass, so
 * running them one after another was most of the wait before the model even
 * started answering — the reported "QUON is noticeably slower than ChatGPT".
 *
 * They are now issued as ONE parallel wave and only CONSUMED in a fixed order
 * (so placeholder numbering stays deterministic). This pins the overlap: with an
 * artificial delay on every /scrub, two requests must be in flight at the same
 * time. Before the change the maximum overlap was 1.
 */
test("context and message are scrubbed in parallel, not one after the other", async ({ page }) => {
  test.slow(); // on-device indexing of the pinned document + delayed scrubs

  let inFlight = 0;
  let maxInFlight = 0;
  await page.route("**/scrub", async (route) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // Long enough that a SEQUENTIAL implementation could never overlap.
    await new Promise((r) => setTimeout(r, 600));
    try {
      await route.continue();
    } finally {
      inFlight -= 1;
    }
  });

  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Antwort." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());

  // A pinned document is unconditional context — it guarantees a context scrub
  // alongside the message scrub without depending on retrieval scores.
  const fname = `parallel-${Date.now()}.txt`;
  await page.goto("/documents");
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from("Der Vertrag von Anna Berger laeuft bis Ende des Jahres."),
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
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Wie lange noch?");
  await clickSend(page);
  await expect(page.getByText("Antwort.")).toBeVisible({ timeout: 60_000 });

  // Fails-on-old: the sequential implementation never had two scrubs open at once.
  expect(maxInFlight).toBeGreaterThanOrEqual(2);

  // Cleanup: unpin so the shared account doesn't carry always-on context into
  // other specs (a synced precondition this spec changed).
  await page.goto("/documents");
  const after = page
    .locator("div.rounded-xl")
    .filter({ has: page.getByText(fname, { exact: true }) })
    .first();
  await after.getByRole("button", { name: "Don't always use as context" }).click();
  await after.getByRole("button", { name: "Delete document" }).click();
});
