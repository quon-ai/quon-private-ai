import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

// Photo-OCR affordance (PhotoScanDialog + the image routing in ScreenDocuments).
// The OCR engine itself (PaddleOCR PP-OCRv6 tiny via ONNX WASM) downloads ~6 MB
// of models from a CDN — deliberately NOT exercised here to keep the gate
// hermetic; its quality/latency is covered by the 2026-07-06 eval (CER 0 on a
// printed German letter, Chromium AND WebKit — research-2026-07-06.md §5) and
// the pure seams are unit-tested (ocr.test.ts). This spec pins the UI contract:
// images route into the review dialog (NEVER straight into the index — the
// transcript must be user-checked), and Cancel drops the photo without a trace.
test("photos route into the scan-review dialog; Cancel leaves no document behind", async ({
  page,
}) => {
  await login(page, sharedCreds());
  await page.goto("/documents");

  // Both upload affordances are present.
  await expect(page.getByText("Scan a photo")).toBeVisible();
  await expect(page.getByText("Drop files or browse")).toBeVisible();

  // Inject a tiny PNG as if picked via the photo input (camera/gallery).
  const name = `scan-e2e-${Date.now()}.png`;
  await page
    .locator('input[type="file"][accept="image/*"]:not([capture])')
    .setInputFiles({ name, mimeType: "image/png", buffer: pngPixel() });

  // The review dialog opens (in the model-preparing phase — no network needed)
  // instead of the file landing in the document list.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Scan photo")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(/the photo never leaves it/)).toBeVisible();

  // Cancel: dialog closes, nothing was ingested.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(name)).toHaveCount(0);
});

// Multi-select from the gallery: picking several photos must scan ALL of them,
// one review dialog after the other. The gallery input used to lack `multiple`,
// so the browser handed over only the first file and the rest vanished without
// a word. The position chip is what makes the queue visible to the user.
test("several gallery photos are reviewed one after another", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/documents");

  const stamp = Date.now();
  const gallery = page.locator('input[type="file"][accept="image/*"]:not([capture])');
  await expect(gallery).toHaveAttribute("multiple", "");
  await gallery.setInputFiles([
    { name: `queue-a-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
    { name: `queue-b-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
  ]);

  // First photo: the dialog names its position in the batch.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Photo 1 of 2")).toBeVisible({ timeout: 15_000 });

  // Closing it advances to the second instead of ending the batch.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByText("Photo 2 of 2")).toBeVisible({ timeout: 15_000 });

  // Closing the last one ends the queue.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
});

// The chat paperclip carries the same scan flow in attach mode: the reviewed
// text becomes the message attachment (scrubbed before send like any other),
// no document is created. The paperclip splits image capture into two entries:
// "Take a photo" (a capture-enabled input → mobile camera) and "Scan from
// gallery" (capture-free → existing photo); both feed the same review dialog.
// Hermetic like the test above — Cancel before OCR.
test("chat paperclip offers camera + gallery scan and opens the review dialog", async ({
  page,
}) => {
  await login(page, sharedCreds());
  await page.goto("/chat");

  await page.getByRole("button", { name: "Attach a document" }).click();
  // Both affordances are present.
  await expect(page.getByRole("menuitem", { name: "Take a photo" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Scan from gallery" })).toBeVisible();
  // "Take a photo" opens the camera-capture input (distinct from the gallery one).
  await page.getByRole("menuitem", { name: "Take a photo" }).click();

  const name = `chat-scan-e2e-${Date.now()}.png`;
  await page
    .locator('input[type="file"][accept="image/*"][capture]')
    .setInputFiles({ name, mimeType: "image/png", buffer: pngPixel() });

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Scan photo")).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  // Nothing staged: no attachment chip with the file name.
  await expect(page.getByText(name)).toHaveCount(0);
});

// #77/#78 (Android): "Bilder in jpg Format können nicht hochgeladen werden" —
// the paperclip's "Attach a document" input had no image type in `accept`, so
// the system picker greyed every photo out. A photo picked THERE must take the
// same OCR review path as the camera/gallery entries, never extract.ts.
test("chat: a photo picked through 'Attach a document' opens the scan review, not a failed attach", async ({
  page,
}) => {
  await login(page, sharedCreds());
  await page.goto("/chat");

  const name = `chat-doc-jpg-e2e-${Date.now()}.jpg`;
  // The DOCUMENT input (the one that also lists .pdf), not the image-only ones.
  await page
    .locator('input[type="file"][accept*=".pdf"]')
    .setInputFiles({ name, mimeType: "image/jpeg", buffer: pngPixel() });

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Scan photo")).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(name)).toHaveCount(0);
  // …and it was never handed to the text extractor (that path's failure copy).
  await expect(page.getByText(/Couldn't read that file|No readable text found/)).toHaveCount(0);
});

// Cloud escalation (hybrid tier): the fallback is strictly opt-in — an explicit
// consent step must sit between "try the cloud model" and any network call, and
// the header chip must stop claiming "never leaves this device" afterwards.
// Hermetic: the on-device engine is forced into its error phase by blocking the
// model CDNs, and /ocr/cloud is mocked at the network layer — no real OCR, no
// real provider.
test("cloud escalation needs explicit consent and updates the privacy chip", async ({ page }) => {
  await login(page, sharedCreds());

  // Kill the on-device engine fast (model tars + ORT wasm both blocked) so the
  // dialog lands in the error phase, where the escalation is also offered.
  await page.route("**/paddle-model-ecology.bj.bcebos.com/**", (route) => route.abort());
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());

  let cloudCalls = 0;
  await page.route("**/ocr/cloud", async (route) => {
    const origin = route.request().headers()["origin"] ?? "*";
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-headers": "content-type, x-quon-csrf",
          "access-control-allow-methods": "POST, OPTIONS",
        },
      });
      return;
    }
    cloudCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify({ text: "CLOUD TRANSCRIPT 42", model: "test/mock-vision" }),
    });
  });

  await page.goto("/documents");
  await page
    .locator('input[type="file"][accept="image/*"]:not([capture])')
    .setInputFiles({ name: "cloud-e2e.png", mimeType: "image/png", buffer: pngPixel() });

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 60_000,
  });

  // Offer → consent (no network yet) → send.
  await dialog.getByRole("button", { name: /Try the cloud model/i }).click();
  await expect(dialog.getByText(/Zero-data-retention/)).toBeVisible();
  expect(cloudCalls).toBe(0); // consent shown, nothing sent yet
  await dialog.getByRole("button", { name: "Send this photo" }).click();

  // The mocked transcript lands in the editable review, and the chip is honest.
  await expect(dialog.locator("textarea")).toHaveValue("CLOUD TRANSCRIPT 42", {
    timeout: 15_000,
  });
  await expect(dialog.getByText("Read by a cloud model — photo not stored")).toBeVisible();
  expect(cloudCalls).toBe(1);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
});

/** An 8×8 canvas-generated PNG. NOT the classic hand-crafted 1×1 fixture —
 *  Chromium's strict ImageBitmap decoder rejects those bytes ("source image
 *  could not be decoded") even though <img> accepts them, and the cloud
 *  escalation path decodes via createImageBitmap before upload. */
function pngPixel(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAM0lEQVR4AayPMQoAMAwCvfz/z20X09LFJYIEwolYK6gU1AAguHauAT/+OwicMXrtqlixAQAA///FD9tTAAAABklEQVQDADt/K/FyLwRAAAAAAElFTkSuQmCC",
    "base64",
  );
}

/**
 * "Ich will mehrere Screenshots anhängen" (reported): the chat paperclip's
 * gallery scan took exactly ONE photo, so three screenshots meant three
 * messages. They are now reviewed one after the other and staged as a SINGLE
 * attachment — one turn, one scrub-before-send pass.
 *
 * Hermetic: the OCR engine is never reached (its CDNs aren't available in the
 * gate), so this pins the queue behaviour — the position chip counts up and
 * cancelling a photo advances to the next instead of ending the batch.
 */
test("the chat paperclip scans several gallery photos in one batch", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/chat");

  await page.getByRole("button", { name: "Attach a document" }).click();
  await page.getByRole("menuitem", { name: "Scan from gallery" }).click();

  const gallery = page.locator('input[type="file"][accept="image/*"]:not([capture])');
  await expect(gallery).toHaveAttribute("multiple", "");

  const stamp = Date.now();
  await gallery.setInputFiles([
    { name: `shot-a-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
    { name: `shot-b-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
    { name: `shot-c-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
  ]);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Photo 1 of 3")).toBeVisible({ timeout: 20_000 });

  // Cancelling one photo skips it and moves on — the batch is not aborted.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByText("Photo 2 of 3")).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog.getByText("Photo 3 of 3")).toBeVisible({ timeout: 20_000 });

  // Closing the last one ends the batch; nothing was reviewed, so nothing is staged.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Remove attachment" })).toHaveCount(0);
});

/**
 * "Take all N": reviewing five screenshots one by one is the cost this buys
 * out of. It is only offered INSIDE a batch and only while photos remain — on
 * a single photo there is nothing to skip, and offering an unreviewed shortcut
 * there would just weaken the review step for no gain.
 */
test("the take-all shortcut is offered only inside a batch", async ({ page }) => {
  await login(page, sharedCreds());
  await page.goto("/documents");

  const gallery = page.locator('input[type="file"][accept="image/*"]:not([capture])');
  const stamp = Date.now();

  // A single photo: no shortcut.
  await gallery.setInputFiles({
    name: `solo-${stamp}.png`,
    mimeType: "image/png",
    buffer: pngPixel(),
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Scan photo")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole("button", { name: /Take all/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 10_000 });
});

/**
 * Accepting a photo must advance the batch by EXACTLY one.
 *
 * Regression: the dialog calls `onAttach` and then `onClose`, and the chat
 * wiring briefly advanced the queue in BOTH — so every accepted photo silently
 * swallowed the next one. The batch test above only cancelled, so it passed.
 *
 * Hermetic: the on-device engine is killed (CDNs blocked) and the mocked cloud
 * escalation supplies a real transcript, which is what makes "accept" reachable
 * without running OCR.
 */
test("accepting a photo advances the batch by exactly one", async ({ page }) => {
  await page.route("**/paddle-model-ecology.bj.bcebos.com/**", (route) => route.abort());
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/ocr/cloud", async (route) => {
    const origin = route.request().headers()["origin"] ?? "*";
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          ...cors,
          "access-control-allow-headers": "content-type, x-quon-csrf",
          "access-control-allow-methods": "POST, OPTIONS",
        },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify({ text: "BELEG NUMMER EINS", model: "test/mock-vision" }),
    });
  });

  await login(page, sharedCreds());
  await page.goto("/chat");
  await page.getByRole("button", { name: "Attach a document" }).click();
  await page.getByRole("menuitem", { name: "Scan from gallery" }).click();

  const stamp = Date.now();
  await page.locator('input[type="file"][accept="image/*"]:not([capture])').setInputFiles([
    { name: `acc-a-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
    { name: `acc-b-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
    { name: `acc-c-${stamp}.png`, mimeType: "image/png", buffer: pngPixel() },
  ]);

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Photo 1 of 3")).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: /Try the cloud model/i }).click();
  await dialog.getByRole("button", { name: "Send this photo" }).click();
  await expect(dialog.locator("textarea")).toHaveValue("BELEG NUMMER EINS", { timeout: 20_000 });

  // Accept it: the batch must be on photo 2 — NOT on 3, and not finished.
  await dialog.getByRole("button", { name: "Attach to message" }).click();
  await expect(dialog.getByText("Photo 2 of 3")).toBeVisible({ timeout: 30_000 });
});
