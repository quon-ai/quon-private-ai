/**
 * Biometric unlock (WebAuthn PRF) - full loop on a CDP virtual authenticator:
 * enroll in Settings -> force the `locked` state (drop the sessionStorage MK) ->
 * unlock via the biometric button -> data decrypts. Plus the revoked-elsewhere
 * path (server row gone -> honest message, marker cleared, password fallback).
 *
 * Chromium-only: the virtual authenticator is a CDP feature (WebAuthn.enable
 * with hasPrf, protocol.d.ts declares it) - WebKit has no equivalent. The
 * crypto path (PRF output -> wrap/unwrap) is unit-tested in quonCrypto.test.ts;
 * ordinary WebKit coverage of ScreenUnlock stays with auth.spec.ts. Uses a
 * fresh account, never the shared serial one - enrollment mutates server state.
 */
import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import {
  dismissReleaseNotes,
  freshEmail,
  login,
  registerAndVerify,
  TEST_DB,
  execSql,
} from "./helpers/account";

test.skip(({ browserName }) => browserName !== "chromium", "CDP virtual authenticator");

const BIO_BUTTON = "Unlock with Face ID / fingerprint";

async function addVirtualAuthenticator(page: import("@playwright/test").Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      hasPrf: true,
    },
  })) as { authenticatorId: string };
  return { cdp, authenticatorId };
}

test("enroll in Settings, unlock with the passkey, revoked row falls back honestly", async ({
  page,
}) => {
  await addVirtualAuthenticator(page);

  const creds = { email: freshEmail("bio"), password: "bio-unlock-pass-123" };
  await registerAndVerify(page, creds);
  await login(page, creds);

  // --- Proactive offer on the dashboard (shown once per new user) --------
  await expect(page.getByText("Unlock faster next time", { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // --- Enroll (Settings -> Account) ---------------------------------------
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Account" }).click();
  await page.getByRole("button", { name: "Enable on this device" }).click();
  await expect(page.getByText("Enabled on this device", { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // --- Lock: drop the tab-held MK, keep the session cookie ---------------
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();

  // --- Auto biometric unlock: fires on its own, no button tap ------------
  // The CDP virtual authenticator auto-satisfies user verification, so the
  // on-mount auto-trigger unlocks without interaction (real Android Chrome
  // behaves the same; iOS Safari would need the button - see ScreenAuth).
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 30_000 });
  await dismissReleaseNotes(page);

  // --- Revoked elsewhere: server row gone -> honest message + fallback ----
  // Via the shared helper, not the sqlite3 CLI - that binary is an undeclared
  // system dependency the mini-PC runner does not have (spawnSync ENOENT).
  execSql("DELETE FROM user_bio_keys;");
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByText("Enter your password to unlock")).toBeVisible({ timeout: 30_000 });

  // The prefetch discovers the 404 and withdraws the button (marker cleared).
  // The button may vanish at any point - including between an isVisible check
  // and a click (this raced in CI: the click strict-waits on a detaching
  // element and times out). So: try one best-effort short click, tolerate every
  // failure mode, and assert only the invariant - the button ends up hidden.
  // (The click-first path additionally surfaces the honest revoked message,
  // but the withdraw-first path never shows one, so it can't be asserted.)
  const bioButton = page.getByRole("button", { name: BIO_BUTTON });
  await bioButton.click({ timeout: 2000 }).catch(() => {});
  await expect(bioButton).toBeHidden({ timeout: 15_000 });

  // Password fallback still unlocks.
  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 30_000 });
});

test("lost passkey (Pixel class): streak -> hint -> password -> repair card -> new passkey works", async ({
  page,
}) => {
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page);

  const creds = { email: freshEmail("biolost"), password: "bio-lost-pass-123" };
  await registerAndVerify(page, creds);
  await login(page, creds);
  await dismissReleaseNotes(page);

  // Enroll on this "device".
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Account" }).click();
  await page.getByRole("button", { name: "Enable on this device" }).click();
  await expect(page.getByText("Enabled on this device", { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // The Pixel scenario: the OS update deletes the passkey - the authenticator
  // is still there, the credential is gone, our marker and the server wrap
  // survive untouched.
  await cdp.send("WebAuthn.clearCredentials", { authenticatorId });

  // Lock and try to unlock with the (dead) passkey. Each attempt rejects with
  // NotAllowedError - indistinguishable from a cancel, silently swallowed
  // before this fix. Two failures reach the streak threshold.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  const bioButton = page.getByRole("button", { name: BIO_BUTTON });
  await expect(bioButton).toBeVisible({ timeout: 30_000 });
  const hint = page.getByText("Passkey not working?", { exact: false });
  for (let i = 0; i < 3 && !(await hint.isVisible()); i++) {
    await bioButton.click();
    await page.waitForTimeout(400); // let the rejected get() settle
  }
  await expect(hint).toBeVisible({ timeout: 10_000 });

  // The hint's promise: password unlock, then the repair offer.
  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  // exact: true - the biometric button is (correctly) still on the screen and
  // also matches /Unlock/.
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 30_000 });
  await dismissReleaseNotes(page);

  // The unlock returned to /settings (where the lock happened) - the repair
  // offer lives on the dashboard, the screen a returning user actually lands on.
  await page.goto("/dashboard");
  await expect(page.getByText("Your passkey seems to be gone")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Create a new passkey" }).click();
  await expect(page.getByText("the new passkey unlocks QUON", { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  // And the new passkey actually unlocks: lock again -> auto-unlock fires (the
  // streak was cleared, so auto-fire is re-enabled).
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 30_000 });
});
