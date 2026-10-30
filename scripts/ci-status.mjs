#!/usr/bin/env node
// What CI actually did, in one screen — with "cancelled" disambiguated.
//
//   node scripts/ci-status.mjs            # last 8 runs
//   node scripts/ci-status.mjs 20         # last 20
//   node scripts/ci-status.mjs --branch main
//
// The reason this file exists, in one sentence: GitHub reports a job killed by
// `timeout-minutes` as **cancelled**, the same word it uses for a run superseded
// by a newer push. On 2026-08-15/16 every CI run read "cancelled", which looked
// exactly like the concurrency rule working as designed. It wasn't — two jobs
// were timing out on every single run, and the gate had been dead for two days.
// Nothing in `gh run list` distinguishes the two. This does:
//
//   TIMED OUT   ran, and ran for ~its whole timeout-minutes
//   superseded  ran, cancelled early — a newer push, or a human
//   never ran   cancelled while still queued; it never got the runner at all
//
// `q+…` is queue wait, shown when it exceeds 90s. On a single-runner setup it is
// routinely the largest number on the screen — 70 minutes for one job on
// 2026-08-16 — and `gh run list` cannot show it at all.
//
// Auth: GH_TOKEN, else whatever `gh auth token` hands over.
import { execFileSync } from "node:child_process";
import { budgetFor, fmt, timings, verdictFor } from "./ci-budgets.mjs";

const args = process.argv.slice(2);
const branchIdx = args.indexOf("--branch");
const branch = branchIdx >= 0 ? args[branchIdx + 1] : null;
const limit = Number(args.find((a) => /^\d+$/.test(a))) || 8;

const token =
  process.env.GH_TOKEN || execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const repo =
  process.env.GITHUB_REPOSITORY ||
  execFileSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    encoding: "utf8",
  }).trim();

const api = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (!r.ok) throw new Error(`GitHub API ${r.status} on ${path}`);
  return r.json();
};

const q = new URLSearchParams({ per_page: String(limit) });
if (branch) q.set("branch", branch);
const { workflow_runs: runs } = await api(`actions/runs?${q}`);

const C = {
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  off: "\x1b[0m",
};
const paint = (s, c) => (process.stdout.isTTY ? c + s + C.off : s);

for (const run of runs) {
  const when = run.created_at.replace("T", " ").replace("Z", "");
  const head = `${when}  ${run.name}  [${run.head_branch}]  ${run.head_sha.slice(0, 7)}`;
  console.log(`\n${paint(head, C.dim)}`);

  const { jobs } = await api(`actions/runs/${run.id}/jobs?per_page=100`);
  for (const job of jobs) {
    const spec = budgetFor(job.name);
    const { queueSec, runSec, everRan } = timings(job);
    const verdict = verdictFor(job, spec, runSec, everRan);

    const colour =
      verdict === "success"
        ? C.green
        : verdict === "failure" || verdict === "TIMED OUT"
          ? C.red
          : C.dim;

    const over = spec?.budget && runSec != null && runSec > spec.budget;
    const budget = spec?.budget
      ? `${over ? paint("over", C.yellow) : "ok"} /${fmt(spec.budget)}`
      : "";
    // Queue wait shown separately and only when it is worth noticing: on one
    // runner it is routinely the largest number on the screen, and it is the
    // one thing `gh run list` cannot tell you at all.
    const queued = queueSec > 90 ? paint(`q+${fmt(queueSec)}`, C.yellow) : "";
    console.log(
      `  ${paint(verdict.padEnd(11), colour)} ${fmt(runSec).padStart(7)}  ${budget.padEnd(
        14,
      )} ${queued.padEnd(12)} ${job.name}`,
    );
  }
}
console.log();
