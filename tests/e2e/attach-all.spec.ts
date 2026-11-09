import { test, expect, type Page } from "@playwright/test";

import { clickSend, login, sharedCreds } from "./helpers/account";

// "Attach all documents" (src/lib/attachAll.ts + ScreenChat.handleAttachAllDocs):
// the paperclip menu can stage every in-scope ready document as one combined
// attachment. We scope to a fresh project so the "(2)" count is deterministic
// regardless of what other specs uploaded to the shared account, then assert both
// documents' "=== Document:" headers reach the relay in the system attachment turn.

test("paperclip 'Attach all' combines both project docs into one attachment turn", async ({
  page,
}, testInfo) => {
  test.slow(); // two on-device embeddings (document indexing) can be genuinely slow

  const bodies: string[] = [];
  await page.route("**/chat/stream", async (route) => {
    bodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "ok" })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());

  // Fresh project so its document scope holds exactly the two we upload.
  const projectName = `AttachAll ${testInfo.project.name} ${Date.now()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();
  // Create navigates to the detail view; grab the project id from the URL for /chat?p=.
  await expect(page).toHaveURL(/\/projects\?id=/, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("id")!;
  expect(projectId).toBeTruthy();

  // The embedded ScreenDocuments (and its file input) lives on the Content tab.
  await page.getByRole("tab", { name: "Content" }).click();

  // Upload two small text docs into the project (embedded ScreenDocuments tags them
  // with this projectId). Distinctive content so we can prove both crossed the wire.
  const aName = `alpha-${Date.now()}.txt`;
  const bName = `bravo-${Date.now()}.txt`;
  // :not([accept="image/*"]) - the photo-scan input (image-only) sits next to
  // the document input since the OCR feature; target the document one.
  const fileInput = page.locator('input[type="file"]:not([accept="image/*"])');
  await fileInput.setInputFiles({
    name: aName,
    mimeType: "text/plain",
    buffer: Buffer.from("Alpha document about mango harvesting seasons across the tropics."),
  });
  await expect(page.getByRole("button", { name: new RegExp(`${aName}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });
  await fileInput.setInputFiles({
    name: bName,
    mimeType: "text/plain",
    buffer: Buffer.from("Bravo document about papaya storage and ripening logistics."),
  });
  await expect(page.getByRole("button", { name: new RegExp(`${bName}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });

  // Open a chat scoped to this project -> its readyDocs are exactly the two above.
  await page.goto(`/chat?p=${projectId}`);
  await page.getByRole("button", { name: "Attach a document" }).click();
  await expect(page.getByText("Attach all documents (2)")).toBeVisible({ timeout: 10_000 });
  await page.getByText("Attach all documents (2)").click();

  // The combined attachment stages as a single chip named for the count.
  await expect(page.getByText("All documents (2 files)")).toBeVisible({ timeout: 30_000 });

  // Send (protection on by default) - assert the wire body carries both document
  // headers in the system attachment turn (content here is non-PII, so it survives
  // the scrub intact; the placeholder guarantee is covered by the review/scrub specs).
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Vergleiche die Dokumente");
  await clickSend(page);

  // The relay fires once the on-device attachment scrub finishes; assert both
  // document headers reach the wire in the (single) system attachment turn.
  await expect(async () => {
    const outgoing = bodies.at(-1) ?? "";
    expect(outgoing).toContain(`=== Document: ${aName} ===`);
    expect(outgoing).toContain(`=== Document: ${bName} ===`);
  }).toPass({ timeout: 30_000 });
});
