#!/usr/bin/env node
/**
 * Cancel CI runs — and actually cancel them.
 *
 * ⚠️ `gh run cancel <id>` is a SILENT NO-OP on a QUEUED run. It returns
 * "Request to cancel workflow submitted", exits 0, and the run keeps sitting in
 * the queue holding the single self-hosted runner. Only
 * `POST /actions/runs/{id}/force-cancel` moves a run that has not started. That
 * cost a round on 2026-09-04, and the failure mode is the worst kind: the tool
 * reports success and nothing happens.
 *
 * So: this picks the endpoint from the run's ACTUAL status, and re-reads the
 * status afterwards instead of trusting the API's acknowledgement. It reports
 * what it observed, not what it asked for.
 *
 * Usage:
 *   npm run ci:cancel -- 32470031780 [more ids…]
 *   npm run ci:cancel -- --queued            # every queued run (the pile-up)
 *   npm run ci:cancel -- --queued --keep main
 *
 * Auth: GH_TOKEN, else `gh auth token` — same as ci-status.mjs.
 */
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const wantQueued = args.includes("--queued");
const keepIdx = args.indexOf("--keep");
const keepBranch = keepIdx >= 0 ? args[keepIdx + 1] : null;
const ids = args.filter((a) => /^\d+$/.test(a));

if (!wantQueued && ids.length === 0) {
  console.error(
    "usage: npm run ci:cancel -- <run_id…>\n" +
      "       npm run ci:cancel -- --queued [--keep <branch>]",
  );
  process.exit(2);
}

const token =
  process.env.GH_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const repo =
  process.env.GITHUB_REPOSITORY ||
  execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    encoding: "utf8",
  }).trim();

const api = async (path, method = "GET") => {
  const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  // 409 from force-cancel means "not in a cancellable state" — usually already
  // finished. That is information, not a crash.
  if (!r.ok && r.status !== 409) throw new Error(`GitHub API ${r.status} ${method} ${path}`);
  return { status: r.status, body: r.status === 204 || method !== "GET" ? null : await r.json() };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets = ids.map((id) => ({ id: Number(id) }));
if (wantQueued) {
  const { body } = await api("actions/runs?status=queued&per_page=50");
  targets = (body.workflow_runs ?? [])
    .filter((r) => !keepBranch || r.head_branch !== keepBranch)
    .map((r) => ({ id: r.id, name: r.name, branch: r.head_branch }));
  if (targets.length === 0) {
    console.log("nothing queued.");
    process.exit(0);
  }
  console.log(`${targets.length} queued run(s)${keepBranch ? ` (keeping ${keepBranch})` : ""}:`);
}

let failed = 0;
for (const t of targets) {
  const before = (await api(`actions/runs/${t.id}`)).body;
  const label = `${t.id} ${before.name ?? ""} [${before.head_branch ?? "?"}] ${before.head_sha?.slice(0, 7) ?? ""}`;

  if (before.status === "completed") {
    console.log(`  ${label} — already completed (${before.conclusion}); nothing to do`);
    continue;
  }

  // SAY WHAT IS ABOUT TO DIE, BEFORE IT DIES. On 2026-09-04 this script was
  // pointed at an id taken from `gh run list --limit 1` on the assumption it
  // was finished; it was in_progress, and 45 minutes of E2E went with it. The
  // label printed after the fact is no use to whoever is reading the scroll.
  console.log(`  ${label} — ${before.status}; cancelling …`);

  // A queued run has no job to interrupt, so the polite endpoint does nothing.
  const endpoint = before.status === "queued" ? "force-cancel" : "cancel";
  await api(`actions/runs/${t.id}/${endpoint}`, "POST");

  // TRUST THE STATUS, NOT THE ACKNOWLEDGEMENT. This whole script exists because
  // an accepted request and a cancelled run are different things.
  let after = before;
  for (let i = 0; i < 6; i++) {
    await sleep(2000);
    after = (await api(`actions/runs/${t.id}`)).body;
    if (after.status === "completed") break;
  }

  if (after.status === "completed") {
    console.log(`  ${label} — ${endpoint} → ${after.conclusion}`);
  } else if (endpoint === "cancel") {
    // It was in_progress, asked politely, and did not stop. Escalate.
    await api(`actions/runs/${t.id}/force-cancel`, "POST");
    let forced = after;
    for (let i = 0; i < 8; i++) {
      await sleep(2500);
      forced = (await api(`actions/runs/${t.id}`)).body;
      if (forced.status === "completed") break;
    }
    const verdict = forced.status === "completed" ? forced.conclusion : forced.status;
    console.log(`  ${label} — cancel did not take; force-cancel → ${verdict}`);
    if (forced.status !== "completed") failed++;
  } else {
    console.log(`  ${label} — STILL ${after.status} after force-cancel`);
    failed++;
  }
}

process.exit(failed > 0 ? 1 : 0);
