#!/usr/bin/env node
// Enforce the per-job wall-clock budgets in ci-budgets.mjs, and write the run's
// real timings into the GitHub job summary so the run page states them instead
// of hiding them behind two API timestamps.
//
// Runs as a FINAL job (`needs:` every other job, `if: always()`), not as a step,
// and that placement is the whole point: the 25-minute regression lived in the
// POST-job cache save, which happens after the last step has already passed. A
// step-level timer cannot see it. The API's job duration can, because it spans
// setup and post-job too.
//
// Usage:
//   node scripts/ci-duration-ratchet.mjs <run_id>      # needs GH_TOKEN
//   GITHUB_STEP_SUMMARY=/dev/stdout node … <run_id>    # to eyeball it locally
import { appendFileSync, readFileSync } from "node:fs";
import { budgetFor, fmt, checkTimeoutDrift, timings, verdictFor } from "./ci-budgets.mjs";

const runId = process.argv[2];
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!runId || !repo || !token) {
  console.error(
    "usage: GH_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/ci-duration-ratchet.mjs <run_id>",
  );
  process.exit(2);
}

const res = await fetch(
  `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
  {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
    },
  },
);
if (!res.ok) {
  console.error(`GitHub API ${res.status}: ${await res.text()}`);
  process.exit(2);
}
const { jobs } = await res.json();

const rows = [];
const breaches = [];
const failures = [];
const skipped = []; // verdicts that mean 'this job never proved anything'

for (const job of jobs) {
  if (job.name.startsWith("Gate")) continue; // this job, still running
  const spec = budgetFor(job.name);
  const { queueSec, runSec, everRan } = timings(job);
  const verdict = verdictFor(job, spec, runSec, everRan);

  // The slowest step is the first thing anyone asks about a slow job, and it is
  // otherwise a log-scroll away.
  const slowest = (job.steps ?? [])
    .map((s) => ({
      name: s.name,
      sec:
        s.started_at && s.completed_at
          ? (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 1000
          : 0,
    }))
    .sort((a, b) => b.sec - a.sec)[0];

  const over = spec?.budget && runSec != null && runSec > spec.budget;
  rows.push(
    `| ${job.name} | ${verdict}${over ? " ⚠️" : ""} | ${fmt(queueSec)} | ${fmt(
      runSec,
    )} | ${spec?.budget ? fmt(spec.budget) : "—"} | ${
      slowest ? `${slowest.name} (${fmt(slowest.sec)})` : "—"
    } |`,
  );

  if (over) breaches.push(`${job.name} ran ${fmt(runSec)}, over its ${fmt(spec.budget)} budget`);
  // Judge the VERDICT, not the raw conclusion. "superseded" and "never ran" are
  // both reported by GitHub as `cancelled`, and neither says anything about the
  // code — treating them as failures is how a gate starts crying wolf.
  if (verdict === "TIMED OUT") failures.push(`${job.name} hit its ${fmt(spec.timeout)} timeout`);
  // `queued`/`in_progress` only show up when this is run BY HAND against a live
  // run (a documented use — see the header). In the Gate job they cannot occur,
  // because it `needs:` every job. Reporting them as failures would make the
  // manual invocation lie.
  else if (job.status !== "completed") {
    skipped.push(job.name);
    continue;
  } else if (["skipped", "superseded", "never ran"].includes(verdict)) skipped.push(job.name);
  else if (verdict !== "success") failures.push(`${job.name}: ${verdict}`);
}

const drift = checkTimeoutDrift(
  readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
);

// "Nothing failed" is not "everything passed". Observed 2026-08-17 on a run
// whose four jobs were ALL superseded by a newer push: every verdict was
// benign, so this job reported SUCCESS — a green Gate against a commit that
// was never tested at all. Exactly the kind of quiet false assurance the whole
// file exists to prevent, and it took real data to see it.
const verified = rows.length - skipped.length;

const out = [
  "## CI timings",
  "",
  "| job | result | queued | ran | budget | slowest step |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
];
if (drift) out.push(`> ⚠️ ${drift}`, "");
if (breaches.length)
  out.push(
    "### ⚠️ Over budget",
    "",
    ...breaches.map((b) => `- ${b}`),
    "",
    "A budget is a tripwire for a 10x regression, not a performance target.",
    "Re-measure and raise it deliberately, or find what got slower — do NOT",
    "loosen it to turn the build green.",
    "",
  );

function appendSummary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
}

const summary = out.join("\n");
console.log(summary);
appendSummary(summary);

if (verified <= 0) {
  const msg =
    `NOTHING WAS VERIFIED: all ${rows.length} jobs were superseded, skipped or never ran. ` +
    "A green Gate here would claim this commit was tested when it was not.";
  console.error("\n" + msg);
  appendSummary(`> \u26a0\ufe0f ${msg}`);
  process.exit(1);
}

if (failures.length) {
  console.error("\nFAILED jobs:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
if (breaches.length || drift) process.exit(1);
console.log("\nAll jobs green and inside budget.");
