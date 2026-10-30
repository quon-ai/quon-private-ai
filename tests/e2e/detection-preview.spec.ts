import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * Detection preview in the document viewer (feedback #55): "Ich habe nicht das
 * ganze Dok im Kopf und kann [nicht] sagen, ob er alles erwischt hat" — the
 * hits must be painted INTO the document, not listed beside it.
 *
 * The harness backend runs with LLM enrichment off, so the assertions target
 * the deterministic regex tier (EMAIL) — the flow (button → scrub → marks in
 * place → toggle off removes them) is identical for every entity type.
 */
test("the viewer marks detected values in place, and the toggle removes them", async ({
  page,
}, testInfo) => {
  const fname = `detect-${testInfo.project.name}.txt`;
  await login(page, sharedCreds());

  await page.goto("/documents");
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Rechnung bitte an billing-preview@example.org senden. Der Rest des Textes ist harmlos.",
    ),
  });
  const docRow = page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) });
  await expect(docRow).toBeVisible({ timeout: 120_000 });
  await docRow.click();

  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  // Plain text docs open in the text view; the email is visible but unmarked.
  await expect(viewer.getByText(/billing-preview@example\.org/)).toBeVisible();
  expect(await viewer.locator("mark[data-quon-hit]").count()).toBe(0);

  // Run the preview: the same filter a send would use, painted in place.
  await viewer.getByRole("button", { name: /Show detection/ }).click();
  const mark = viewer.locator('mark[data-quon-hit="EMAIL"]');
  await expect(mark).toHaveText("billing-preview@example.org", { timeout: 60_000 });
  // The count line tells the user what "marked" means.
  await expect(viewer.getByText(/values? marked|Werte? markiert/)).toBeVisible();

  // …and, since #70/#71, WHAT THEY CAN DO with the marks. The feature was
  // "found more by accident": the toggle was a bare icon whose only
  // explanation was a `title` (invisible on touch), and nothing said the marks
  // are interactive. Both are asserted here so they cannot quietly regress.
  await expect(viewer.getByTestId("detect-toggle")).toContainText(/Detection|Erkennung/);
  await expect(viewer.getByTestId("detect-result")).toContainText(
    /Select any text|Markier eine Stelle/,
  );

  // Toggle off → the document renders clean again, text unchanged.
  await viewer.getByRole("button", { name: /Show detection/ }).click();
  await expect(viewer.locator("mark[data-quon-hit]")).toHaveCount(0);
  await expect(viewer.getByText(/billing-preview@example\.org/)).toBeVisible();
});

// A false positive must cost ONE click to undo, and the undo is value-keyed
// like the detection: clicking one occurrence clears every occurrence. The
// value lands on the device's never-redact list, which Settings renders as an
// editable textarea — an invisible allow-list would be a leak with a nice UI.
test("a detected value can be dismissed in one click and stays dismissed", async ({
  page,
}, testInfo) => {
  test.slow();

  await login(page, sharedCreds());
  await page.goto("/documents");

  const fname = `dismiss-${testInfo.project.name}-${Date.now()}.txt`;
  const email = `dismiss-me-${Date.now()}@example.org`;
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(
      // The value appears TWICE on purpose: one dismissal must clear both.
      `Bitte an ${email} senden. Rueckfragen ebenfalls an ${email} richten.`,
    ),
  });
  const docRow = page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) });
  await expect(docRow).toBeVisible({ timeout: 120_000 });
  await docRow.click();

  const viewer = page.getByRole("dialog");
  await viewer.getByRole("button", { name: /Show detection/ }).click();

  const marks = viewer.locator('mark[data-quon-hit="EMAIL"]');
  await expect(marks.first()).toHaveText(email, { timeout: 60_000 });
  expect(await marks.count()).toBe(2); // both occurrences painted

  // One click on either occurrence clears them all — no re-scrub, no reload.
  await marks.first().click();
  await expect(viewer.locator('mark[data-quon-hit="EMAIL"]')).toHaveCount(0);
  // The text itself is untouched; only the marking went away.
  await expect(
    viewer.getByText(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
  ).toBeVisible();

  // It is remembered on the device: Settings shows it in the never-redact list.
  await page.keyboard.press("Escape");
  await page.goto("/settings");
  await expect(page.getByRole("textbox", { name: /Never redact|Nie schwärzen/i })).toHaveValue(
    new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});
