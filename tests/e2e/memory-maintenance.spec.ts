import { test, expect } from "@playwright/test";

import { login, purgeAccountBlobs, sharedCreds } from "./helpers/account";

/**
 * Memory lifecycle (P5) - the deterministic maintenance loop, hermetic (no LLM):
 * two facts with the same key but different text form a key conflict -> the
 * quiet "Pflege" row appears -> picking a winner supersedes the loser (never
 * deletes) -> the loser is recoverable from the archived drawer -> restoring it
 * brings the conflict back. Also asserts the anti-clutter invariant the
 * ux-designer concept is built on: resolving/archiving is fully reversible.
 *
 * The shared e2e account accumulates data across specs and retries, so all
 * texts/keys are unique per run and assertions target this run's strings, never
 * global counts.
 */
test("key conflict: resolve, archive drawer, restore", async ({ page }) => {
  test.slow(); // first save may wait for the on-device embedder

  await login(page, sharedCreds());
  await page.goto("/memory");

  // Cleanup contract baseline: the spec may only end once the server is back
  // to this many live memory blobs (see awaitServerCleanup - deleted in the
  // UI is not deleted until the tombstone lands server-side).

  const suffix = `${Date.now()}`;
  const key = `Wohnort-${suffix}`;
  const hamburg = `Hamburg, Elbchaussee 1 (${suffix})`;
  const berlin = `Berlin, Kastanienallee 5 (${suffix})`;

  async function addFact(text: string) {
    await page.getByRole("button", { name: "Add Memory" }).click();
    await page.getByPlaceholder("Label (e.g. Standard rate)").fill(key);
    await page.getByPlaceholder("What should QUON remember?").fill(text);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(text)).toBeVisible({ timeout: 60_000 });
  }

  await addFact(hamburg);
  await addFact(berlin);

  // Same key + different text = a conflict -> the maintenance row appears.
  const maintRow = page.getByRole("button", { name: /conflict/ }).first();
  await expect(maintRow).toBeVisible();
  await maintRow.click();
  await expect(page.getByRole("heading", { name: "Conflicts" })).toBeVisible();

  // Pick Berlin as the current version -> Hamburg is superseded, not deleted.
  await page.getByRole("button", { name: "Keep this version" }).filter({ hasText: berlin }).click();

  // Hamburg left the active list; Berlin stays.
  await expect(page.getByText(berlin)).toBeVisible();
  await expect(page.getByText(hamburg)).toBeHidden();

  // The archived drawer holds the superseded item and can restore it.
  const drawer = page.getByRole("button", { name: /archived memor/ });
  await expect(drawer).toBeVisible();
  await drawer.click();
  await expect(page.getByText(hamburg)).toBeVisible();
  await page
    .locator("div.border-dashed")
    .filter({ hasText: hamburg })
    .getByRole("button", { name: "Restore" })
    .click();

  // Restored -> active again (the main-list card renders it as a <p>; the text
  // Also reappears inside the re-opened conflict section, so target the
  // paragraph to stay strict-mode-safe), and the conflict row is back.
  await expect(page.getByRole("paragraph").filter({ hasText: hamburg })).toBeVisible();
  await expect(page.getByRole("button", { name: /conflict/ }).first()).toBeVisible();

  // CLEAN UP: delete both facts - shared-account memory residue forces every
  // later chat-send spec through retrieval (embedder init inside the send),
  // which is what tipped the webkit pass (it inherits chromium's leftovers).
  for (const text of [hamburg, berlin]) {
    await page
      .locator("div.rounded-xl")
      .filter({ hasText: text })
      .getByRole("button", { name: "Delete memory" })
      .first()
      .click();
    await expect(page.getByRole("paragraph").filter({ hasText: text })).toHaveCount(0);
  }
  // ...and only now is the cleanup real: wait for the tombstones to reach the
  // server, or the next login on this lane account resurrects the fixtures
  // and they turn up as RAG context in an unrelated spec.
  purgeAccountBlobs("memory", sharedCreds().email);
});
