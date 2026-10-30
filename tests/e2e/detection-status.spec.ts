import { test, expect } from "@playwright/test";

import { login, openChat, sharedCreds } from "./helpers/account";

/**
 * Feedback #54: "a status indicator whether local detection works — later in
 * the chat is a bit late — and a link to the docs." Both live under the
 * detection types now. On the E2E stack the scrubber is up, so the line reads
 * as the healthy state and names the engines; offline/degraded copy is covered
 * by the header badge's own tests.
 */
test("the Detection tab states the engine status and links to how detection works", async ({
  page,
}) => {
  await login(page, sharedCreds());
  await page.goto("/settings");
  const line = page.getByTestId("detection-status");
  await expect(line).toBeVisible({ timeout: 20_000 });
  await expect(line).toContainText(/spaCy/);
  await expect(line).toContainText(/GLiNER (loaded|off)/);
  await line.getByRole("link", { name: /How detection works/ }).click();
  await expect(page).toHaveURL(/\/trust/);
});

/**
 * The composer mic is a POINTER to the keyboard's dictation, not an engine
 * (2026-09-06). It must therefore render on EVERY browser — no capability
 * gate — and tapping it must explain, in info tone, where that key is. The
 * operator's two reports were the reason: unavailable in the installed iPhone
 * app, `network` on macOS, and where the Web Speech API did work it uploaded
 * unscrubbed audio to Apple/Google.
 */
test("the mic explains the keyboard's dictation instead of running an engine", async ({ page }) => {
  await login(page, sharedCreds());
  await openChat(page);
  const mic = page.getByTestId("dictation-button");
  await expect(mic).toBeVisible({ timeout: 20_000 });
  await expect(mic).toHaveAttribute("data-mic", "keyboard");

  await mic.click();
  const hint = page.getByTestId("send-hint");
  await expect(hint).toBeVisible();
  // Names the keyboard, and the honest reason this design was chosen.
  await expect(hint).toContainText(/keyboard|Tastatur|macOS|Windows/);
  await expect(hint).toContainText(/finished text|fertigen Text/);
  // Info tone: nothing failed, so no error banner.
  await expect(page.getByRole("alert")).toHaveCount(0);

  // It is a hint, not a mode: typing clears it.
  await page.getByPlaceholder(/Ask anything|Frag alles/).fill("weiter");
  await expect(hint).toHaveCount(0);
});
