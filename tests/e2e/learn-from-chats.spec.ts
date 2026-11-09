import { test, expect } from "@playwright/test";

import { clickSend, login, registerAndVerify, type Creds } from "./helpers/account";

// Auto-Memory v1 "Learn from chats" (memoryExtract.runMemorySweep + LearnFromChatsButton
// + the review queue in the embedded project ScreenMemory). Zero-knowledge: the sweep
// scrubs each transcript on-device (/scrub), asks the model to extract durable facts
// (non-stream POST /chat), re-hydrates locally, then queues suggestions for approval.
//
// We drive it in a project: send one in-project chat holding a durable fact, mock the
// extraction reply to return that fact (as a JSON array, no placeholders - so
// re-hydration is a no-op), run the sweep, and Keep the suggestion into project memory.
// Fresh account so the scope/dedup is clean and the per-session cursor starts at 0.
const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

test("Learn from chats mines a project chat into a kept project memory", async ({ page }) => {
  test.slow(); // register + Argon2 login + on-device embed of the candidate

  const creds: Creds = { email: `learn-${uniq()}@quon.test`, password: "e2e-password-123456" };
  const factText = `Arbeitet als Elektriker ${Date.now()}`;

  // Chat reply stream (the in-project conversation turn).
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Verstanden." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  // Non-stream extraction call (chatComplete -> POST /chat). Only intercept the API
  // POST - not the frontend's GET /chat page navigation (same path, different method
  // and origin), which would otherwise render this JSON as the document body.
  // The assistant content is a strict JSON array of one durable fact, no placeholders.
  let extractionCalls = 0;
  await page.route(/\/chat(\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    extractionCalls++;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answer: JSON.stringify([{ kind: "fact", key: "Beruf", text: factText, tags: [] }]),
        model: "mock",
      }),
    });
  });

  await registerAndVerify(page, creds);
  await login(page, creds);

  // Create a project and note its id.
  const projectName = `Beruf ${uniq()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/projects\?id=/, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("id")!;

  // Send one chat IN the project with enough new user text to clear the sweep's
  // triviality gate (MIN_NEW_USER_CHARS = 200), carrying the durable fact.
  await page.goto(`/chat?p=${projectId}`);
  const longMsg =
    "Ich arbeite als Elektriker bei Firma Volt und montiere jeden Tag Schaltschraenke, " +
    "verlege Kabel in Neubauten und pruefe bestehende Installationen auf Sicherheit. " +
    "Meine Arbeit macht mir Spass und ich mache das schon seit vielen Jahren gerne.";
  expect(longMsg.length).toBeGreaterThan(200);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill(longMsg);
  await clickSend(page);
  await expect(page.locator("main").getByText("Verstanden.").last()).toBeVisible({
    timeout: 30_000,
  });

  // Go to the project overview and run "Learn from chats".
  await page.goto(`/projects?id=${projectId}`);
  await page.getByRole("button", { name: "Learn from chats" }).click();

  // --- the result must be reachable from where the sweep was run -------------
  // The failure shape: the sweep says "29 suggestions to review", the only
  // thing to press is this button again, and pressing it re-runs the sweep,
  // which finds nothing left to analyse and replaces the real result with
  // "Nothing new to learn". Nothing is lost, but the user cannot tell. The
  // spec reaches the queue the way the user does, through this chip, not
  // through the Content tab from knowledge the UI never gave them.
  const reviewChip = page.getByRole("button", { name: /to review/ });
  await expect(reviewChip).toBeVisible({ timeout: 120_000 });
  const afterSweep = extractionCalls;

  // Pressing the sweep button again must not burn a relay call on a sweep that
  // can only report "nothing new" over the top of a real result.
  await page.getByRole("button", { name: "Learn from chats" }).click();
  await page.waitForTimeout(1500);
  expect(extractionCalls).toBe(afterSweep);

  // And it must take the user to the queue instead - which is on another tab.
  await expect(page.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");

  // A suggestion card appears in the embedded project memory review queue.
  // Generous timeout: the sweep triggers the first on-device embedder load in
  // this context (model download + WASM init), which can run well past 60s cold
  // on a loaded CI box before the candidate is embedded and queued.
  await expect(page.getByText(/Suggested for your memory/)).toBeVisible({ timeout: 120_000 });
  const card = page
    .locator("div")
    .filter({ hasText: factText })
    .filter({ has: page.getByRole("button", { name: "Keep" }) })
    .last();
  await expect(card).toBeVisible({ timeout: 30_000 });

  // Keep it -> it lands in project memory and the suggestion queue empties.
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByText(/Suggested for your memory/)).toHaveCount(0, { timeout: 30_000 });

  // The kept fact now shows in the project's memory list (with its Edit control).
  const memCard = page
    .locator("div")
    .filter({ hasText: factText })
    .filter({ has: page.getByRole("button", { name: "Edit memory" }) })
    .last();
  await expect(memCard).toBeVisible({ timeout: 30_000 });
});
