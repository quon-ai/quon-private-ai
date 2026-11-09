import { test, expect } from "@playwright/test";

import { login, purgeAccountBlobs, sharedCreds } from "./helpers/account";

// Memory CRUD via the dialog form (ScreenMemory), all on-device + E2E-encrypted.
// Add -> edit (pencil reopens the form prefilled) -> delete, plus the Markdown-aware
// rendering path (looksLikeMarkdown -> <strong>). Content is made unique per run so
// the serial shared account can't collide with a previous run's items.
test("add, edit and delete a memory; Markdown text renders bold", async ({ page }) => {
  test.slow(); // first on-device embed (add/edit re-embeds) can download the model

  await login(page, sharedCreds());
  await page.goto("/memory");

  const tag = Date.now();
  const original = `Ich trinke Kaffee schwarz ${tag}`;
  const edited = `Ich trinke Kaffee mit Hafermilch ${tag}`;

  // --- Add: Save must close the dialog (the first save may load the embedder, so
  // wait generously; a still-open modal aria-hides the page and breaks later roles).
  await page.getByRole("button", { name: "Add Memory" }).click();
  await page.getByPlaceholder("What should QUON remember?").fill(original);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 90_000 });
  const card = page
    .locator("div")
    .filter({ hasText: original })
    .filter({ has: page.getByRole("button", { name: "Edit memory" }) })
    .last();
  await expect(card).toBeVisible({ timeout: 30_000 });

  // --- Edit: the pencil reopens the dialog PREFILLED with the current text.
  await card.getByRole("button", { name: "Edit memory" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const textarea = dialog.getByPlaceholder("What should QUON remember?");
  await expect(textarea).toHaveValue(original);
  await textarea.fill(edited);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.getByText(edited).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(original)).toHaveCount(0);

  // --- Delete: the trash button removes the item immediately (no confirm dialog).
  const editedCard = page
    .locator("div")
    .filter({ hasText: edited })
    .filter({ has: page.getByRole("button", { name: "Delete memory" }) })
    .last();
  await editedCard.getByRole("button", { name: "Delete memory" }).click();
  await expect(page.getByText(edited)).toHaveCount(0, { timeout: 30_000 });

  // --- Markdown path: "**wichtig** dringend" renders <strong>wichtig</strong>
  // (looksLikeMarkdown -> Markdown component), not raw asterisks.
  const md = `**wichtig${tag}** dringend`;
  await page.getByRole("button", { name: "Add Memory" }).click();
  await page.getByPlaceholder("What should QUON remember?").fill(md);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 90_000 });
  await expect(page.locator("strong").filter({ hasText: `wichtig${tag}` })).toBeVisible({
    timeout: 30_000,
  });

  // CLEAN UP - this spec previously left the markdown memory behind FOREVER,
  // a standing residue producer on the shared account (any leftover memory
  // pushes every later chat-send spec through embedder init + a context
  // scrub). Delete it, then wait for the tombstones to actually reach the
  // server - a UI delete alone races the context close (see awaitServerCleanup).
  const mdCard = page
    .locator("div")
    .filter({ hasText: `wichtig${tag}` })
    .filter({ has: page.getByRole("button", { name: "Delete memory" }) })
    .last();
  await mdCard.getByRole("button", { name: "Delete memory" }).click();
  await expect(page.locator("strong").filter({ hasText: `wichtig${tag}` })).toHaveCount(0, {
    timeout: 30_000,
  });
  purgeAccountBlobs("memory", sharedCreds().email);
});
