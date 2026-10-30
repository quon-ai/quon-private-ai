import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * The dashboard's composer: typing on the start screen must land in the chat as
 * a real, SCRUBBED send — and must happen exactly once.
 *
 * The once-only half is the part worth a test: the handoff is module state, so a
 * bug that forgets to clear it would re-send the message (and re-spend the
 * user's AI budget) on every later visit to /chat, which nothing else here
 * would notice.
 */
test("a message typed on the dashboard is sent once, scrubbed, in the chat", async ({ page }) => {
  const bodies: string[] = [];
  await page.route("**/chat/stream", async (route) => {
    bodies.push(route.request().postData() ?? "");
    const sse =
      `data: ${JSON.stringify({ delta: "Antwort vom Dashboard." })}\n\n` +
      `data: ${JSON.stringify({ done: true })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sse,
    });
  });

  await login(page, sharedCreds());

  const ask = page.getByPlaceholder("Ask something — it stays private");
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await ask.fill("Schreib eine Mail an dashboard@example.com");

  // Enabled only once React actually holds the text — the same hydration race
  // clickSend() guards against in the chat composer.
  const send = page.getByRole("button", { name: "Send and open the chat" });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();

  await expect(page).toHaveURL(/\/chat/, { timeout: 30_000 });
  await expect(page.getByText("Antwort vom Dashboard.")).toBeVisible({ timeout: 30_000 });

  // It went through the ordinary scrub path — the address never left the device.
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toContain("[EMAIL_1]");
  expect(bodies[0]).not.toContain("dashboard@example.com");

  // Back to the dashboard and into the chat again: the handoff is spent, so
  // nothing is sent a second time.
  await page.goto("/");
  await expect(page.getByPlaceholder("Ask something — it stays private")).toHaveValue("");
  await page.goto("/chat");
  await expect(page.getByRole("button", { name: "Review", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);
  expect(bodies).toHaveLength(1);
});
