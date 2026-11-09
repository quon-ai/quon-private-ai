import { test, expect, type Page } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

// Sidebar full-text chat search (src/lib/chatSearch.ts + AppSidebar). Purely
// client-side over the decrypted in-memory history (zero-knowledge). We send one
// chat with a distinctive word (mocked relay), then drive the "Search chats" box:
// a matching query surfaces a highlighted snippet that navigates to the chat;
// Escape clears; a non-matching query shows "No matches."

const box = (page: Page) => page.getByPlaceholder("Ask anything, keep your data personal");

test("sidebar search finds a chat by message content, highlights + navigates, clears", async ({
  page,
}) => {
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "ok" })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  // A word unique to this run so the serial shared account can't match older chats.
  const needle = `zappelphilipp${Date.now()}`;
  await box(page).fill(`Notiz mit ${needle} drin`);
  await clickSend(page);
  await expect(page.locator("main").getByText("ok").last()).toBeVisible({ timeout: 30_000 });

  // Type the word into the sidebar search box -> a result row appears with the
  // matching snippet, and the match itself is wrapped in a highlight span.
  const search = page.getByPlaceholder("Search chats");
  await search.fill(needle);
  await expect(page.getByText("Results")).toBeVisible({ timeout: 10_000 });
  const hitLink = page.getByRole("link").filter({ hasText: needle });
  await expect(hitLink).toBeVisible({ timeout: 10_000 });
  // The match is rendered inside a marked (highlighted) segment, not plain text -
  // the ring class is the tell (MarkedText wraps hits in a ring-quon-yellow span).
  await expect(hitLink.locator("span[class*='ring-quon-yellow']").first()).toBeVisible();

  // Clicking the result navigates to that chat (...?c=<id>) and the message is shown.
  await hitLink.click();
  await expect(page).toHaveURL(/\/chat\?c=/, { timeout: 10_000 });
  await expect(page.locator("main").getByText(needle, { exact: false })).toBeVisible();

  // Escape in the search box clears it - the Results group disappears.
  await search.fill(needle);
  await expect(page.getByText("Results")).toBeVisible();
  await search.press("Escape");
  await expect(page.getByText("Results")).toHaveCount(0);
  await expect(search).toHaveValue("");
});

test("a non-matching query shows No matches.", async ({ page }) => {
  await login(page, sharedCreds());
  await openChat(page);

  const search = page.getByPlaceholder("Search chats");
  await search.fill(`nichtvorhanden${Date.now()}xyz`);
  await expect(page.getByText("No matches.")).toBeVisible({ timeout: 10_000 });
});
