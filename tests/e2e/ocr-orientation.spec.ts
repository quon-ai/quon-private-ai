import { test, expect } from "@playwright/test";

import { login, sharedCreds } from "./helpers/account";

/**
 * Landscape scans must not read as garbage: the engine recognises only
 * horizontal upright lines, so a page turned by 90° comes back as sideways
 * nonsense unless ocr.ts retries on the rotated canvas when the first pass
 * reads as sideways/upside-down and keeps the best pass.
 *
 * This runs the real engine - PaddleOCR PP-OCRv6 tiny, ~6 MB of models from
 * the Paddle CDN on first use - which the hermetic gate deliberately never
 * does (photo-scan.spec.ts). Opt in locally:
 *
 *     QUON_OCR_LOCAL=1 npx playwright test tests/e2e/ocr-orientation.spec.ts
 *
 * The test image is drawn in the page itself (no fixture file, no personal
 * data): a printed German sentence, then the same canvas turned by 90°, 180°
 * and 270°. Every rotation must come back containing the sentence's words.
 */
test.skip(!process.env.QUON_OCR_LOCAL, "real OCR engine — opt in with QUON_OCR_LOCAL=1");

const SENTENCE = "Vertrag Nummer 4711 vom 3. Juni";

async function textImagePng(
  page: import("@playwright/test").Page,
  rotation: 0 | 90 | 180 | 270,
): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ text, rotation }) => {
      const w = 1100;
      const h = 360;
      const base = document.createElement("canvas");
      base.width = w;
      base.height = h;
      const c = base.getContext("2d")!;
      c.fillStyle = "#fff";
      c.fillRect(0, 0, w, h);
      c.fillStyle = "#111";
      c.font = "bold 56px Arial, Helvetica, sans-serif";
      c.textBaseline = "middle";
      c.fillText(text, 60, h / 3);
      c.font = "44px Arial, Helvetica, sans-serif";
      c.fillText("Sehr geehrte Damen und Herren,", 60, (2 * h) / 3);
      if (rotation === 0) return base.toDataURL("image/png");
      const quarter = rotation === 90 || rotation === 270;
      const out = document.createElement("canvas");
      out.width = quarter ? h : w;
      out.height = quarter ? w : h;
      const o = out.getContext("2d")!;
      o.translate(out.width / 2, out.height / 2);
      o.rotate((rotation * Math.PI) / 180);
      o.drawImage(base, -w / 2, -h / 2);
      return out.toDataURL("image/png");
    },
    { text: SENTENCE, rotation },
  );
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

for (const rotation of [0, 90, 180, 270] as const) {
  test(`a page turned by ${rotation}° is recognised upright`, async ({ page }) => {
    test.slow(); // first run downloads the models
    await login(page, sharedCreds());
    await page.goto("/documents");
    const png = await textImagePng(page, rotation);

    await page
      .locator('input[type="file"][accept="image/*"]:not([capture])')
      .setInputFiles({ name: `rot-${rotation}.png`, mimeType: "image/png", buffer: png });

    const dialog = page.getByRole("dialog");
    const transcript = dialog.locator("textarea");
    await expect(transcript).toBeVisible({ timeout: 180_000 });
    const text = await transcript.inputValue();
    // Word-level, case-insensitive: OCR may drop a punctuation mark, never a word.
    for (const word of ["Vertrag", "4711", "Juni", "Damen", "Herren"]) {
      expect(text, `rotation ${rotation}: transcript = ${JSON.stringify(text)}`).toMatch(
        new RegExp(word, "i"),
      );
    }
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
}
