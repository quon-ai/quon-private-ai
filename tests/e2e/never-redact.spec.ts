import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

// Covers the per-user allow-list: a word the detector mistakes for a name
// ("Xantan" -> PERSON) is suppressed once it's on the never-redact list.
test("a 'never redact' term is sent un-redacted", async ({ page }) => {
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Ja, Guarkernmehl funktioniert." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());

  // Add "Xantan" to the never-redact allow-list (Settings -> Detection tab).
  await page.goto("/settings");
  // The never-redact textarea is in the Detection tab (default tab).
  await page.getByRole("tab", { name: "Detection" }).click();
  const allowList = page.getByPlaceholder(/Xantan/); // the never-redact textarea
  await allowList.fill("Xantan");
  await allowList.blur();

  await openChat(page);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Kann ich Xantan ersetzen?");
  await clickSend(page);

  await expect(page.getByText("Ja, Guarkernmehl funktioniert.")).toBeVisible({ timeout: 20_000 });

  // "Xantan" crossed the wire as itself - the allow-list suppressed the false PERSON hit.
  expect(outgoing).toContain("Xantan");
  expect(outgoing).not.toMatch(/\[PERSON_\d+\]/);
});

// Regression: the redaction lists used to persist only on blur, which is flaky on
// mobile (a keyboard dismiss / app-switch may never fire it). They now also
// debounce-save while typing. Here we type and leave without blurring the field,
// and the term must still be saved.
test("a 'never redact' term persists without an explicit blur (debounced autosave)", async ({
  page,
}) => {
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Ok." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Detection" }).click();
  const allowList = page.getByPlaceholder(/Xantan/);
  await allowList.fill("Xantan");
  // No blur() - just let the debounce (500ms) commit it.
  await page.waitForTimeout(800);

  await openChat(page);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Kann ich Xantan ersetzen?");
  await clickSend(page);

  await expect(page.getByText("Ok.")).toBeVisible({ timeout: 20_000 });
  expect(outgoing).toContain("Xantan");
  expect(outgoing).not.toMatch(/\[PERSON_\d+\]/);
});
