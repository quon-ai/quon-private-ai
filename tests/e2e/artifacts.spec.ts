import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

/**
 * Artifacts: a full Markdown document in an assistant reply surfaces a saveable
 * artifact card; saving it lands an indexed document in the (ZK) store. The
 * relay is mocked to return the artifact deterministically.
 */
test("a markdown artifact in a reply can be saved into Documents", async ({ page }) => {
  const stamp = Date.now();
  const title = `Reisebericht ${stamp}`;
  const doc = [
    `# ${title}`,
    "",
    "## Anreise",
    "Wir fuhren am Morgen los und kamen mittags an. Das Wetter war schön und",
    "die Straßen waren frei — ein entspannter Start in den Tag.",
    "",
    "## Unterkunft",
    "Das Hotel lag zentral mit Blick auf die Berge und gutem Frühstück.",
  ].join("\n");

  await page.route("**/chat/stream", async (route) => {
    const reply = `Hier ist dein Dokument:\n\n\`\`\`markdown\n${doc}\n\`\`\`\n`;
    const sse =
      `data: ${JSON.stringify({ delta: reply })}\n\n` +
      `data: ${JSON.stringify({ done: true })}\n\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: sse,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Schreib mir einen kurzen Reisebericht als Markdown-Dokument.");
  await clickSend(page);

  // The artifact card renders (title + a Save action).
  await expect(page.getByText("Markdown artifact")).toBeVisible({ timeout: 20_000 });
  const save = page.getByRole("button", { name: "Save to Documents" });
  await expect(save).toBeVisible();
  await save.click();

  // Saved confirmation, then the indexed document exists in the store.
  await expect(page.getByText("Saved to Documents")).toBeVisible({ timeout: 60_000 });
  await page.goto("/documents");
  await expect(page.getByRole("button", { name: new RegExp(`${title}.*Indexed`) })).toBeVisible({
    timeout: 60_000,
  });
});

/**
 * Reported: dismissing the save offer leaves the answer as RAW markup. It is a
 * rendering bug, not a dismissal bug — the system prompt asks the model to wrap
 * a standalone document in a ```markdown fence, and Markdown renders a fence as
 * a CODE BLOCK. So the reply that IS a document always read as its own source,
 * and dismissing the card just removed the only thing that looked deliberate.
 *
 * The document must render as a document: headings as headings, no fence.
 */
test("a document reply renders as a document, before and after dismissing the card", async ({
  page,
}) => {
  const stamp = Date.now();
  const heading = `Kündigung ${stamp}`;
  const doc = [
    `# ${heading}`,
    "",
    "## Betreff",
    "Hiermit kündige ich den Vertrag fristgerecht zum nächstmöglichen Termin.",
    "Bitte bestätigen Sie den Eingang und das Vertragsende schriftlich.",
    "",
    "## Hinweis",
    "Eine Kopie dieses Schreibens verbleibt zu meinen Unterlagen im Ordner.",
  ].join("\n");

  await page.route("**/chat/stream", async (route) => {
    const reply = `Gerne:\n\n\`\`\`markdown\n${doc}\n\`\`\`\n`;
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: reply })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Schreib mir eine Kündigung als Dokument.");
  await clickSend(page);

  // Rendered as a real heading — fails on the old build, where the whole
  // document sat inside a <code> block.
  // TWO rendered headings while the card is up: the answer body AND the card's
  // own preview. Counting them is what makes this fail on the old build — there
  // the body was a code block, so the card's preview was the ONLY heading and a
  // `.first()` assertion would have passed for the wrong reason.
  const h1 = page.locator("main h1", { hasText: heading });
  await expect(h1).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator("main h2", { hasText: "Betreff" }).first()).toBeVisible();
  // The answer bubble holds no code block — the document is prose, not source.
  await expect(page.locator("main pre")).toHaveCount(0);

  // Dismiss the offer — the document must STAY readable.
  await expect(page.getByText("Markdown artifact")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Markdown artifact")).toHaveCount(0);
  // The card is gone, so exactly the ANSWER's own rendering is left. On the old
  // build this is where the user was stranded with raw markup.
  await expect(h1).toHaveCount(1);
  await expect(page.locator("main pre")).toHaveCount(0);
});

/**
 * Reported from a real comparison answer (screenshot): table cells showed `<br>`
 * verbatim, and every product picture was a broken-image icon.
 *
 * Two distinct causes, one render path:
 *  - react-markdown does not render raw HTML (deliberate — model output must
 *    never become live markup), and `<br>` is the ONLY line break a model can
 *    put in a GFM table cell, since a newline would end the row;
 *  - the app's CSP is `img-src 'self' data: blob:`, so a remote image URL is
 *    blocked outright. Routing it through QUON's own image proxy fixes the
 *    rendering AND keeps the host from learning who is reading about it.
 */
test("a table with <br> cells and remote images renders cleanly", async ({ page }) => {
  const IMG_HOST = "https://shop.quon-e2e.test";

  // Any direct hit on the image host is a privacy failure.
  const hostHits: string[] = [];
  await page.route(`${IMG_HOST}/**`, async (route) => {
    hostHits.push(route.request().url());
    await route.abort();
  });

  let proxyCalls = 0;
  await page.route("**/link-image**", async (route) => {
    proxyCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAM0lEQVR4AayPMQoAMAwCvfz/z20X09LFJYIEwolYK6gU1AAguHauAT/+OwicMXrtqlixAQAA///FD9tTAAAABklEQVQDADt/K/FyLwRAAAAAAElFTkSuQmCC",
        "base64",
      ),
    });
  });

  const reply = [
    "| Merkmal | Marke A |",
    "| --- | --- |",
    "| Optischer Eindruck | **Klassisch-elegant**<br>Sieht aus wie ein Anzug. |",
    `| Typisches Outfit | ![Essential Suit](${IMG_HOST}/suit.jpg) |`,
  ].join("\n");

  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: reply })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Vergleiche die Marken");
  await clickSend(page);

  const cell = page.locator("main td", { hasText: "Klassisch-elegant" });
  await expect(cell).toBeVisible({ timeout: 20_000 });
  // The break is a real element, and the tag is not shown as text.
  await expect(cell.locator("br")).toHaveCount(1);
  await expect(page.getByText("<br>")).toHaveCount(0);

  // The picture renders — through OUR proxy, never from the origin.
  const img = page.locator('main td img[src*="link-image"]');
  await expect(img).toBeVisible({ timeout: 20_000 });
  expect(proxyCalls).toBeGreaterThan(0);
  expect(hostHits).toEqual([]);
});

/**
 * A model's comparison table is unreadable on a phone: three columns of prose in
 * ~390 px means either a sideways scroll (reported) or columns squeezed to two
 * words. The same content therefore gets two layouts — the table on wide
 * screens, one card per ROW on a narrow one, with the first cell as the card
 * title and the remaining cells labelled by their column header.
 */
test("a comparison table becomes cards on a phone and stays a table on desktop", async ({
  page,
}) => {
  const reply = [
    "| Merkmal | Marke A | Marke B |",
    "| --- | --- | --- |",
    "| Optischer Eindruck | elegant | funktional |",
    "| Material | Twill | Baumwoll-Mix |",
  ].join("\n");

  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: reply })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);
  await page.getByPlaceholder("Ask anything, keep your data personal").fill("Vergleiche");
  await clickSend(page);

  // Desktop: the real table is the visible one.
  const table = page.locator("main table");
  await expect(table).toBeVisible({ timeout: 20_000 });

  // Phone: the table is gone and the rows are cards carrying their column
  // header as the label. Fails on the old build, which only ever had a table.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(table).toBeHidden();
  // Each string also exists in the (now hidden) table, so target the LAST match
  // — the card copy — and assert it is the one actually on screen.
  for (const label of ["Marke A", "Marke B"]) {
    await expect(page.locator("main").getByText(label, { exact: true }).last()).toBeVisible();
  }
  // Row titles survive as card headings, values stay with their label.
  await expect(
    page.locator("main").getByText("Optischer Eindruck", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.locator("main").getByText("Baumwoll-Mix", { exact: true }).last(),
  ).toBeVisible();
  // Nothing scrolls sideways: the answer fits the viewport.
  const overflow = await page.locator("main").evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
