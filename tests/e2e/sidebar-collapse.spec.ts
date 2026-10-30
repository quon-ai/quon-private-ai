import { test, expect } from "@playwright/test";

import { clickSend, login, registerAndVerify, type Creds } from "./helpers/account";

// Sidebar project groups collapse their chat list by default and expand on click
// (AppSidebar). The project you're actively in auto-expands; on a fresh load of a
// page where the project isn't active, it starts collapsed. Fresh account so the
// sidebar is clean (the shared account accumulates projects across specs).
const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

test("project chats collapse by default in the sidebar and expand on click", async ({ page }) => {
  test.slow(); // register + Argon2 login

  // Mock the relay so sending a message (to create the chat) is deterministic.
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "ok" })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  const creds: Creds = { email: `sidebar-${uniq()}@quon.test`, password: "e2e-password-123456" };
  await registerAndVerify(page, creds);
  await login(page, creds);

  // Create a project.
  const projectName = `Sidebar ${uniq()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/projects\?id=/, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("id")!;

  // Create a chat inside the project (its title derives from the first message).
  const chatMsg = `Sidebar collapse check ${uniq()}`;
  await page.goto(`/chat?p=${projectId}`);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill(chatMsg);
  await clickSend(page);
  await expect(page.locator("main").getByText("ok").last()).toBeVisible({ timeout: 30_000 });

  // While we're in the project its chats auto-expand → the toggle offers to HIDE.
  await expect(page.getByRole("button", { name: `Hide chats in ${projectName}` })).toBeVisible({
    timeout: 30_000,
  });

  // Reload on the projects list (project not active) → collapsed by default.
  await page.goto("/projects");
  await page.reload();
  const expandBtn = page.getByRole("button", { name: `Show chats in ${projectName}` });
  await expect(expandBtn).toBeVisible({ timeout: 30_000 });
  // The chat link is hidden while the group is collapsed.
  await expect(page.getByRole("link", { name: new RegExp(chatMsg) })).toHaveCount(0);

  // Expand → the toggle flips to HIDE and the chat link appears.
  await expandBtn.click();
  await expect(page.getByRole("button", { name: `Hide chats in ${projectName}` })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(chatMsg) })).toBeVisible();
});
