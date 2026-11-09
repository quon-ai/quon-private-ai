import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

// Real-layout document viewer for Markdown (DocumentViewer -> MarkdownOriginal):
// a .md doc renders its "Original" view through the Markdown component (a real
// heading element), while the "Text" toggle shows the raw extracted "# Titel".
test("a Markdown document renders a heading in Original view and raw text in Text view", async ({
  page,
}, testInfo) => {
  test.slow(); // document indexing embeds on-device

  await login(page, sharedCreds());
  await page.goto("/documents");

  const fname = `notes-${testInfo.project.name}-${Date.now()}.md`;
  const heading = `Titel Überschrift ${Date.now()}`;
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/markdown",
    buffer: Buffer.from(`# ${heading}\n\nEtwas Fließtext darunter.`),
  });

  const docRow = page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) });
  await expect(docRow).toBeVisible({ timeout: 120_000 });
  await docRow.click();

  const viewer = page.getByRole("dialog");
  await expect(viewer).toBeVisible();

  // Original view (the default) renders the "#" line as a real heading element -
  // Not raw markdown text.
  await expect(viewer.getByRole("heading", { name: heading })).toBeVisible({ timeout: 30_000 });

  // Toggle to Text -> the raw extracted markdown ("# ...") is shown verbatim.
  await viewer.getByRole("button", { name: "Text", exact: true }).click();
  await expect(viewer.getByText(`# ${heading}`)).toBeVisible();
  await expect(viewer.getByRole("heading", { name: heading })).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
});
