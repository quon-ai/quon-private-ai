import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

/**
 * Resumable streaming: switching apps on a phone freezes the page and kills the
 * SSE socket mid-answer. The server keeps generating into a job buffer, so the
 * client re-attaches at its event offset and the answer completes instead of
 * dying as "Verbindung verloren".
 *
 * Hermetic: both legs are route-mocked. The first leg delivers a job id and
 * PART of the answer, then aborts (the dropped socket); the resume GET must
 * arrive with the exact offset the client had applied and deliver the rest.
 */
test("a dropped stream resumes and completes the answer", async ({ page }) => {
  const JOB = "job-e2e-1";
  let resumeFrom: string | null = null;

  await page.route("**/chat/stream", async (route) => {
    // job announcement + 2 buffered events, then the connection dies.
    const body =
      `data: ${JSON.stringify({ job: JOB })}\n\n` +
      `data: ${JSON.stringify({ delta: "Der erste Teil" })}\n\n` +
      `data: ${JSON.stringify({ delta: " der Antwort" })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body,
    });
  });

  await page.route("**/chat/stream/resume**", async (route) => {
    resumeFrom = new URL(route.request().url()).searchParams.get("from_index");
    const body =
      `data: ${JSON.stringify({ job: JOB })}\n\n` +
      `data: ${JSON.stringify({ delta: " — und der Rest." })}\n\n` +
      `data: ${JSON.stringify({ done: true })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Erzähl mir etwas.");
  await clickSend(page);

  // The full answer = first leg + resumed tail, seamlessly concatenated.
  await expect(page.getByText("Der erste Teil der Antwort — und der Rest.")).toBeVisible({
    timeout: 30_000,
  });
  // Resume asked for exactly the events it had already applied (2), so nothing
  // is replayed twice and nothing is skipped.
  expect(resumeFrom).toBe("2");
  // No "connection lost" note - the user never sees the drop.
  await expect(page.getByText(/Connection lost/)).toHaveCount(0);
});

/** A job the server no longer knows (restart / TTL) must degrade to the honest
 *  partial answer + Retry, never hang or silently lose the tokens. */
test("an expired job falls back to the partial answer with Retry", async ({ page }) => {
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ job: "gone" })}\n\n` +
        `data: ${JSON.stringify({ delta: "Angefangene Antwort" })}\n\n`,
    });
  });
  await page.route("**/chat/stream/resume**", (route) =>
    route.fulfill({ status: 404, json: { detail: "stream job not found or expired" } }),
  );

  await login(page, sharedCreds());
  await openChat(page);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Und jetzt?");
  await clickSend(page);

  await expect(page.getByText("Angefangene Antwort")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Connection lost/)).toBeVisible({ timeout: 30_000 });
});

/**
 * A provider refusal (OpenRouter 401 on the sub-key) is forwarded by the server
 * as an `{error}` event inside a 200 stream - no HTTP status, the same shape as
 * a dropped socket - so a client that treats it as a drop resumes it five times
 * and then shows "Verbindung verloren". The refusal is the answer: it must
 * surface as the real message, with no resume attempt at all.
 */
test("a provider refusal in the stream is shown as-is and never resumed", async ({ page }) => {
  const detail =
    "The AI provider rejected this account's API key. If you added your own key, check it under Settings → Providers.";
  let resumeCalls = 0;
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ job: "job-refused" })}\n\n` +
        `data: ${JSON.stringify({ error: detail })}\n\n`,
    });
  });
  await page.route("**/chat/stream/resume**", async (route) => {
    resumeCalls += 1;
    // What the real server answers for a finished job: nothing new.
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ job: "job-refused" })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("wetter morgen");
  await clickSend(page);

  await expect(page.getByText(/rejected this account's API key/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByText(/Connection lost/)).toHaveCount(0);
  expect(resumeCalls).toBe(0);
});
