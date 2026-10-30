import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

// Two features: (1) an uploaded document is viewable, and (2) the chat attach button
// can pull an existing document from the store (not just upload a fresh file).
// The account is shared across browser projects (and other specs upload too), so the
// filename is made unique per project and every locator is scoped to it.
test("uploaded document is viewable, and attachable from the chat store", async ({
  page,
}, testInfo) => {
  const fname = `tropics-${testInfo.project.name}.txt`;
  await login(page, sharedCreds());

  // --- upload a small text document and wait until THIS one is indexed (ready) ---
  await page.goto("/documents");
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(
      "Mango and papaya are tropical fruits enjoyed across many cuisines worldwide.",
    ),
  });
  // The row's button carries the filename + status in its accessible name.
  const docRow = page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) });
  await expect(docRow).toBeVisible({ timeout: 120_000 });

  // --- Feature 1: click the document → the viewer shows its extracted text ---
  await docRow.click();
  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText(/tropical fruits/i)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();

  // --- Feature 2: chat attach button offers "from your documents" ---
  await page.goto("/chat");
  await page.getByRole("button", { name: "Attach a document" }).click();
  await expect(page.getByText("Upload from device")).toBeVisible();
  await page.getByText("Choose from Documents").click();

  // the picker lists the indexed document; ticking it and confirming stages it
  const picker = page.getByRole("dialog");
  await expect(picker.getByText(fname)).toBeVisible();
  await picker.getByText(fname).click();
  await picker.getByRole("button", { name: "Attach", exact: true }).click();
  await expect(picker).toBeHidden();

  // the composer now shows the staged attachment chip with its remove control
  await expect(page.getByRole("button", { name: "Remove attachment" })).toBeVisible();
});

// Several documents can be attached in one go ("compare these two offers"). The
// picker used to stage exactly one and close on the first tap, so a second file
// was simply not reachable. Multiple picks are combined into ONE attachment that
// then walks the identical scrub-before-send path.
test("the document picker attaches several documents at once", async ({ page }, testInfo) => {
  test.slow(); // two documents to index

  const stamp = `${Date.now()}_${testInfo.project.name}`;
  const a = `angebot-a-${stamp}.txt`;
  const b = `angebot-b-${stamp}.txt`;
  await login(page, sharedCreds());

  await page.goto("/documents");
  await page.setInputFiles('input[type="file"]', [
    { name: a, mimeType: "text/plain", buffer: Buffer.from("Angebot A: 1200 Euro pro Jahr.") },
    { name: b, mimeType: "text/plain", buffer: Buffer.from("Angebot B: 980 Euro pro Jahr.") },
  ]);
  await expect(page.getByRole("button", { name: new RegExp(`${a}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });
  await expect(page.getByRole("button", { name: new RegExp(`${b}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });

  await page.goto("/chat");
  await page.getByRole("button", { name: "Attach a document" }).click();
  await page.getByText("Choose from Documents").click();

  const picker = page.getByRole("dialog");
  await picker.getByText(a).click();
  await picker.getByText(b).click();
  // The button counts what is selected — the user sees both are coming along.
  const confirm = picker.getByRole("button", { name: "Attach 2 documents" });
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(picker).toBeHidden();

  // One combined chip, not one-of-two.
  await expect(page.getByText("2 documents")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove attachment" })).toBeVisible();
});

// A document's filename is just a label: renaming must stick (and sync) without
// touching its chunks/embeddings — scanned files land as "scan_0001.pdf" and are
// unfindable until the user can name them.
test("a document can be renamed in place", async ({ page }, testInfo) => {
  test.slow();

  const stamp = `${Date.now()}_${testInfo.project.name}`;
  const before = `scan-${stamp}.txt`;
  const after = `Mietvertrag ${stamp}.txt`;
  await login(page, sharedCreds());

  await page.goto("/documents");
  await page.setInputFiles('input[type="file"]', {
    name: before,
    mimeType: "text/plain",
    buffer: Buffer.from("Der Mietvertrag beginnt am 1. Oktober."),
  });
  await expect(page.getByRole("button", { name: new RegExp(`${before}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });

  // The row is located by its (still visible) filename; once editing starts the
  // name becomes an input, so the edit form is addressed directly from there on.
  await page
    .locator("div.rounded-xl")
    .filter({ has: page.getByText(before, { exact: true }) })
    .first()
    .getByRole("button", { name: "Rename" })
    .click();
  const editor = page.locator("form").filter({ has: page.getByLabel("Document name") });
  await editor.getByLabel("Document name").fill(after);
  await editor.getByRole("button", { name: "Save" }).click();

  await expect(page.getByRole("button", { name: new RegExp(`${after}.*Indexed`) })).toBeVisible();
  await expect(page.getByText(before, { exact: true })).toHaveCount(0);

  // It survives a reload — the rename was persisted, not just local component state.
  await page.reload();
  await expect(page.getByText(after, { exact: true })).toBeVisible({ timeout: 60_000 });
});
