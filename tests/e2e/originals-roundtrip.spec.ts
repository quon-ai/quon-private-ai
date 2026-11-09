import { test, expect } from "@playwright/test";

import { login, registerAndVerify, type Creds } from "./helpers/account";

/**
 * Cross-device originals: a document uploaded on device A must render its
 * original layout on device B - the exact flow behind the reported "das
 * Originallayout gibt es nur auf dem Gerät..." bug. Logout wipes every local
 * store (documents + originals caches), so sign-out -> sign-in on the same
 * browser is a faithful "other device": the DocItem comes back via /sync, and
 * the original bytes must be lazily fetched from the `originals` collection
 * (encrypted chunks), decrypted and rendered.
 */

const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function freshCreds(tag: string): Creds {
  return { email: `orig-${tag}-${uniq()}@quon.test`, password: "e2e-password-123456" };
}

test("an HTML document's original layout survives to a fresh device via originals sync", async ({
  page,
}) => {
  test.slow(); // indexing embeds on-device; first save may download the model

  const creds = freshCreds("rt");
  await registerAndVerify(page, creds);
  await login(page, creds);
  await page.goto("/documents");

  const fname = `finanzen-${uniq()}.html`;
  const heading = `Originallayout ${uniq()}`;

  // The background originals upload pushes chunks with ids "orig:<docId>:<i>".
  // Waiting for that response (and the follow-up documents push that carries
  // the manifest) makes the pre-logout state deterministic instead of a sleep.
  const origPush = page.waitForResponse(
    (r) => r.url().includes("/sync/push") && (r.request().postData() ?? "").includes('"orig:'),
    { timeout: 120_000 },
  );

  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/html",
    buffer: Buffer.from(
      `<html><body><h1>${heading}</h1><p>Zuweisung: 3.558 Euro pro Monat.</p></body></html>`,
    ),
  });

  const docRow = page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) });
  await expect(docRow).toBeVisible({ timeout: 120_000 });
  await origPush;
  // The manifest rides the normal documents collection - wait for that push too
  // so the "other device" is guaranteed to see it.
  await page.waitForResponse(
    (r) => r.url().includes("/sync/push") && (r.request().postData() ?? "").includes('"documents"'),
    { timeout: 30_000 },
  );

  // Sanity: the uploading device renders the original (a real <h1>).
  await docRow.click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.getByRole("heading", { name: heading })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // --- "Device B": logout wipes all local stores, login pulls from the server.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 15_000 });
  await login(page, creds);
  await page.goto("/documents");

  const rowB = page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) });
  await expect(rowB).toBeVisible({ timeout: 60_000 });
  await rowB.click();

  // The original is not cached here - it must be fetched (chunks), decrypted
  // and rendered as real layout, not the extracted-text fallback.
  const viewerB = page.getByRole("dialog");
  await expect(viewerB.getByRole("heading", { name: heading })).toBeVisible({ timeout: 60_000 });
  await expect(viewerB.getByText(/only available on the device|hasn't been synced/)).toHaveCount(0);
});
