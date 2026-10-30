import { test, expect, type Page } from "@playwright/test";

import { clickSend, login, reviewCreds } from "./helpers/account";

/**
 * Durable PER-DOCUMENT hand-redaction, proven at the wire.
 *
 * The chain: upload into the library → attach from the library → Review mode →
 * select a value → "Immer schwärzen" (saves ON the DocItem, not the global
 * list) → this send's wire is clean — and then the REAL durability proof: a
 * SECOND send of the same document with no manual step is clean too, because
 * the document's saved terms merge into always_redact and scrubText enforces
 * them.
 *
 * The value is one the harness backend (LLM off) provably cannot detect on its
 * own — bare letters+digits, no format — otherwise this would prove detection,
 * not the saved term.
 */
const SECRET = "Vorgangscode Q7TR41";

async function attachFromLibrary(page: Page, fname: string) {
  await page.getByRole("button", { name: "Attach a document" }).click();
  await page.getByText("Choose from Documents").click();
  const picker = page.getByRole("dialog");
  await picker.getByText(fname).click();
  await picker.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(picker).toBeHidden();
}

test("a saved document redaction constrains every send of that document", async ({
  page,
}, testInfo) => {
  test.slow();

  const fname = `notiz-${testInfo.project.name}.txt`;
  let lastStreamBody = "";
  await page.route("**/chat/stream", async (route) => {
    lastStreamBody = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Verstanden." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  // reviewCreds, NOT sharedCreds: this spec turns Review mode ON, and the
  // protection level SYNCS (prefs blob) — on the shared account it leaked into
  // every later spec, whose sends then stalled at the approval panel. The
  // review-mode account exists precisely so a leftover Review can reach no one.
  await login(page, reviewCreds());

  // --- into the library, so there is a DocItem to save the term on ---
  await page.goto("/documents");
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(
      `Interne Notiz.\nDer ${SECRET} darf nicht nach außen.\nSonst nichts Persönliches.`,
      "utf-8",
    ),
  });
  await expect(page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });

  // --- send 1: Review mode, hand-redact durably ---
  await page.goto("/chat");
  // State-aware: the review account may already have Review on from a prior run.
  const reviewPill = page.getByRole("button", { name: /^Review$/i });
  if ((await reviewPill.getAttribute("aria-pressed")) !== "true") {
    await reviewPill.click();
  }
  await attachFromLibrary(page, fname);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Worum geht es in der Notiz?");
  await clickSend(page);

  await page.getByText(/Show document content|Dokumentinhalt/i).click();
  const preview = page.locator("pre, div").filter({ hasText: SECRET }).last();
  await expect(preview).toBeVisible({ timeout: 30_000 });
  await preview.evaluate((el, value) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const i = node.textContent?.indexOf(value) ?? -1;
      if (i >= 0) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + value.length);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
    }
    throw new Error("value not found in preview");
  }, SECRET);

  // The "view original & redact" button must OPEN the real viewer. This click
  // is load-bearing: the button once shipped visible but dead — the dialog
  // render was never mounted (a guarded insert matched a comment), and no test
  // clicked it, so it reached production. Reported by the user, not a test.
  await page.getByRole("button", { name: /Original ansehen|View original/i }).click();
  const viewer = page.getByRole("dialog").filter({ hasText: fname });
  await expect(viewer).toBeVisible({ timeout: 15_000 });
  await expect(viewer.getByText(new RegExp(SECRET))).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  await page.getByRole("button", { name: /Immer schwärzen|Always redact/i }).click();
  // Confirmation names the DOCUMENT scope — proof the resolver ran and where it saved.
  await expect(page.getByText(/gespeichert|saved on this document/i)).toBeVisible();

  await page.getByRole("button", { name: /Send to|An .* senden/i }).click();
  await expect(page.getByText("Verstanden.").first()).toBeVisible({ timeout: 60_000 });
  expect(lastStreamBody).not.toContain(SECRET);

  // --- send 2: same document, NO manual step. This is what "durable" means. ---
  lastStreamBody = "";
  await attachFromLibrary(page, fname);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Und noch einmal bitte.");
  await clickSend(page);

  // Review opens again; send without touching anything.
  await page.getByRole("button", { name: /Send to|An .* senden/i }).click();
  await expect(page.getByText("Verstanden.").nth(1)).toBeVisible({ timeout: 60_000 });

  // …and the wire is clean without anyone touching a selection.
  expect(lastStreamBody).not.toContain(SECRET);
  expect(lastStreamBody.length).toBeGreaterThan(0);
});
