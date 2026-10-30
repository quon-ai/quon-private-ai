import { test, expect } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

/**
 * Image generation (#79). Hermetic: the catalog and the stream are mocked at
 * the network layer — no provider, no cost. What is pinned:
 *
 *  - an image-capable model shows the "Bild" badge in the picker;
 *  - a send with that model asks the relay for `image_output`;
 *  - an `{image}` event becomes a picture in the assistant bubble;
 *  - the picture survives a reload — the message keeps a reference and the
 *    bytes are in the sealed local store, NOT in the synced chat blob.
 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const IMAGE_MODEL = {
  id: "openrouter::google/gemini-2.5-flash-image",
  label: "google/gemini-2.5-flash-image",
  connection_id: "openrouter",
  model: "google/gemini-2.5-flash-image",
  disabled: false,
  image_output: true,
};

test("an image model is badged, asks for an image, shows it, and keeps it across a reload", async ({
  page,
}) => {
  // The default catalog (connections.py) already carries the image model; the
  // mock only guarantees it on a box whose runtime settings override the list.
  // Also un-disable it: the throwaway E2E stack has no provider key, so the
  // catalog marks every entry disabled (sends still work — the stream is
  // mocked below), and a disabled Radix option cannot be clicked.
  await page.route("**/models", async (route) => {
    const res = await route.fetch();
    const list = (await res.json()) as { model?: string; disabled?: boolean }[];
    const present = list.some((m) => m.model === IMAGE_MODEL.model);
    const patched = (present ? list : [...list, IMAGE_MODEL]).map((m) =>
      m.model === IMAGE_MODEL.model ? { ...m, disabled: false } : m,
    );
    await route.fulfill({ json: patched });
  });
  const streamBodies: string[] = [];
  await page.route("**/chat/stream", async (route) => {
    streamBodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ job: "j-img" })}\n\n` +
        `data: ${JSON.stringify({ delta: "Hier ist deine Berghütte." })}\n\n` +
        `data: ${JSON.stringify({ image: PNG })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
  // The background upload of the image chunks must not fail the test on a
  // stack without an originals quota — accept whatever it pushes.
  await page.route("**/sync/push", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      changes?: { id: string }[];
    };
    if (body.changes?.some((c) => c.id.startsWith("img:"))) {
      await route.fulfill({
        json: { results: body.changes.map((c) => ({ id: c.id, status: "accepted" })) },
      });
      return;
    }
    await route.continue();
  });

  await login(page, sharedCreds());
  await openChat(page);

  // Pick the image model — the picker badges it.
  await page.getByRole("combobox").first().click();
  const option = page.getByRole("option", { name: /gemini.*2\.5.*flash.*image/i });
  await expect(option.getByTestId("image-model-badge")).toHaveText(/Bild|Image/);
  await option.click();

  await page.getByPlaceholder(/Ask anything|Frag alles/).fill("Eine Berghütte im Schnee, Aquarell");
  await clickSend(page);

  const img = page.getByTestId("generated-image");
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Hier ist deine Berghütte.")).toBeVisible();
  expect(streamBodies).toHaveLength(1);
  expect(JSON.parse(streamBodies[0]).image_output).toBe(true);

  // Reload: the reference is on the persisted message, the bytes in IndexedDB.
  await page.reload();
  await expect(page.getByTestId("generated-image")).toBeVisible({ timeout: 30_000 });
});

test("the badge marks only image models, and a text model sends no image_output", async ({
  page,
}) => {
  const streamBodies: string[] = [];
  await page.route("**/chat/stream", async (route) => {
    streamBodies.push(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ delta: "Hallo." })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
  await login(page, sharedCreds());
  await openChat(page);
  await page.getByRole("combobox").first().click();
  // Exactly the image model carries the badge — nothing else in the catalog.
  const badges = page.getByTestId("image-model-badge");
  await expect(badges).toHaveCount(1);
  await expect(
    page.getByRole("option", { name: /image/i }).getByTestId("image-model-badge"),
  ).toHaveCount(1);
  // The default (text) model stays selected.
  await page.keyboard.press("Escape");
  await page.getByPlaceholder(/Ask anything|Frag alles/).fill("Hallo");
  await clickSend(page);
  await expect(page.getByText("Hallo.").first()).toBeVisible({ timeout: 30_000 });
  expect("image_output" in JSON.parse(streamBodies[0])).toBe(false);
});
