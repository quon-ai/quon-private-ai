import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * Feedback #88: „Meine Projekte werden nicht mehr angezeigt obwohl ich welche
 * habe". The browser evicted the IndexedDB cache; the sync cursors in
 * localStorage survived; the device asked the server only for "changes since
 * N" and never saw its projects again. After an eviction the next boot must
 * re-pull everything.
 *
 * Simulated exactly: create a project (synced to the throwaway server), delete
 * the local database while leaving localStorage alone, reload.
 */
test("a project survives the browser evicting the local database", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/projects");

  const name = `Umzug ${Date.now()}`;
  // Wait for the PROJECT's push, not just any push: prefs sync first, and the
  // project blob follows after a 1.5 s debounce. On WebKit the reload below
  // kills an in-flight push, so waiting for the wrong one made the server
  // never see the project — the re-pull was then correct in finding nothing.
  const pushed = page.waitForResponse(
    (r) =>
      r.url().includes("/sync/push") &&
      r.request().method() === "POST" &&
      (r.request().postData() ?? "").includes('"collection":"projects"'),
  );
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(name);
  await page.getByRole("button", { name: "Create" }).click();
  expect((await pushed).ok()).toBe(true); // the blob is on the server — the only copy that must survive

  // Create navigated to the project's detail page; go back to the LIST now,
  // before the eviction, so the reload below lands on the list.
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });

  // Evict: drop the database, keep localStorage (and with it the cursors).
  // A deleteDatabase is blocked while a page holds a connection; the app now
  // closes its connection on `versionchange`, so this completes.
  const result = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.deleteDatabase("quon");
        req.onsuccess = () => resolve("deleted");
        req.onerror = () => resolve(`error: ${req.error?.name}`);
        setTimeout(() => resolve("blocked"), 15_000);
      }),
  );
  expect(result).toBe("deleted");
  expect(
    await page.evaluate(
      () => Object.keys(localStorage).filter((k) => k.startsWith("quon_sync_seq_")).length,
    ),
  ).toBeGreaterThan(0); // the stale cursors are exactly the trap

  // The reload lands on the list again. No goto after it: on WebKit a goto
  // issued while the freshly booted app is still routing is reported as
  // "Frame load interrupted".
  await page.reload();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 30_000 });
});
