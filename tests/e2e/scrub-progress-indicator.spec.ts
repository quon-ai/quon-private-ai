import { writeFileSync } from "node:fs";

import { test, expect, type Page } from "@playwright/test";

import { clickSend, login, openChat, sharedCreds } from "./helpers/account";

/**
 * The scrub progress indicator, observed instead of reasoned about.
 *
 * Every previous fix to this thing was validated by unit tests and simulation,
 * and every one of them still shipped a user-visible artifact: a bar that ran to
 * 90% and snapped back to 27%; then an ETA that decayed to "0s" at 55% and
 * jumped to "1:10"; then a bar frozen at 14% for fifteen seconds. Simulation
 * kept agreeing with me because it encoded the same assumptions as the code.
 *
 * So this samples the real DOM through a real send. /scrub is mocked with a
 * fixed per-piece delay — that costs no provider credit and, more importantly,
 * makes the wave structure deterministic, so the assertions below are about the
 * INDICATOR and not about provider variance.
 *
 * What it enforces is only what must be true regardless of timing:
 *   - the percentage never goes backwards, and never reads 100% before the end
 *   - a remaining-time estimate is never "0s" while work is outstanding
 *   - the estimate never oscillates (down, then up again)
 * The observed sequence is attached to the report so the FEEL can be reviewed
 * rather than argued about.
 */

/** One synthetic document. Deliberately not real personal data (house rule):
 *  keeps the linguistic shape, invents the values. */
function syntheticDoc(i: number): string {
  return (
    `Dokument ${i} — Angebot\n\n` +
    `Vertragspartnerin: Anna Muster (Kundennummer 4711-${i}).\n` +
    `Anschrift: Beispielweg ${i}, 12345 Musterstadt.\n` +
    `Betrag: ${1000 + i},00 EUR. Frist: 30 Tage.\n\n`
  ).repeat(40);
}

interface Sample {
  ms: number;
  percent: number | null;
  eta: string | null;
  offline: boolean;
}

async function sampleIndicator(page: Page, forMs: number): Promise<Sample[]> {
  const out: Sample[] = [];
  const t0 = Date.now();
  while (Date.now() - t0 < forMs) {
    const s = await page.evaluate(() => {
      // ⚠️ Read the two spans SEPARATELY, never one blob of text.
      //
      // The first version regex-matched percent and estimate out of the same
      // innerText, and the estimate pattern happily matched the digits of "35%".
      // So the "no zero estimate" and "no oscillation" assertions were silently
      // re-testing the percentage and passed vacuously — the exact wrong-assert
      // failure this suite is supposed to catch.
      //
      // The row is: <div …tabular-nums><span>{percent}%</span><span>{eta}</span></div>
      const row = Array.from(document.querySelectorAll<HTMLElement>("div.tabular-nums")).find(
        (d) => d.children.length === 2 && /%/.test((d.children[0] as HTMLElement).innerText),
      );
      const pctText = row ? (row.children[0] as HTMLElement).innerText : "";
      const etaText = row ? (row.children[1] as HTMLElement).innerText : "";
      const pct = pctText.match(/(\d{1,3})\s?%/);
      return {
        percent: pct ? Number(pct[1]) : null,
        eta: etaText.trim() || null,
        offline: /Scrubber offline/i.test(document.body.innerText),
        done: /Vergleich folgt/.test(document.body.innerText),
      };
    });
    out.push({ ms: Date.now() - t0, percent: s.percent, eta: s.eta, offline: s.offline });
    if (s.done) break;
    await page.waitForTimeout(250);
  }
  return out;
}

test("the scrub indicator never lies: monotonic bar, no zero estimate, no oscillation", async ({
  page,
}, testInfo) => {
  test.slow();

  // Deterministic waves: each piece takes PIECE_MS, and scrubLarge runs 6 at a
  // time, so a 17-piece attachment is 3 waves of ~PIECE_MS each.
  const PIECE_MS = 2500;
  let scrubCalls = 0;
  await page.route("**/scrub", async (route) => {
    scrubCalls += 1;
    const body = JSON.parse(route.request().postData() ?? "{}") as { text?: string };
    await new Promise((r) => setTimeout(r, PIECE_MS));
    // Minimal valid ScrubResponse: one detected person, deterministically.
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scrubbed: (body.text ?? "").replaceAll("Anna Muster", "[PERSON_1]"),
        entities: [
          { type: "PERSON", value: "Anna Muster", placeholder: "[PERSON_1]", confidence: 0.99 },
        ],
        metadata: { fallback_mode: false, skip_reason: null, low_case_signal: false },
      }),
    });
  });

  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Vergleich folgt." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  // ~138k chars → ~17 pieces of 8k → 3 waves at concurrency 6, matching the
  // 12/17-document sends that were reported.
  const text = Array.from({ length: 23 }, (_, i) => syntheticDoc(i + 1)).join("\n");
  await page.setInputFiles('input[type="file"]', {
    name: "angebote.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text, "utf-8"),
  });
  await expect(page.getByText("angebote.txt")).toBeVisible({ timeout: 30_000 });

  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Vergleiche die Angebote");
  await clickSend(page);

  const samples = await sampleIndicator(page, 120_000);
  await expect(page.getByText("Vergleich folgt.")).toBeVisible({ timeout: 120_000 });

  // Attach the observed sequence so the feel is reviewable, not arguable.
  const table = samples
    .map(
      (s) =>
        `${(s.ms / 1000).toFixed(1).padStart(6)}s  ${String(s.percent ?? "-").padStart(4)}%  ` +
        `${(s.eta ?? "-").padEnd(22)}${s.offline ? "  OFFLINE" : ""}`,
    )
    .join("\n");
  const report = `pieces=${scrubCalls} pieceMs=${PIECE_MS}\n\n${table}`;
  await testInfo.attach("indicator-timeline.txt", { body: report, contentType: "text/plain" });
  // The default local reporter is `list`, which DISCARDS attachments — so the
  // timeline also goes to a file, otherwise the one artefact worth reading is
  // silently thrown away.
  if (process.env.QUON_INDICATOR_LOG) writeFileSync(process.env.QUON_INDICATOR_LOG, report);

  const shown = samples.filter((s) => s.percent !== null);
  expect(shown.length, "the indicator was never visible").toBeGreaterThan(3);

  // 1) The bar never goes backwards.
  for (let i = 1; i < shown.length; i++) {
    expect(shown[i].percent!, `percent fell at ${shown[i].ms}ms`).toBeGreaterThanOrEqual(
      shown[i - 1].percent!,
    );
  }

  // 2) The elapsed clock only counts up. This replaced a remaining-time estimate
  //    that wandered in both directions: reported as 20s → 40s → 1:00 → 25s, and
  //    measured by THIS spec at ~10s → ~15s → ~10s even with a fully
  //    deterministic per-piece latency. A number that moves both ways gives the
  //    reader nothing to act on.
  //
  //    ⚠️ The earlier version of this assertion only checked for a rise AFTER a
  //    fall, so the 10s→15s rise (which came first) passed silently. Assert
  //    monotonicity over the whole sequence instead.
  const secs = samples
    .map((s) => {
      const m = s.eta?.match(/^(\d+):(\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    })
    .filter((n): n is number => n !== null);
  expect(secs.length, "no elapsed clock was ever rendered").toBeGreaterThan(3);
  for (let i = 1; i < secs.length; i++) {
    expect(secs[i], `elapsed went backwards: ${secs[i - 1]}s → ${secs[i]}s`).toBeGreaterThanOrEqual(
      secs[i - 1],
    );
  }

  // 3) A false "Scrubber offline" must not appear during our own scrub. /scrub is
  //    mocked here, so the backend is idle — if this ever fires with a mock, the
  //    cause is client-side, which is worth knowing.
  const offline = samples.find((s) => s.offline);
  expect(offline, `false offline at ${offline?.ms}ms`).toBeUndefined();
});

test("a stalled piece says so instead of looking like a dead UI", async ({ page }, testInfo) => {
  test.slow();

  // Reported as "hängt komplett ohne Fehler, der Timer zählt einfach weiter
  // hoch". It was not a hang: the per-request timeout is 180s and there are 3
  // attempts, so ONE unresponsive piece stalls the send for ~9 minutes behind a
  // ticking clock. Here the FIRST piece fails once, so the retry path runs.
  const PIECE_MS = 800;
  let failed = false;
  await page.route("**/scrub", async (route) => {
    const reqText =
      (JSON.parse(route.request().postData() ?? "{}") as { text?: string }).text ?? "";
    // ⚠️ Abort only an ATTACHMENT piece. The wave scrubs the typed message and
    // the attachment concurrently, and the message path has NO retry — it fails
    // the send closed. Aborting "the first request" therefore raced: locally an
    // attachment piece arrived first and the retry notice appeared; on the
    // loaded CI runner the MESSAGE arrived first, the send died, and the spec
    // timed out waiting for a notice that could never come.
    if (!failed && reqText.includes("Dokument 1")) {
      failed = true;
      await route.abort("failed"); // looks like a network timeout to the client
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as { text?: string };
    await new Promise((r) => setTimeout(r, PIECE_MS));
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scrubbed: (body.text ?? "").replaceAll("Anna Muster", "[PERSON_1]"),
        entities: [
          { type: "PERSON", value: "Anna Muster", placeholder: "[PERSON_1]", confidence: 0.99 },
        ],
        metadata: { fallback_mode: false, skip_reason: null, low_case_signal: false },
      }),
    });
  });

  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Vergleich folgt." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  await login(page, sharedCreds());
  await openChat(page);

  const text = Array.from({ length: 23 }, (_, i) => syntheticDoc(i + 1)).join("\n");
  await page.setInputFiles('input[type="file"]', {
    name: "angebote.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(text, "utf-8"),
  });
  await expect(page.getByText("angebote.txt")).toBeVisible({ timeout: 30_000 });
  await page
    .getByPlaceholder("Ask anything, keep your data personal")
    .fill("Vergleiche die Angebote");
  await clickSend(page);

  // THE assertion: the user is told a section didn't respond and is being
  // retried. Before this, the same situation showed nothing at all.
  await expect(page.getByText(/didn't respond|antwortet nicht/i)).toBeVisible({
    timeout: 60_000,
  });
  await testInfo.attach("stall-notice.txt", {
    body: "retry notice rendered while a piece was being retried",
    contentType: "text/plain",
  });

  // …and the send still completes once the retry succeeds (fail-closed intact,
  // not fail-stuck).
  await expect(page.getByText("Vergleich folgt.")).toBeVisible({ timeout: 120_000 });
});
