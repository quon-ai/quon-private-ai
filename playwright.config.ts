import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

/**
 * Cross-browser E2E for the major user flows, run on both Chromium and WebKit.
 *
 * WebKit is the headless cousin of Safari - it is the only project here that would
 * have caught the iOS PDF bug (a ReadableStream gap Chrome doesn't have). For the
 * cases where Playwright's WebKit still diverges from *real* Safari, see the
 * real-Safari smoke in `scripts/safari-smoke.mjs` (run before mini-PC deploys).
 *
 * A dedicated throwaway stack runs on its own ports + DB so E2E never touches the
 * dev instance or the real quon.db: LLM enrichment off (so /scrub is deterministic
 * NER+regex, no cloud key), rate-limiting off, SMTP empty (verification links are
 * logged, not sent), invite gate off.
 */
// Ports and scratch paths come from scripts/session-env.sh, which derives them
// from which checkout this is. Constants would mean two sessions (or two
// worktrees) share /tmp/quon_e2e.db, and the cleanup below deletes it at every
// run start, so the second run would wipe the first run's live database
// mid-suite, silently. The primary checkout gets 8011/8012.
//
// One implementation, in bash: a TypeScript twin of the derivation would drift.
// tests/e2e/helpers/account.ts already shells out the same way.
const sessionEnv: Record<string, string> = Object.fromEntries(
  execFileSync(
    "bash",
    [resolve(dirname(fileURLToPath(import.meta.url)), "scripts/session-env.sh")],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);

export const API_PORT = Number(sessionEnv.QUON_E2E_API_PORT);
const WEB_PORT = Number(sessionEnv.QUON_E2E_WEB_PORT);
const TMP_DIR = sessionEnv.QUON_E2E_TMP;
export const TEST_DB = sessionEnv.QUON_E2E_DB;
// Verification/reset links are only ever "sent" as a logged [DEV EMAIL] line
// (SMTP_HOST is empty below) - tee the backend's stdout to a file so a spec that
// needs the real /auth/verify flow (onboarding.spec.ts; most specs use the
// activateInDb() DB-shortcut instead, which never reports MeResponse.onboarding_pending)
// can read the plaintext token back out. Test-harness-only; touches no app code
// (mirrors activateInDb() reaching into the sqlite file directly).
export const BACKEND_LOG = sessionEnv.QUON_E2E_BACKEND_LOG;

const SERVER_OUTPUT = process.env.CI ? { stdout: "pipe" as const, stderr: "pipe" as const } : {};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false, // per-FILE parallelism; within a file specs stay ordered
  // Each run lane (browser project x worker slot) owns a dedicated
  // pre-verified account (global-setup), so account state stays exclusive per
  // lane. Measured on an M1/16GB with the local model mirror: serial ~13 min,
  // workers=2 ~8 min.
  //
  // Two workers are safe only while every cleanup block waits for its
  // debounced sync push in the right order: a listener registered after the
  // click matches nothing, burns its whole timeout, and leaves "did the write
  // reach the server before the context closed" to luck, which shows up as
  // state leaking across specs (Review mode across projects, a Paperless
  // connection cascading through consecutive tests). tests/e2e/helpers/sync.ts
  // registers the listener first and says so out loud when a push misses.
  //
  // Serial is one env var away, `QUON_E2E_WORKERS=1`, and is the right move
  // when a failure smells like shared state rather than like code.
  workers: process.env.QUON_E2E_WORKERS ? Number(process.env.QUON_E2E_WORKERS) : 2,
  timeout: 120_000, // Argon2id login + the in-browser embedder are genuinely slow
  expect: { timeout: 20_000 },
  // No local retries, deliberately. A retry disguises a deterministic bug as a
  // flake: it re-runs in the same process against the same server state, so it
  // can never heal a state problem (Review mode leaking across browser
  // projects, for one), it only reruns the failure and buries it in the
  // "flaky" bucket. Failing loudly on the first attempt is what surfaces it.
  // CI keeps one retry, where a genuinely hostile shared runner (CPU steal) can
  // produce real one-off timing failures and re-running the whole gate is dear.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    actionTimeout: 25_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Pin the UI to ENGLISH for the whole suite (the app defaults to German).
    // Every spec selects by English strings; rather than rewrite ~300 selectors
    // we force the language via the `quon_lang` cookie the app reads at boot.
    // The language-switch behaviour itself is covered by i18n.spec.ts.
    storageState: {
      cookies: [
        {
          name: "quon_lang",
          value: "en",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command:
        // Wipe this session's scratch directory, rather than naming files that
        // another checkout might also be using. Structurally incapable of
        // deleting a concurrent run's database.
        `mkdir -p ${TMP_DIR} && rm -rf ${TMP_DIR}/* && printf '{}' > ${TMP_DIR}/runtime_settings.json && cd quon-scrubber-service && ` +
        // Hermetic runtime settings: without RUNTIME_SETTINGS_PATH the backend reads
        // the checkout's own runtime_settings.json, and a stale dev model catalog
        // in there hides the image model from image-generation.spec.
        `RUNTIME_SETTINGS_PATH=${TMP_DIR}/runtime_settings.json ` +
        `DATABASE_PATH=${TEST_DB} RATE_LIMIT_ENABLED=false DEMO_SCRUB_ENABLED=true DEMO_CONTACT_URL=https://example.org/waitlist DEMO_CONTACT_EMAIL=hello@example.org LLM_ENRICHMENT=false QUON_TEST_LIGHT_KDF=1 ` +
        `EMAIL_VERIFICATION=required SIGNUP_INVITE_CODE= SMTP_HOST= OPENROUTER_API_KEY= COOKIE_SECURE=false ` +
        `./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port ${API_PORT} ` +
        `2>&1 | tee ${BACKEND_LOG}`,
      url: `http://localhost:${API_PORT}/health`,
      timeout: 60_000,
      reuseExistingServer: false,
      // On CI the servers' own output is the only evidence when one dies
      // before its URL answers: "Process from config.webServer exited early"
      // is all the log says otherwise. Locally it stays quiet; the backend's
      // log is in BACKEND_LOG anyway.
      ...SERVER_OUTPUT,
    },
    {
      // `npx vite dev`, not `npm run dev`, so npm's `predev` hook does not
      // fire and public/version.json is never written here. It exists on a
      // developer machine (git-ignored, left behind by an earlier dev/build)
      // and not on a clean checkout, so update-banner.spec would pass locally
      // and fail on CI. Generated by `pree2e` instead; see package.json.
      // `copy-ort` first: `npx vite dev` bypasses npm's `predev` hook, so a
      // fresh worktree has no public/ort/ and the on-device OCR fails its
      // dynamic import of the ORT runtime, which the scan dialog reports as
      // "QUON was updated in the meantime".
      // (copy-ort before the env assignments: `A=1 cmd1 && cmd2` scopes A to
      // cmd1 only; with copy-ort in front, vite starts without its API URL and
      // every login in global-setup fails.)
      command: `node scripts/copy-ort.mjs && VITE_QUON_API_URL=http://localhost:${API_PORT} VITE_QUON_TEST_KDF=light VITE_QUON_TEST_LOCAL_MODELS=1 QUON_E2E_LOCAL_MODELS=1 npx vite dev --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 90_000,
      reuseExistingServer: false,
      ...SERVER_OUTPUT,
    },
  ],
});
