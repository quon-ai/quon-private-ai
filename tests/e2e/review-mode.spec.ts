import { test, expect, type Page } from "@playwright/test";
import { withSyncPush } from "./helpers/sync";

import { clickSend, login, reviewCreds } from "./helpers/account";

/** Ensure Review mode is ON — deterministically. The protection level is a
 *  SYNCED pref, so an earlier test in this file leaves "review" on the server
 *  and the fresh page's initial sync pull races a blind click on the toggle —
 *  pull-first meant the click switched Review OFF again and the send went out
 *  un-reviewed (the chronic flake in this file). So: check the pressed state,
 *  click only when off, and always wait for pressed=true; the click bumps
 *  prefsUpdatedAt, so a late-arriving older blob can't revert it (LWW gate in
 *  quonStore.applyRemotePrefs). */
async function ensureReviewMode(page: Page): Promise<void> {
  const pill = page.getByRole("button", { name: "Review", exact: true });
  await expect(pill).toBeVisible();
  // A single click can still get lost in the fresh page's hydration window
  // (handler not yet live, or the initial pull applying concurrently) — seen
  // once on webkit under retries:0: click fired, pressed stayed "false" for
  // 20s. State-based retry: re-click until pressed actually sticks; the LWW
  // gate (prefsUpdatedAt bump per click) keeps late older blobs from
  // reverting a click that DID land.
  await expect(async () => {
    if ((await pill.getAttribute("aria-pressed")) !== "true") {
      await pill.click();
      await page.waitForTimeout(250);
    }
    expect(await pill.getAttribute("aria-pressed")).toBe("true");
  }).toPass({ timeout: 20_000 });
}

// Leave the account back in Filter mode. Belt-and-braces only since this file
// got its OWN account (reviewCreds): a leftover Review can no longer reach any
// other spec. Keep it anyway — it makes re-runs of THIS file start from a known
// state. Note this cleanup alone was never sufficient: `prefs` is a single
// synced blob, so a later pref write from a page holding a stale copy
// republishes the old protection level under a fresh timestamp (whole-blob
// LWW). That is exactly how Review used to leak into the next project and
// stall its first direct-send specs at the review panel — the chronic
// artifacts/attach-all/attach-large-scrub/attachment "timeouts".
// Best-effort (the page may be gone after a hard failure).
test.afterEach(async ({ page }) => {
  try {
    // ⚠️ Toggle REVIEW off — do not "ensure Filter pressed": in review mode the
    // Filter pill shows pressed TOO (review implies protection), so checking
    // Filter is a no-op exactly when the reset is needed.
    const review = page.getByRole("button", { name: "Review", exact: true });
    if (!(await review.isVisible({ timeout: 2000 }).catch(() => false))) return;
    if ((await review.getAttribute("aria-pressed")) === "true") {
      // The prefs push is DEBOUNCED (collectionSync, 1500ms) — closing the page
      // right after the click loses the write and the SERVER blob keeps Review
      // ON for the next project's pass. THIS leak is the one cited in
      // playwright.config.ts as the reason workers=2 is not the default, so the
      // listener has to be registered before the click, not after it.
      await withSyncPush(
        page,
        async () => {
          await review.click();
          await expect(review).toHaveAttribute("aria-pressed", "false");
        },
        { label: "review-mode cleanup" },
      );
    }
  } catch {
    /* best-effort — never fail the suite from cleanup */
  }
});

// Review mode: the user approves exactly what's sent. The detected PII is shown for
// review BEFORE anything leaves the device, and only the placeholder crosses the wire.
test("Review mode shows detected PII for approval, then sends only placeholders", async ({
  page,
}) => {
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Erledigt: [EMAIL_1]." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, reviewCreds());
  await page.goto("/chat");

  // Switch to Review, then send a message containing an email.
  await ensureReviewMode(page);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Schreib an chef@example.com bitte");
  await clickSend(page);

  // The review panel appears with the detected email — nothing sent yet.
  await expect(page.getByText(/Review before sending/)).toBeVisible({ timeout: 30_000 });
  // exact:true — the sidebar Recents entry for a prior run is titled with the
  // full message ("Schreib an chef@… bitte"), so a substring match is ambiguous
  // once chats accumulate on the shared account; only the review-panel value is
  // the bare email.
  await expect(page.getByText("chef@example.com", { exact: true })).toBeVisible();
  expect(outgoing).toBe("");

  // Approve → it sends; only the placeholder crosses the wire, answer re-hydrates.
  await page.getByRole("button", { name: /Send to/ }).click();
  await expect(page.getByText("Erledigt: chef@example.com.")).toBeVisible({ timeout: 30_000 });
  expect(outgoing).toContain("[EMAIL_1]");
  expect(outgoing).not.toContain("chef@example.com");
});

// Review must cover documents too, not just the typed message: an attached file's
// detected PII is shown for approval and stays redacted by default — only the
// placeholder leaves the device.
test("Review mode redacts an attached document's PII by default (placeholder on the wire)", async ({
  page,
}) => {
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Zusammengefasst." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, reviewCreds());
  await page.goto("/chat");
  await ensureReviewMode(page);

  // Attach a small text document that contains an email, plus a no-PII question.
  await page.setInputFiles('input[type="file"]', {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Bitte den Lieferanten unter kontakt@lieferant.de kontaktieren."),
  });
  await expect(page.getByText("notes.txt")).toBeVisible({ timeout: 30_000 });
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Fasse das Dokument zusammen");
  await clickSend(page);

  // The review panel lists the DOCUMENT's detected email with a per-hit toggle —
  // nothing has been sent yet.
  await expect(page.getByText(/Review before sending/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("kontakt@lieferant.de", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redacted" })).toBeVisible();
  expect(outgoing).toBe("");

  // Approve as-is → the document hit stays redacted: only the placeholder crosses the wire.
  await page.getByRole("button", { name: /Send to/ }).click();
  await expect(page.getByText("Zusammengefasst.")).toBeVisible({ timeout: 30_000 });
  expect(outgoing).toContain("[EMAIL_1]");
  expect(outgoing).not.toContain("kontakt@lieferant.de");
});

// The toggle must actually work for documents: un-redacting a document hit in Review
// sends its real value (parity with un-redacting a typed-message hit).
test("Review mode can un-redact a document hit, sending its real value", async ({ page }) => {
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Ok." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, reviewCreds());
  await page.goto("/chat");
  await ensureReviewMode(page);

  await page.setInputFiles('input[type="file"]', {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Bitte den Lieferanten unter kontakt@lieferant.de kontaktieren."),
  });
  await expect(page.getByText("notes.txt")).toBeVisible({ timeout: 30_000 });
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Fasse das Dokument zusammen");
  await clickSend(page);

  await expect(page.getByText(/Review before sending/)).toBeVisible({ timeout: 30_000 });
  // Flip the document's only hit to "Sending real", then approve.
  await page.getByRole("button", { name: "Redacted" }).click();
  await expect(page.getByRole("button", { name: "Sending real" })).toBeVisible();
  await page.getByRole("button", { name: /Send to/ }).click();

  await expect(page.getByText("Ok.")).toBeVisible({ timeout: 30_000 });
  // The user chose to reveal it → the real email crosses the wire and no orphan
  // placeholder is left behind.
  expect(outgoing).toContain("kontakt@lieferant.de");
  expect(outgoing).not.toContain("[EMAIL_1]");
});

// Manual redaction must reach document content too: text the detector missed can be
// selected in the collapsible full-text and blacked out by hand before sending.
test("Review mode can manually redact a document term the detector missed", async ({ page }) => {
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Ok." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, reviewCreds());
  await page.goto("/chat");
  await ensureReviewMode(page);

  // A codename the NER/regex net won't flag as PII — so only a manual redaction removes it.
  await page.setInputFiles('input[type="file"]', {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Internes Projekt bluebird-42 laeuft planmaessig."),
  });
  await expect(page.getByText("notes.txt")).toBeVisible({ timeout: 30_000 });
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Fasse das Dokument zusammen");
  await clickSend(page);

  await expect(page.getByText(/Review before sending/)).toBeVisible({ timeout: 30_000 });

  // Open the document's collapsible full text, select the codename, redact it by hand.
  const docDetails = page.locator("details", {
    hasText: "Show document content to redact manually",
  });
  await docDetails.locator("summary").click();
  const selected = await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const idx = node.textContent?.indexOf(needle) ?? -1;
      if (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + needle.length);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return true;
      }
    }
    return false;
  }, "bluebird-42");
  expect(selected).toBe(true);
  await docDetails.getByRole("button", { name: "Redact selection" }).click();

  // It now shows as a Manual item, and sending keeps it out of the wire (placeholder only).
  await expect(page.getByText("Manual", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Send to/ }).click();
  await expect(page.getByText("Ok.")).toBeVisible({ timeout: 30_000 });
  expect(outgoing).toContain("[REDACTED_1]");
  expect(outgoing).not.toContain("bluebird-42");
});
