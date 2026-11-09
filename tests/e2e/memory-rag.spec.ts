import { test, expect } from "@playwright/test";

import { blobCount, clickSend, login, openChat, sharedCreds } from "./helpers/account";

// Covers the on-device RAG path: a saved memory is embedded locally, retrieved for
// a related question, and surfaced via the "Context used" chip.
//
// FIXME: flaky in this harness only. The flow needs the memory to survive the
// memory->chat navigation (every screen change is a full document load here), but
// the harness's IndexedDB cache no-ops and the server sync doesn't settle in time,
// so the reloaded /chat starts with an empty store. The RAG retrieval LOGIC is
// covered by unit tests (search/querySplit, search/rerank, search/vector). Re-enable
// once the suite drives navigation without a reload (or seeds memory server-side).
test.fixme("a saved memory is retrieved as chat context", async ({ page }) => {
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Du wohnst in Hamburg." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());

  // Save a memory and wait for the on-device embedder to index it.
  await page.goto("/memory");
  await page.getByRole("button", { name: "Add Memory" }).click();
  await page.getByPlaceholder("What should QUON remember?").fill("Ich wohne in Hamburg");
  await page.getByRole("button", { name: "Save" }).click();
  // Confirm the memory persisted, then wait for the on-device embedder to index it.
  await expect(page.getByText("Ich wohne in Hamburg")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("not indexed")).toHaveCount(0, { timeout: 90_000 });

  // Wait until the memory has synced to the server, so reloading /chat pulls it back
  // (the harness's IndexedDB cache doesn't persist across reloads).
  await expect.poll(() => blobCount("memory"), { timeout: 30_000 }).toBeGreaterThan(0);

  // On /chat the "Context" pill only appears once there is retrievable content.
  await openChat(page);
  await expect(page.getByRole("button", { name: /Context/ })).toBeVisible({ timeout: 30_000 });

  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Wo wohne ich?");
  await clickSend(page);

  await expect(page.getByText(/Context used/)).toBeVisible({ timeout: 60_000 });
});
