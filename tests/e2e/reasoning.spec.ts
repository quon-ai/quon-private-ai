import { test, expect, type Page } from "@playwright/test";

import { login, openChat, sharedCreds } from "./helpers/account";

// Capture every /chat/stream request body so we can assert what the composer's
// reasoning picker actually put on the wire. The relay itself is mocked (LLM off in
// the throwaway stack), echoing a fixed reply so the send completes.
function captureRelay(page: Page) {
  const bodies: Array<Record<string, unknown>> = [];
  const ready = page.route("**/chat/stream", async (route) => {
    try {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    } catch {
      bodies.push({});
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "ok" })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
  return { bodies, ready };
}

const box = (page: Page) => page.getByPlaceholder("Ask anything, keep your data personal");
const send = (page: Page) => page.getByRole("button", { name: "Send" }).click();
const main = (page: Page) => page.locator("main");

test("reasoning effort: default omits the param, composer override sends it", async ({ page }) => {
  const { bodies, ready } = captureRelay(page);
  await ready;
  await login(page, sharedCreds());
  await openChat(page);

  // 1) Default effort is "off" -> no reasoning_effort on the wire (provider default).
  await box(page).fill("reasoning default check");
  await send(page);
  await expect(main(page).getByText("ok").last()).toBeVisible({ timeout: 30_000 });
  expect(bodies.at(-1)?.reasoning_effort).toBeUndefined();

  // 2) Pick "High" in the composer, send again -> reasoning_effort crosses the wire.
  await page.getByTitle(/Reasoning effort/).click();
  await page.getByRole("menuitem", { name: /High/ }).click();
  await box(page).fill("reasoning high check");
  await send(page);
  await expect(async () => {
    expect(bodies.at(-1)?.reasoning_effort).toBe("high");
  }).toPass({ timeout: 30_000 });
});
