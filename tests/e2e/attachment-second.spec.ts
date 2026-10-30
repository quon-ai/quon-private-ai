import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

/**
 * Issue #74: the operator attached a SECOND document to a running chat and the
 * model answered "you didn't attach it — I only have the first report", then,
 * on the next turn, "only the text arrived, without an attachment" — while the
 * composer chip showed an attachment both times.
 *
 * A wrong document silently answered from is the worst failure this feature can
 * have, so this pins the whole sequence at the RELAY boundary: what actually
 * left the device, not what the UI claimed. Two turns, two different documents,
 * each identified by a marker the other does not contain.
 *
 * The 60s ceilings mirror attachment.spec.ts — measured, not generous.
 */
test("a second attachment replaces the first: turn 2 carries B, never A", async ({ page }) => {
  const bodies: string[] = [];
  await page.route("**/chat/stream", async (route) => {
    bodies.push(route.request().postData() ?? "");
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
  const composer = page.getByPlaceholder(/Ask anything|Frag alles/);

  // --- turn 1: document A -------------------------------------------------
  const staged = page.getByTestId("staged-attachment");
  await page.setInputFiles('input[type="file"]', "tests/e2e/fixtures/depot-a.txt");
  await expect(staged).toContainText("depot-a.txt", { timeout: 60_000 });
  await composer.fill("Wie sieht das Depot aus?");
  await clickSend(page);
  await expect(page.getByText("Alles klar.")).toBeVisible({ timeout: 60_000 });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain("DEPOTBERICHT ALPHA");

  // The STAGED chip (composer, not the sent bubble's own chip) is consumed by
  // the send — a stale one is how the operator ended up believing a new file
  // was attached when the old one rode along.
  await expect(staged).toHaveCount(0);

  // --- turn 2: document B, same chat --------------------------------------
  await page.setInputFiles('input[type="file"]', "tests/e2e/fixtures/depot-b.txt");
  await expect(staged).toContainText("depot-b.txt", { timeout: 60_000 });
  await composer.fill("Und dieses hier?");
  await clickSend(page);
  // poll: the request leaves asynchronously after the click.
  await expect.poll(() => bodies.length, { timeout: 60_000 }).toBe(2);

  const turn2 = bodies[1];
  // The new document is there…
  expect(turn2).toContain("DEPOTBERICHT BRAVO");
  // …and the old one is not: turn 2 must not be answered from document A.
  expect(turn2).not.toContain("DEPOTBERICHT ALPHA");

  // …and it is POSITIONED as belonging to the newest turn. This is the actual
  // #74 defect: the document was always in the request, but spliced at the head
  // of the conversation, so the model attributed it to the FIRST question
  // ("I only have the first report") and called the newest turn attachment-less.
  const msgs = (JSON.parse(turn2) as { messages: { role: string; content: string }[] }).messages;
  const docIdx = msgs.findIndex((m) => m.content.includes("DEPOTBERICHT BRAVO"));
  const lastUserIdx = msgs.map((m) => m.role).lastIndexOf("user");
  const firstUserIdx = msgs.map((m) => m.role).indexOf("user");
  expect(docIdx).toBeGreaterThan(firstUserIdx); // not at the head any more
  expect(docIdx).toBe(lastUserIdx - 1); // immediately before the turn it belongs to
  expect(msgs[lastUserIdx].content).toContain("Und dieses hier?");
});
