import { test, expect } from "@playwright/test";

import { clickSend, login, sharedCreds } from "./helpers/account";

/**
 * Document pinning (Runde 1): a PINNED document is injected as context into every
 * in-scope send WITHOUT attaching it (unlike the paperclip). Scoped to a fresh
 * project so the pin can't leak into other specs' global sends. Asserts the
 * pinned doc's distinctive text reaches the wire as a context turn.
 */
test("a pinned document is auto-injected as context on the next send", async ({
  page,
}, testInfo) => {
  test.slow(); // on-device embedding

  const bodies: string[] = [];
  await page.route("**/chat/stream", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "ok" })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());

  // Fresh project → its pinned doc is invisible to every other spec's sends.
  const projectName = `Pinning ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/projects\?id=/, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("id")!;

  await page.getByRole("tab", { name: "Content" }).click();
  const marker = `Zitronenfalter-${Date.now()}`;
  const fname = `pinnable-${Date.now()}.txt`;
  await page.locator('input[type="file"]:not([accept="image/*"])').setInputFiles({
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(`Merksatz: ${marker}.`),
  });
  await expect(page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });

  // Pin it (the doc card's pin toggle).
  await page.getByRole("button", { name: "Always use as context" }).first().click();
  await expect(page.getByRole("button", { name: "Don't always use as context" })).toBeVisible();

  // A chat in this project, send WITHOUT attaching anything.
  await page.goto(`/chat?p=${projectId}`);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Was war der Merksatz?");
  await clickSend(page);

  // The pinned document's content reaches the wire as an injected context turn
  // (non-PII marker survives the scrub intact).
  await expect(async () => {
    expect((bodies.at(-1) ?? "").includes(marker)).toBe(true);
  }).toPass({ timeout: 30_000 });

  // And the grounding chip credits the pinned document.
  await expect(page.getByText(/Context used|Kontext genutzt/)).toBeVisible({ timeout: 10_000 });
});
