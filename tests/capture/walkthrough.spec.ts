import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { login, openChat, registerAndVerify } from "../e2e/helpers/account";

/**
 * README walkthrough: type a message with personal data -> Review shows exactly
 * what the model receives (placeholders) -> send -> the answer streams back and
 * is re-hydrated locally with the real values.
 *
 * Everything is the real app and the real backend scrubber EXCEPT the model:
 * /chat/stream is answered in the page with an SSE stream built from the
 * placeholders that actually went over the wire. (page.route().fulfill()
 * delivers its body in one piece, so it cannot show a stream arriving; the
 * mock therefore sits at the fetch boundary.)
 *
 * Synthetic data only. Frames go to CAPTURE_OUT (never into git).
 */

const CAPTURE_OUT =
  process.env.CAPTURE_OUT ?? join(process.cwd(), "test-results", "capture", "frames");

const MESSAGE =
  process.env.CAPTURE_MESSAGE ??
  "Please write a short note to Jana Beispiel (jana.beispiel@example.org, +49 30 1234567) " +
    "confirming that the payment to IBAN DE89 3704 0044 0532 0130 00 has arrived.";

/** Build the mocked model answer from the placeholders that were really sent. */
function answerChunks(body: string): string[] {
  const tokens = [...new Set(body.match(/\[[A-Z][A-Z_]*_\d+\]/g) ?? [])];
  const first = (...types: string[]) =>
    tokens.find((t) => types.some((ty) => t.startsWith(`[${ty}_`)));
  const person = first("PERSON", "NAME");
  const email = first("EMAIL");
  const phone = first("PHONE");
  const iban = first("IBAN");

  const chunks: string[] = [`Dear ${person ?? "customer"}, `, "thank you, "];
  if (iban) chunks.push(`your payment to ${iban} `, "has arrived ");
  chunks.push("and the order is on its way. ");
  if (email || phone) {
    chunks.push("If anything changes ");
    if (email) chunks.push(`we will write to ${email} `);
    if (phone) chunks.push(`or call ${phone}.`);
  }
  chunks.push("\n\nBest regards");
  return chunks;
}

/** Background screenshot loop: one frame roughly every 150 ms, with timestamps. */
function startFrames(page: Page) {
  const frames: { t: number; png: Buffer }[] = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      const t0 = Date.now();
      try {
        frames.push({ t: t0, png: await page.screenshot({ type: "png" }) });
      } catch {
        /* page navigating - skip the frame */
      }
      const wait = 150 - (Date.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      mkdirSync(CAPTURE_OUT, { recursive: true });
      const index = frames.map((f, i) => {
        const name = `f${String(i).padStart(4, "0")}.png`;
        writeFileSync(join(CAPTURE_OUT, name), f.png);
        return { name, t: f.t - frames[0].t };
      });
      writeFileSync(join(CAPTURE_OUT, "index.json"), JSON.stringify(index, null, 1));
    },
  };
}

test("walkthrough: scrub -> review placeholders -> stream -> restored answer", async ({
  page,
  browser,
}) => {
  // The first account on a fresh instance becomes its admin, which adds an
  // "Admin" entry to the sidebar. Burn that slot on a separate account so the
  // recorded one looks like an ordinary user.
  {
    const ctx = await browser.newContext();
    const p0 = await ctx.newPage();
    await registerAndVerify(p0, {
      email: `walkthrough-admin-${Date.now()}@quon.test`,
      password: `Adm-${Math.random().toString(36).slice(2)}-Thru!`,
    });
    await ctx.close();
  }

  let outgoing = "";
  await page.exposeFunction("__quonCaptureAnswer", (body: string) => {
    outgoing = body;
    return answerChunks(body);
  });
  await page.addInitScript(() => {
    const orig = window.fetch.bind(window);
    const gaps = [260, 180, 240, 300, 170, 220, 280, 190, 250, 210, 230, 200];
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      if (method === "POST" && /\/chat\/stream(\?|$)/.test(url)) {
        const body = typeof init?.body === "string" ? init.body : "";
        const chunks: string[] = await (
          window as unknown as { __quonCaptureAnswer: (b: string) => Promise<string[]> }
        ).__quonCaptureAnswer(body);
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(c) {
            for (let i = 0; i < chunks.length; i++) {
              await new Promise((r) => setTimeout(r, gaps[i % gaps.length]));
              c.enqueue(enc.encode(`data: ${JSON.stringify({ delta: chunks[i] })}\n\n`));
            }
            c.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
            c.close();
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      return orig(input, init);
    };
  });

  // Throwaway account on the throwaway stack.
  const creds = {
    email: `walkthrough-${Date.now()}@quon.test`,
    password: `Walk-${Math.random().toString(36).slice(2)}-Thru!`,
  };
  await registerAndVerify(page, creds);
  await login(page, creds);
  await openChat(page);

  // Review mode ON (state-based retry: a click can land before hydration).
  const review = page.getByRole("button", { name: "Review", exact: true });
  await expect(async () => {
    if ((await review.getAttribute("aria-pressed")) !== "true") {
      await review.click();
      await page.waitForTimeout(250);
    }
    expect(await review.getAttribute("aria-pressed")).toBe("true");
  }).toPass({ timeout: 20_000 });

  const composer = page.getByPlaceholder("Ask anything, keep your data personal");
  // Hydration check: the composer must accept input into React state.
  await expect(async () => {
    await composer.fill("x");
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled({
      timeout: 1000,
    });
  }).toPass({ timeout: 30_000 });
  await composer.fill("");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(800);

  const frames = startFrames(page);
  try {
    await page.waitForTimeout(1500);
    await composer.click();
    await page.keyboard.type(MESSAGE, { delay: 25 });
    await page.waitForTimeout(1800);

    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText(/Review before sending/)).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(4800);
    const sendTo = page.getByRole("button", { name: /Send to/ });
    await sendTo.hover();
    await page.waitForTimeout(1200);
    await sendTo.click();

    await expect(page.getByText("Best regards")).toBeVisible({ timeout: 30_000 });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(3500);

    // What actually went over the wire: open the redaction detail and flip the
    // user bubble to its anonymized form, then back, and close the detail so
    // the GIF ends on the restored answer.
    const badge = page.getByText(/\d+ items? redacted/).first();
    await badge.hover();
    await page.waitForTimeout(500);
    await badge.click();
    const anon = page.getByRole("button", { name: "Show anonymized" }).first();
    await expect(anon).toBeVisible();
    await page.waitForTimeout(1200);
    await anon.hover();
    await page.waitForTimeout(400);
    await anon.click();
    await page.waitForTimeout(3000);
    const orig = page.getByRole("button", { name: "Show original" }).first();
    await orig.click();
    await page.waitForTimeout(1500);
    await badge.click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(4500);
  } finally {
    await frames.stop();
  }

  // The guarantee the GIF is about.
  expect(outgoing).toContain("[EMAIL_1]");
  expect(outgoing).not.toContain("jana.beispiel@example.org");
  await expect(page.getByText(/jana\.beispiel@example\.org/).last()).toBeVisible();
  console.log("placeholders sent:", [...new Set(outgoing.match(/\[[A-Z][A-Z_]*_\d+\]/g) ?? [])]);
});
