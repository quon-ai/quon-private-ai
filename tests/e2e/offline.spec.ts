/**
 * Offline access: "Kann ich offline einloggen und meine Chats sehen?"
 *
 * All data is already cached on-device encrypted (localVault); what this locks
 * in is the FRONT DOOR working without a server: (1) a warm tab resumes
 * offline instead of dead-ending on the "can't reach QUON" screen, (2) a cold
 * start can still unlock with the password against the cached key material,
 * (3) the moment the network returns, the app upgrades in place to a real
 * session and the banner disappears.
 *
 * The API is taken down per-page via route interception on the API origin -
 * context.setOffline would also kill the vite dev server that serves the app
 * itself. Fresh account: the flow mutates chat history and localStorage.
 */
import { test, expect, type Page } from "@playwright/test";

import { API_PORT } from "../../playwright.config";

import {
  freshEmail,
  login,
  openChat,
  registerAndVerify,
  dismissReleaseNotes,
} from "./helpers/account";

// Derived, not restated: the port depends on which checkout this is
// (scripts/session-env.sh), so a hardcoded 8011 would silently stop matching in
// a worktree and these offline mocks would never fire.
const API_GLOB = `http://localhost:${API_PORT}/**`;

async function mockRelay(page: Page) {
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Offline-Probe Antwort" })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
}

const BANNER = "your saved data is readable";

test("offline: warm resume, cold password unlock, and the reconnect upgrade", async ({ page }) => {
  await mockRelay(page);
  const creds = { email: freshEmail("offline"), password: "offline-pass-123" };
  await registerAndVerify(page, creds);
  await login(page, creds);
  await dismissReleaseNotes(page);

  // Produce data worth reading offline: one chat exchange.
  await openChat(page);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("merke dir alpha");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator("main").getByText("Offline-Probe Antwort")).toBeVisible({
    timeout: 30_000,
  });

  // ---- The server goes away -----------------------------------------------
  await page.route(API_GLOB, (route) => route.abort());

  // (1) Warm resume: reload with the MK still in sessionStorage. Before this
  // feature, boot dead-ended on the "can't reach QUON" retry screen.
  await page.reload();
  await expect(page.getByText(BANNER, { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main").getByText("merke dir alpha")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("main").getByText("Offline-Probe Antwort")).toBeVisible();

  // (2) Cold start: the tab-held MK is gone (app killed). The unlock screen
  // must appear - offline - and the password must unlock against the CACHED
  // key material, no server round trip.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(
    page.getByText("You're offline. Unlocking still works", { exact: false }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText(BANNER, { exact: false })).toBeVisible({ timeout: 30_000 });
  // The unlock lands on the dashboard; the earlier chat is reachable through
  // Recents (openChat would start a new chat). Its entry is titled after the
  // first message - clicking it must render the cached conversation.
  await page.goto("/chat");
  await page.getByText("merke dir alpha").first().click();
  await expect(page.locator("main").getByText("Offline-Probe Antwort")).toBeVisible({
    timeout: 30_000,
  });

  // A wrong password must still fail loudly - offline unlock is not a bypass.
  // (The MK secretbox simply doesn't open without the right key.)

  // (3) Reconnect: the server returns; the browser 'online' event triggers the
  // watcher and the app upgrades in place - banner gone, no reload needed.
  await page.unroute(API_GLOB);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(BANNER, { exact: false })).toBeHidden({ timeout: 30_000 });
});

test("offline unlock rejects a wrong password", async ({ page }) => {
  const creds = { email: freshEmail("offwrong"), password: "offline-pass-456" };
  await registerAndVerify(page, creds);
  await login(page, creds);
  await dismissReleaseNotes(page);

  await page.route(API_GLOB, (route) => route.abort());
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(
    page.getByText("You're offline. Unlocking still works", { exact: false }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByPlaceholder("Password", { exact: true }).fill("totally-wrong-password");
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  // Still locked: the offline note stays, no banner/dashboard appears.
  await expect(
    page.getByText("You're offline. Unlocking still works", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(BANNER, { exact: false })).toBeHidden();
});
