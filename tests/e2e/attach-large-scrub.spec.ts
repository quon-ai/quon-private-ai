import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

/**
 * Large-attachment scrubbing (perf fix): an attachment over the split threshold
 * is scrubbed as several PARALLEL /scrub requests and merged value-aware
 * (scrubChunked.ts), instead of one long /scrub that tips over the edge timeout.
 * This asserts the end-to-end result: the send SUCCEEDS and the same repeated
 * person collapses to one placeholder across the pieces (never the raw name) in
 * the outgoing relay body. Backend runs LLM-off, so NER supplies the PERSON.
 */
test("a large attachment is split, scrubbed in parallel, and merged to one placeholder", async ({
  page,
}) => {
  test.slow(); // on-device indexing + several scrub calls

  let scrubCalls = 0;
  await page.route("**/scrub", async (route) => {
    scrubCalls += 1;
    await route.continue();
  });

  let body = "";
  await page.route("**/chat/stream", async (route) => {
    body = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Vergleich folgt." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  // A >12k document repeating the same name in many paragraphs -> splits into
  // multiple scrub pieces, each seeing "Anna Müller".
  const para = "Angebot: Anna Müller ist Vertragspartnerin dieses Angebots.\n\n";
  const bigText = para.repeat(400); // ~24k chars
  await page.setInputFiles('input[type="file"]', {
    name: "angebote.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(bigText, "utf-8"),
  });
  await expect(page.getByText("angebote.txt")).toBeVisible({ timeout: 30_000 });

  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Vergleiche die Angebote");
  await clickSend(page);

  // The send completes (no fail-closed "nothing sent" error) and the assistant
  // reply arrives.
  await expect(page.getByText("Vergleich folgt.")).toBeVisible({ timeout: 90_000 });

  // The outgoing relay body carries the merged placeholder, never the real name.
  expect(body).toContain("[PERSON_1]");
  expect(body).not.toContain("Anna Müller");
  // Value-aware merge: only one person placeholder index is used for the one
  // person, even though the text was scrubbed in several independent pieces.
  const personIdx = new Set([...body.matchAll(/\[PERSON_(\d+)\]/g)].map((m) => m[1]));
  expect([...personIdx]).toEqual(["1"]);

  // Fails-on-old guard: the ~24k attachment was scrubbed as SEVERAL /scrub calls
  // (>=3 pieces of 8k), not one long request. The pre-fix code sent the whole
  // attachment as a single /scrub -> far fewer calls.
  expect(scrubCalls).toBeGreaterThanOrEqual(3);
});
