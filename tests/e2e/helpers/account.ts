import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

// Re-exported, never re-declared: this was a second hardcoded copy of the path,
// so the harness and the config could disagree about which database is "the"
// test database.
import { BACKEND_LOG, TEST_DB } from "../../../playwright.config";

export { TEST_DB };
export const CREDS_FILE = "tests/e2e/.auth/creds.json";

export interface Creds {
  email: string;
  password: string;
}

interface CredsFile {
  admin: Creds;
  workers: Creds[];
  reviewers?: Creds[];
}

/**
 * This run-lane's own pre-verified account. The lane is (BROWSER PROJECT ×
 * worker slot), not just the worker slot.
 *
 * Keying on the worker alone was a real bug: serially (workers=1) the chromium
 * and webkit projects both took slot 0, so **webkit inherited every byte of
 * account state chromium had accumulated** — including SYNCED prefs. The
 * protection level lives in the prefs blob, so `review-mode.spec` (chromium)
 * could leave Review ON for webkit's first direct-send specs, which then sat at
 * the review panel until they timed out: the chronic
 * artifacts/attach-all/attach-large-scrub/attachment failures. Per-test cleanup
 * can't close that hole reliably, because `prefs` is ONE blob — any later pref
 * write from a page holding a stale copy re-publishes the old protection level
 * under a fresh timestamp (whole-blob LWW).
 *
 * Per-project accounts remove the cross-project channel by construction. Safe
 * because each project is self-sufficient: a webkit-only full run passes.
 */
export function sharedCreds(): Creds {
  const file = JSON.parse(readFileSync(CREDS_FILE, "utf8")) as CredsFile;
  const project = test.info().project.name;
  const worker = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  const lane = laneKey(project, worker);
  const found = file.workers.find((w) => w.email.startsWith(`shared-${lane}@`));
  // A creds file from an older run (pre-lane naming) → fall back to the old
  // worker-slot behaviour rather than crashing the whole suite.
  return found ?? file.workers[worker % file.workers.length];
}

/** Account lane id for a (project, worker) pair — the shared naming rule used by
 *  global-setup when registering and by sharedCreds when looking up. */
export function laneKey(project: string, worker: number): string {
  return `${project}-w${worker}`;
}

/** Dedicated account for review-mode.spec. Review is a SYNCED pref, so leaving
 *  it on poisons every later direct-send spec sharing the account — and per-test
 *  cleanup can't reliably undo it (`prefs` is a single blob: any later pref write
 *  from a page holding a stale copy republishes the old level). Isolating the one
 *  spec that flips it keeps the hazard out of the lane accounts entirely. Falls
 *  back to the lane account for a creds file written before this existed. */
export function reviewCreds(): Creds {
  const file = JSON.parse(readFileSync(CREDS_FILE, "utf8")) as CredsFile;
  const lane = laneKey(test.info().project.name, Number(process.env.TEST_PARALLEL_INDEX ?? 0));
  return file.reviewers?.find((r) => r.email.startsWith(`review-${lane}@`)) ?? sharedCreds();
}

/** The instance-admin account (registered FIRST on the fresh test DB — the
 *  role bootstrap). Only admin.spec should log into it. */
export function adminCreds(): Creds {
  return (JSON.parse(readFileSync(CREDS_FILE, "utf8")) as CredsFile).admin;
}

/** Mark a pending account active directly in the test DB — stands in for clicking
 *  the emailed verification link (SMTP is disabled, so no mail is ever sent).
 *  The busy timeout matters: the backend holds the WAL lock. We assert exactly
 *  one row changed so a lock/timing miss fails loudly instead of no-opping. */
export function activateInDb(email: string): void {
  for (let attempt = 0; attempt < 10; attempt++) {
    const out = execSql("UPDATE users SET status='active' WHERE email=?; SELECT changes();", [
      email,
    ]);
    if (out === "1") return;
    execFileSync("sleep", ["0.3"]); // row not visible yet — brief poll
  }
  throw new Error(`activateInDb(${email}): row never became visible to activate`);
}

/** Drive the register UI to create a (pending) account, then activate it in the DB.
 *  Leaves the page on the post-register screen (logged out). */
export async function registerAndVerify(page: Page, creds: Creds): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  // Invite field is client-side `required`; the backend ignores it when no invite
  // gate is configured (the test stack sets SIGNUP_INVITE_CODE empty).
  await page.getByPlaceholder("Invite code").fill("e2e");
  await page.getByPlaceholder("Email").fill(creds.email);
  await page.getByPlaceholder("Password (min. 12 chars)").fill(creds.password);
  await page.getByPlaceholder("Confirm password").fill(creds.password);
  // Terms acceptance gates the submit button (see ScreenAuth register form).
  await page.getByLabel("Accept the terms of use").check();
  await page.getByRole("button", { name: "Create account" }).click();
  // Registration succeeded once the recovery-phrase step renders.
  await expect(page.getByText("recovery phrase", { exact: false }).first()).toBeVisible({
    timeout: 60_000,
  });
  activateInDb(creds.email);
}

/** Read the plaintext verification token for `email` out of the backend's tee'd
 *  stdout (`[DEV EMAIL] to=<email> ... http://…/verify?token=<TOKEN>`, see
 *  quon-scrubber-service/email_service.py — SMTP is disabled in the e2e stack,
 *  so this is the ONLY place the plaintext token is ever observable; the DB
 *  stores only its sha256 hash). Polls like `activateInDb`: the backend writes
 *  the log line asynchronously relative to the HTTP response that triggered it.
 *  Takes the LAST match so a re-registration (resend) picks up the newest token. */
function readVerifyTokenFromLog(email: string): string {
  const re = new RegExp(
    `\\[DEV EMAIL\\] to=${email.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}[\\s\\S]*?verify\\?token=(\\S+)`,
    "g",
  );
  for (let attempt = 0; attempt < 20; attempt++) {
    let log = "";
    try {
      log = readFileSync(BACKEND_LOG, "utf8");
    } catch {
      /* file not flushed yet */
    }
    const matches = [...log.matchAll(re)];
    if (matches.length) return matches[matches.length - 1][1];
    execFileSync("sleep", ["0.3"]);
  }
  throw new Error(
    `readVerifyTokenFromLog(${email}): no verification email found in ${BACKEND_LOG}`,
  );
}

/** Register + drive the REAL /auth/verify HTTP flow (unlike `registerAndVerify`,
 *  which activates via a direct DB write and never touches the endpoint). Needed
 *  for anything that depends on a real `/auth/verify` response — currently only
 *  the onboarding-eligibility signal (`MeResponse.onboarding_pending`), which is
 *  reported exactly once there and nowhere else (see onboardingStore.ts). Leaves
 *  the page on `/verify` mid-navigation to the unlock/dashboard redirect. */
export async function registerAndVerifyViaHttp(page: Page, creds: Creds): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByPlaceholder("Invite code").fill("e2e");
  await page.getByPlaceholder("Email").fill(creds.email);
  await page.getByPlaceholder("Password (min. 12 chars)").fill(creds.password);
  await page.getByPlaceholder("Confirm password").fill(creds.password);
  // Terms acceptance gates the submit button (see ScreenAuth register form).
  await page.getByLabel("Accept the terms of use").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("recovery phrase", { exact: false }).first()).toBeVisible({
    timeout: 60_000,
  });
  const token = readVerifyTokenFromLog(creds.email);
  await page.goto(`/verify?token=${token}`);
  await expect(page.getByText("Account verified", { exact: false })).toBeVisible({
    timeout: 30_000,
  });
}

/** Log in via the UI and wait until the unlocked app shell (dashboard) is reached. */
export async function login(page: Page, creds: Creds): Promise<void> {
  await page.goto("/");
  await page.getByPlaceholder("Email").fill(creds.email);
  await page.getByPlaceholder("Password", { exact: true }).fill(creds.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Protection Level")).toBeVisible({ timeout: 60_000 });
  await dismissReleaseNotes(page);
}

/**
 * Open the chat screen for a spec that SENDS a message, and fail fast if the
 * account is in Review mode.
 *
 * Review is a synced pref: with it left on, a send stops at the "Review before
 * sending" panel and waits for an approval the spec never gives. That used to
 * surface as an unexplained 60s timeout on whatever the spec expected next —
 * the failure looked like slowness and cost weeks of misdiagnosis. Here it
 * fails in seconds, naming the actual cause.
 *
 * Honest limit: this reads the pill AFTER the initial sync pull has normally
 * landed, but a very late pull could still flip Review on afterwards. That case
 * degrades to the old timeout — never worse, usually much better.
 */
export async function openChat(page: Page): Promise<void> {
  await page.goto("/chat");
  const review = page.getByRole("button", { name: "Review", exact: true });
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(
    review,
    "Review mode is ON for this account — a send will stall at the approval panel. " +
      "Some earlier spec leaked the synced protection level (see sharedCreds/reviewCreds).",
  ).toHaveAttribute("aria-pressed", "false", { timeout: 10_000 });
}

/**
 * Click Send, but only once the composer has actually accepted the text.
 *
 * The Send button is `disabled={!input.trim()}` — driven by REACT STATE, not by
 * the DOM value. Playwright's fill() sets the value and dispatches an input
 * event; if that lands before hydration has attached the handler, the event is
 * lost, the state stays empty, and the button stays disabled FOREVER, because
 * nothing will fire again. The click then burns its whole timeout on an
 * element that can never become enabled.
 *
 * That is the failure that produced three different red gates on 2026-08-05 —
 * attachment, artifacts and scrub-parallel, all "locator.click timeout,
 * element is not enabled", all passing in isolation, all on a loaded machine.
 * Waiting for `enabled` turns a lost race into a slower one that still
 * succeeds, and keeps a REAL "send never becomes possible" bug failing loudly.
 */
export async function clickSend(page: Page): Promise<void> {
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.click();
}

/** The first-run "what's new" modal overlays the app and intercepts clicks.
 *  Best-effort dismiss (absent after it's been seen / on later loads). */
export async function dismissReleaseNotes(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Got it" })
    .click({ timeout: 4000 })
    .catch(() => {});
}

/** Count synced blobs of a collection in the test DB — used to wait until local
 *  data (e.g. a freshly-added memory) has reached the server, so a reload pulls it
 *  back (the harness's IndexedDB cache doesn't persist across reloads). */
/** Count LIVE (non-tombstoned) synced blobs — the rows the server would hand a
 *  fresh login. `deleted=0` matches how sync.py itself counts.
 *
 *  Exists for cleanup contracts: a spec that deletes its fixtures via the UI
 *  has only changed LOCAL state — the sync tombstone still has to reach the
 *  server, and it races the context close at spec end. On a fast laptop the
 *  push wins; on a loaded CI runner it lost, the next login on the lane
 *  account pulled the "deleted" memory back, and resend-unfiltered saw a
 *  context redaction for a clean sentence (root-caused 2026-08-04 from the
 *  runner's trace: leftover "Wohnort… Elbchaussee 1" from
 *  memory-maintenance). Deleted-in-the-UI is not deleted; deleted-ON-THE-
 *  SERVER is. */
export function liveBlobCount(collection: string): number {
  return (
    Number.parseInt(
      execSql("SELECT COUNT(*) FROM blobs WHERE collection=? AND deleted=0;", [collection]),
      10,
    ) || 0
  );
}

/** Same count, restricted to ONE account. The suite runs several lane accounts
 *  against one DB, so a global count mixes in other lanes' rows — a baseline
 *  taken that way is not a fact about this spec. */
export function liveBlobCountForEmail(collection: string, email: string): number {
  return (
    Number.parseInt(
      execSql(
        "SELECT COUNT(*) FROM blobs b JOIN users u ON u.id=b.user_id " +
          "WHERE b.collection=? AND b.deleted=0 AND u.email=?;",
        [collection, email],
      ),
      10,
    ) || 0
  );
}

/** Block until the server's live count for `collection` is back at `baseline`
 *  (captured BEFORE the spec created its fixtures — relative, so residue from
 *  other lanes/specs never breaks the wait). Fails loudly naming the residue
 *  class instead of letting a later spec fail confusingly. */
/**
 * Remove an account's residue for `collection` from the TEST DATABASE.
 *
 * Why at the DB and not through the app: `collectionSync` debounces a push,
 * and its net for "the tab is going away" is a `pagehide` listener — which
 * fires when the CONTEXT CLOSES, i.e. after the test body. Measured: sampling
 * the DB from outside the browser shows rows flipping to deleted=1 only as the
 * previous spec's context goes away, and a synthetic `pagehide` from
 * page.evaluate does not reliably bring that forward. So a spec cannot observe
 * its own cleanup, no matter how long it waits.
 *
 * That timing is CORRECT product behaviour (a real user's tab really does flush
 * on the way out), so the fix belongs in teardown, not in the app. Specs keep
 * asserting the delete through the UI — that is the actual test; this only
 * guarantees the shared lane account is clean for whatever runs next.
 *
 * Root cause it closes (2026-08-04, from the CI runner's Playwright trace): a
 * leftover "Wohnort… Elbchaussee 1" memory was retrieved as RAG context for an
 * unrelated question, and its ADDRESS redaction was counted into the chip —
 * so resend-unfiltered saw "1 item redacted" where it expected "No personal
 * data found". The detector was never wrong.
 */
export function purgeAccountBlobs(collection: string, email: string): void {
  execSql(
    "UPDATE blobs SET deleted=1, ciphertext='' WHERE collection=? AND deleted=0 " +
      "AND user_id=(SELECT id FROM users WHERE email=?);",
    [collection, email],
  );
}

export function blobCount(collection: string): number {
  return (
    Number.parseInt(execSql("SELECT COUNT(*) FROM blobs WHERE collection=?;", [collection]), 10) ||
    0
  );
}

/**
 * Run one statement (or a `;`-separated pair) against the test DB and return the
 * last row's first column as a trimmed string.
 *
 * Via PYTHON, not the `sqlite3` CLI. The CLI is an undeclared system dependency:
 * macOS ships it and GitHub's runner images include it, so it worked everywhere
 * we happened to look — and the mini-PC runner failed instantly with
 * `spawnSync sqlite3 ENOENT`. Python is already a hard requirement here (the
 * Playwright webServer boots the scrubber from its venv), so this removes a
 * dependency instead of adding one.
 *
 * Parameters are BOUND, not interpolated — the old CLI form pasted an email
 * straight into SQL, which a test address containing a quote would have broken.
 */
export function execSql(sql: string, params: string[] = []): string {
  const script = [
    "import sqlite3, sys, json",
    `db = sqlite3.connect(${JSON.stringify(TEST_DB)}, timeout=8)`,
    "sql = json.loads(sys.argv[1]); params = json.loads(sys.argv[2])",
    "cur = None",
    "for stmt in [s for s in sql.split(';') if s.strip()]:",
    "    cur = db.execute(stmt, params if '?' in stmt else [])",
    "row = cur.fetchone() if cur else None",
    "db.commit()",
    "print('' if row is None else row[0])",
  ].join("\n");
  return execFileSync("python3", ["-c", script, JSON.stringify(sql), JSON.stringify(params)])
    .toString()
    .trim();
}

/** A unique email so a test can register its own fresh account. */
export function freshEmail(tag: string): string {
  return `${tag}-${process.pid}-${Math.floor(performance.now())}@quon.test`;
}
