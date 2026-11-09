import { test, expect } from "@playwright/test";

import {
  clickSend,
  dismissReleaseNotes,
  freshEmail,
  registerAndVerifyViaHttp,
} from "./helpers/account";

// The step-1 callout's copy depends on fallbackMode (OnboardingCallout.tsx): the
// celebratory "N redacted" wording is dishonest when detection ran degraded.
// This is the normal variant. The harness runs with LLM_ENRICHMENT=false
// (playwright.config.ts), which is not a degraded state: fallback_mode means
// "NER itself is down", which in a healthy stack is never, so the callout users
// actually see is this one.
const ONBOARDING_CALLOUT_TEXT = /redacted\. Tap to see what/;

// First-login onboarding ("guided doing", see src/lib/onboardingStore.ts): a fresh
// account's very first chat visit gets an extra intro turn + composer placeholder
// inviting a real message, then a callout on the first real redaction, then an
// optional teaser card. Uses registerAndVerifyViaHttp (not the usual
// registerAndVerify/activateInDb shortcut) because the eligibility signal
// (MeResponse.onboarding_pending) is only ever reported on the real /auth/verify
// HTTP response - the DB-shortcut bypasses that endpoint entirely, which is also
// exactly why every other spec (all built on activateInDb) never sees this flow.
test("fresh account: intro turn -> redact callout -> teaser card, then never again", async ({
  page,
}) => {
  let outgoing = "";
  await page.route("**/chat/stream", async (route) => {
    outgoing = route.request().postData() ?? "";
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Klar, ich schreibe an [EMAIL_1]." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  const creds = { email: freshEmail("onb"), password: "Onboard-Test-12345!" };
  await registerAndVerifyViaHttp(page, creds);

  // /verify auto-redirects to "/" (locked - session exists, Master Key doesn't yet).
  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 60_000 });
  // The "What's new" release-notes modal (ReleaseNotesModal) overlays the app on a
  // fresh device and intercepts every click until dismissed - the `login()` helper
  // does this too, but this spec unlocks manually (registerAndVerifyViaHttp leaves
  // the page mid-navigation), so it isn't covered by that helper.
  await dismissReleaseNotes(page);

  // The app may self-navigate (fresh chat -> "/chat?c="), which on WebKit races
  // this goto: with the default waitUntil:"load" the goto is superseded and
  // rejects with "interrupted by another navigation". waitUntil:"commit"
  // resolves the moment navigation commits (before the app's client-side nav can
  // supersede it); the catch + waitForURL cover the residual race either way.
  await page.goto("/chat", { waitUntil: "commit" }).catch(() => {});
  await page.waitForURL(/\/chat/, { timeout: 15_000 });

  // Step 0: the extra intro turn + composer placeholder override - chat is otherwise
  // empty (no prior messages), so both are the eligibility flag showing through.
  await expect(
    page.getByText("Try it: type your name and email below", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("e.g. Hi, I'm Anna Müller, reach me at anna@mail.com"),
  ).toBeVisible();

  // Any real send (with actual PII, so step 1 has something to show) advances past
  // step 0 - content doesn't matter to the flow, but we want a non-zero redacted
  // count to exercise the callout's copy. Onboarding itself only depends on the
  // OUTGOING scrub (instant, before the network round-trip) - this deliberately
  // does not assert on the assistant's reply text, which is unrelated to
  // onboarding and can be lost to an unrelated pre-existing race between the
  // fresh-chat `navigate()` and the streamed reply (see the flagged task);
  // waiting on the callout is both sufficient and avoids that flake.
  await page
    .getByPlaceholder("e.g. Hi, I'm Anna Müller, reach me at anna@mail.com")
    .fill("Hi, I'm Anna Müller, reach me at anna@mail.com");
  await clickSend(page);

  // Step 1: the redacted-count callout appears with its own Got it / Skip.
  await expect(page.getByText(ONBOARDING_CALLOUT_TEXT)).toBeVisible({ timeout: 30_000 });
  expect(outgoing).toContain("[EMAIL_1]");
  expect(outgoing).not.toContain("anna@mail.com");
  await page.getByRole("button", { name: "Got it" }).click();

  // Step 2: the teaser card, dismissible, with a working Review-mode shortcut.
  await expect(page.getByText("That's the core loop.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Show me" }).first().click();
  await expect(page.getByRole("button", { name: "Review", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The teaser dismisses itself once a "Show me" is used.
  await expect(page.getByText("That's the core loop.", { exact: false })).toHaveCount(0);

  // The composer placeholder reverted to the default - onboarding is fully done.
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toBeVisible();

  // Persistence: a reload (and a fresh chat) never shows the flow again for this
  // account - onboardingSeen is a durable per-device flag, not a per-visit one.
  await page.reload();
  await expect(
    page.getByText("Protection Level").or(page.getByPlaceholder("Ask anything")),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/chat?c=");
  // Let the SPA settle before the next goto: after hydration the router
  // normalizes the empty ?c= search param with a same-URL replace navigation,
  // and WebKit aborts an in-flight goto("/chat") that this lands in the middle
  // of ("interrupted by another navigation") - reproducible under full-suite
  // timing, invisible in isolation. The composer being visible means hydration
  // (and any router normalization) is done.
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toBeVisible({
    timeout: 30_000,
  });
  await page.goto("/chat");
  await expect(
    page.getByText("Try it: type your name and email below", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toBeVisible();
});

// Edge case: the step-0 message has no PII at all. The step-1 callout has nothing
// to anchor to (there is no badge worth pulsing for "0 redacted"), so it must never
// strand the flow - it jumps straight to the step-2 teaser instead.
test("step-0 message with no PII skips straight to the teaser card (never gets stuck)", async ({
  page,
}) => {
  const creds = { email: freshEmail("onb-nopii"), password: "Onboard-NoPII-12345!" };
  await registerAndVerifyViaHttp(page, creds);

  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 60_000 });
  // The "What's new" release-notes modal (ReleaseNotesModal) overlays the app on a
  // fresh device and intercepts every click until dismissed - the `login()` helper
  // does this too, but this spec unlocks manually (registerAndVerifyViaHttp leaves
  // the page mid-navigation), so it isn't covered by that helper.
  await dismissReleaseNotes(page);

  await page.goto("/chat");
  await expect(
    page.getByPlaceholder("e.g. Hi, I'm Anna Müller, reach me at anna@mail.com"),
  ).toBeVisible();

  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: `data: ${JSON.stringify({ delta: "Sure." })}\n\ndata: ${JSON.stringify({ done: true })}\n\n`,
    });
  });
  await page
    .getByPlaceholder("e.g. Hi, I'm Anna Müller, reach me at anna@mail.com")
    .fill("just checking this out");
  await clickSend(page);

  // No redaction happened -> the callout never appears - but the teaser still does,
  // and the whole flow is already marked seen (not stuck at an invisible step 1).
  // Deliberately not asserting on the assistant's reply text here - see the note
  // in the test above; onboarding only depends on the (instant) outgoing scrub.
  await expect(page.getByText("That's the core loop.", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(ONBOARDING_CALLOUT_TEXT)).toHaveCount(0);

  await page.reload();
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Try it: type your name and email below", { exact: false }),
  ).toHaveCount(0);
});

// Skip affordance: available from the step-1 callout, ends the whole flow at once
// (no teaser afterwards) rather than just advancing to the next step.
test("Skip on the step-1 callout ends the flow immediately, no teaser card", async ({ page }) => {
  await page.route("**/chat/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body:
        `data: ${JSON.stringify({ delta: "Klar, ich schreibe an [EMAIL_1]." })}\n\n` +
        `data: ${JSON.stringify({ done: true })}\n\n`,
    });
  });

  const creds = { email: freshEmail("onb-skip"), password: "Onboard-Skip-12345!" };
  await registerAndVerifyViaHttp(page, creds);

  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 60_000 });
  // The "What's new" release-notes modal (ReleaseNotesModal) overlays the app on a
  // fresh device and intercepts every click until dismissed - the `login()` helper
  // does this too, but this spec unlocks manually (registerAndVerifyViaHttp leaves
  // the page mid-navigation), so it isn't covered by that helper.
  await dismissReleaseNotes(page);

  await page.goto("/chat");
  await page
    .getByPlaceholder("e.g. Hi, I'm Anna Müller, reach me at anna@mail.com")
    .fill("Hi, I'm Anna Müller, reach me at anna@mail.com");
  await clickSend(page);
  await expect(page.getByText(ONBOARDING_CALLOUT_TEXT)).toBeVisible();

  // Exact match: the callout's corner "X" is a separate button labeled "Skip
  // onboarding" (aria-label) - a fuzzy match would resolve to both.
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByText("That's the core loop.", { exact: false })).toHaveCount(0);

  await page.reload();
  await expect(page.getByPlaceholder("Ask anything, keep your data personal")).toBeVisible({
    timeout: 30_000,
  });
});
