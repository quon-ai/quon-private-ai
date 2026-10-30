import { test, expect } from "@playwright/test";

import { login, registerAndVerify, type Creds } from "./helpers/account";

/**
 * "Learn from documents" (memoryFromDocuments.runDocumentMemorySweep +
 * LearnFromDocumentsButton + the review queue in ScreenMemory). Same
 * zero-knowledge pipeline as the chat sweep: the document text is scrubbed
 * on-device, only placeholders reach the relay, the reply is re-hydrated
 * locally and lands in the review queue — never straight in Memory.
 *
 * Driven in a project so scope isolation is exercised: upload one document,
 * mock the extraction reply, run the sweep, Keep the fact into project memory.
 * Fresh account so the queue and the per-document cursors start clean.
 */
const uniq = () => `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

test("Learn from documents mines a project document into a kept memory", async ({ page }) => {
  test.slow(); // register + Argon2 login + document indexing + on-device embed

  const creds: Creds = { email: `docmem-${uniq()}@quon.test`, password: "e2e-password-123456" };
  const factText = `Versichert bei der Nordsee Kasse ${Date.now()}`;
  let extractionCalls = 0;

  // Non-stream extraction call (chatComplete → POST /chat). Only the API POST is
  // intercepted — the frontend's GET /chat navigation shares the path.
  await page.route(/\/chat(\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    extractionCalls += 1;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      // Deliberately mixed: an unkeyed SUMMARY (must be dropped by the quality
      // gate) plus one keyed durable fact (must survive).
      body: JSON.stringify({
        answer: JSON.stringify([
          { kind: "note", text: "Das Schreiben bestaetigt den Versicherungsschutz." },
          { key: "Krankenkasse", text: factText, tags: ["gesundheit"] },
        ]),
        model: "mock",
      }),
    });
  });

  await registerAndVerify(page, creds);
  await login(page, creds);

  const projectName = `Versicherung ${uniq()}`;
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByPlaceholder(/Project name/).fill(projectName);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/projects\?id=/, { timeout: 30_000 });
  const projectId = new URL(page.url()).searchParams.get("id")!;

  // Upload a document into the project, long enough to clear MIN_DOC_CHARS.
  const fname = `police-${uniq()}.txt`;
  const body =
    "Sehr geehrte Kundin, hiermit bestaetigen wir Ihren Versicherungsschutz. " +
    "Der Vertrag laeuft unbefristet und verlaengert sich jaehrlich automatisch. " +
    "Bitte bewahren Sie dieses Schreiben zusammen mit den Vertragsunterlagen auf.";
  expect(body.length).toBeGreaterThan(200);
  await page.goto(`/projects?id=${projectId}`);
  await page.getByRole("tab", { name: "Content" }).click();
  await page.setInputFiles('input[type="file"]', {
    name: fname,
    mimeType: "text/plain",
    buffer: Buffer.from(body),
  });
  await expect(page.getByRole("button", { name: new RegExp(`${fname}.*Indexed`) })).toBeVisible({
    timeout: 120_000,
  });

  // Run the sweep from the project overview.
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: /Learn from documents/ }).click();
  await page.getByRole("tab", { name: "Content" }).click();

  // The keyed fact reaches the review queue…
  await expect(page.getByText(/Suggested for your memory/)).toBeVisible({ timeout: 120_000 });
  const card = page
    .locator("div")
    .filter({ hasText: factText })
    .filter({ has: page.getByRole("button", { name: "Keep" }) })
    .last();
  await expect(card).toBeVisible({ timeout: 30_000 });
  // …carrying its source document, and the unkeyed summary was dropped.
  await expect(card.getByText(fname)).toBeVisible();
  await expect(page.getByText(/bestaetigt den Versicherungsschutz/)).toHaveCount(0);

  await card.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByText(/Suggested for your memory/)).toHaveCount(0, { timeout: 30_000 });

  const memCard = page
    .locator("div")
    .filter({ hasText: factText })
    .filter({ has: page.getByRole("button", { name: "Edit memory" }) })
    .last();
  await expect(memCard).toBeVisible({ timeout: 30_000 });

  // A second run costs nothing: the document was analysed at this version.
  const before = extractionCalls;
  await page.getByRole("tab", { name: "Overview" }).click();
  await page.getByRole("button", { name: /Learn from documents/ }).click();
  await expect(page.getByText(/Nothing new|No .* to learn from|Nichts/i).first()).toBeVisible({
    timeout: 60_000,
  });
  expect(extractionCalls).toBe(before);
});
