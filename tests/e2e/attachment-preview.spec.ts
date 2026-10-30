import { test, expect, type Locator } from "@playwright/test";

import { clickSend, login, openChat, reviewCreds, sharedCreds } from "./helpers/account";

/**
 * Issue #72: "im Chat bitte auch das PDF-Preview zum manuellen Prüfen und
 * Schwärzen" — before a staged attachment leaves the device, the user can
 * open it in the real viewer from the composer chip (Filter mode, not just
 * Review), see what the filter finds, and redact by hand.
 *
 * A fresh upload has no library DocItem, so a redaction made there is
 * PER-SEND: it must ride into THIS send's enforced `always_redact` (verified
 * by scrubText) and the wire must not carry the value. Both are asserted at
 * the request boundary — what actually left, not what the UI claimed.
 *
 * Synthetic value: a made-up case code, not personal data.
 */
const SECRET = "Vorgangscode Q7TR41";

async function selectInside(container: Locator, value: string) {
  await container.evaluate((el, needle) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent?.indexOf(needle) ?? -1;
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + needle.length);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
    }
    throw new Error("value not found in the viewer");
  }, value);
}

test("a hand-redaction in the staged attachment's preview is enforced on that send", async ({
  page,
}) => {
  const scrubBodies: string[] = [];
  let streamBody = "";
  await page.route("**/scrub", async (route) => {
    scrubBodies.push(route.request().postData() ?? "");
    await route.continue();
  });
  await page.route("**/chat/stream", async (route) => {
    streamBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Alles klar." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  await page.setInputFiles('input[type="file"]', {
    name: "notiz.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(
      `Interne Notiz.\nDer ${SECRET} darf nicht nach außen.\nSonst nichts Persönliches.`,
      "utf-8",
    ),
  });
  const staged = page.getByTestId("staged-attachment");
  await expect(staged).toContainText("notiz.txt", { timeout: 60_000 });

  // The chip opens the REAL viewer — in Filter mode, before any send.
  await page.getByTestId("attachment-preview").click();
  const viewer = page.getByRole("dialog").filter({ hasText: "notiz.txt" });
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  // …and says up front what a redaction here is worth: this message only.
  await expect(viewer.getByTestId("attachment-preview-hint")).toBeVisible();
  await expect(viewer.getByText(new RegExp(SECRET))).toBeVisible();

  await selectInside(viewer, SECRET);
  // The button promises the SEND scope, not "always" — a fresh upload has no
  // document to save on, and the copy must not claim otherwise.
  await page
    .getByRole("button", { name: /In dieser Nachricht schwärzen|Redact in this message/i })
    .click();
  await expect(
    viewer.getByText(/in dieser Nachricht geschwärzt|redacted in this message/i),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Immer schwärzen|Always redact/i })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  await page.getByPlaceholder(/Ask anything|Frag alles/).fill("Worum geht es in der Notiz?");
  await clickSend(page);
  await expect(page.getByText("Alles klar.")).toBeVisible({ timeout: 60_000 });

  // The term reached the scrubber as an ENFORCED always-redact entry…
  // (`/scrub` carries its options nested: `{ text, options: { always_redact } }`.)
  const enforced = scrubBodies
    .map((b) => {
      try {
        return JSON.parse(b) as { options?: { always_redact?: string[] } };
      } catch {
        return {};
      }
    })
    .filter((b) => (b.options?.always_redact ?? []).includes(SECRET));
  expect(scrubBodies.length).toBeGreaterThan(0);
  expect(enforced.length).toBeGreaterThan(0);
  // …and the wire is clean.
  expect(streamBody.length).toBeGreaterThan(0);
  expect(streamBody).not.toContain(SECRET);
});

test("a freshly uploaded PDF previews as rendered pages, not just text", async ({ page }) => {
  await login(page, sharedCreds());
  await openChat(page);

  await page.setInputFiles('input[type="file"]', "tests/e2e/fixtures/sample.pdf");
  const staged = page.getByTestId("staged-attachment");
  await expect(staged).toContainText("sample.pdf", { timeout: 60_000 });

  await page.getByTestId("attachment-preview").click();
  const viewer = page.getByRole("dialog").filter({ hasText: "sample.pdf" });
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  // The Original/Text toggle only exists when the viewer HAS the bytes — the
  // proof that the composer kept them for a file that has no library item.
  await expect(viewer.getByRole("button", { name: "Original", exact: true })).toBeVisible();
  await expect(viewer.locator("canvas").first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  // Closing the preview leaves the attachment staged.
  await expect(staged).toContainText("sample.pdf");
});

/**
 * Review mode, same ad-hoc upload: "Original ansehen & schwärzen" used to be
 * offered only for a single library document. Now every attachment opens, and
 * a per-send redaction chosen in the viewer must be folded into the Review
 * panel's items on close — the attachment's scrub already ran, so a term that
 * only reached `always_redact` would bind nothing on THIS send.
 *
 * Own account (reviewCreds), like document-redact.spec.ts: a Review flag left
 * on the shared account stalls every direct-send spec at the approval panel.
 */
test("in Review, a per-send redaction from the ad-hoc preview is applied on close", async ({
  page,
}) => {
  let streamBody = "";
  await page.route("**/chat/stream", async (route) => {
    streamBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Verstanden." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, reviewCreds());
  await page.goto("/chat");
  // State-aware: the review account may already have Review on from a prior run.
  const reviewPill = page.getByRole("button", { name: "Review", exact: true });
  await expect(reviewPill).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if ((await reviewPill.getAttribute("aria-pressed")) !== "true") {
      await reviewPill.click();
      await page.waitForTimeout(250);
    }
    expect(await reviewPill.getAttribute("aria-pressed")).toBe("true");
  }).toPass({ timeout: 20_000 });

  await page.setInputFiles('input[type="file"]', {
    name: "notiz.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(`Interne Notiz.\nDer ${SECRET} darf nicht nach außen.\n`, "utf-8"),
  });
  await expect(page.getByTestId("staged-attachment")).toContainText("notiz.txt", {
    timeout: 60_000,
  });
  await page.getByPlaceholder(/Ask anything|Frag alles/).fill("Worum geht es in der Notiz?");
  await clickSend(page);

  // The Review panel offers the viewer for an AD-HOC upload now.
  await page.getByRole("button", { name: /Original ansehen|View original/i }).click();
  const viewer = page.getByRole("dialog").filter({ hasText: "notiz.txt" });
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  await expect(viewer.getByTestId("attachment-preview-hint")).toBeVisible();
  await selectInside(viewer, SECRET);
  await page
    .getByRole("button", { name: /In dieser Nachricht schwärzen|Redact in this message/i })
    .click();
  await expect(
    viewer.getByText(/in dieser Nachricht geschwärzt|redacted in this message/i),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // Send from Review without touching anything else: the close reconciled the
  // term into the panel's items, so the wire is clean.
  await page.getByRole("button", { name: /Send to|An .* senden/i }).click();
  await expect(page.getByText("Verstanden.").first()).toBeVisible({ timeout: 60_000 });
  expect(streamBody.length).toBeGreaterThan(0);
  expect(streamBody).not.toContain(SECRET);
});
