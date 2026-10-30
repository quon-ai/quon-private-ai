import { test, expect } from "@playwright/test";

import { login, openChat, sharedCreds } from "./helpers/account";

/**
 * Feedback #87: the sidebar pill said „Geschützt" while the header badge was
 * red. Every consumer of `useQuonHealth` used to run its OWN 30 s poll with its
 * own failure state — the backend log showed six `/health` requests in one
 * second from one client, and two of those instances could disagree. One
 * shared store now: one boot probe (plus at most one focus/visibility re-poll),
 * however many pills, badges and screens are mounted.
 */
test("the app runs ONE health poll, not one per indicator", async ({ page }) => {
  const hits: number[] = [];
  await page.route("**/health", async (route) => {
    hits.push(Date.now());
    await route.continue();
  });

  await login(page, sharedCreds());
  await openChat(page);
  // Chat screen mounted: sidebar pill + header badges + the screen itself all
  // read the status. Give any stragglers a moment to fire.
  await page.waitForTimeout(3000);

  const t0 = hits[0] ?? Date.now();
  const burst = hits.filter((t) => t - t0 < 3000).length;
  // Boot probe + the one focus/visibility re-poll — never a probe per component.
  // The old per-hook polling produced 3–6 here.
  expect(
    burst,
    `health requests in the first 3 s: ${hits.length} at +${hits.map((t) => t - t0).join(", +")} ms`,
  ).toBeLessThanOrEqual(2);
});
