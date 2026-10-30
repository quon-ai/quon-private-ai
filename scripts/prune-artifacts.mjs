#!/usr/bin/env node
// Keep only the newest N artifacts of each *disposable* kind, and never touch
// the ones that are evidence.
//
//   node scripts/prune-artifacts.mjs            # delete
//   DRY_RUN=true node scripts/prune-artifacts.mjs
//
// The distinction below is the whole design. `playwright-report` is a debugging
// aid: nobody has ever opened the report of a passing suite, and 174 MB of them
// exhausted the artifact quota on 2026-08-16 — which then failed an E2E job
// whose tests had all passed. The SBOM and licence inventories are the opposite:
// they are the machine-readable evidence an EU-CRA or procurement review asks
// for, they carry deliberate 30/90-day retention, and this script must never
// delete them. Anything not named in KEEP_NEWEST is left alone by default, so a
// new artifact kind is safe until someone deliberately adds it here.
//
// Bounded by COUNT, not age. An age rule was tried for the runner's pip cache
// the same day and deleted nothing: 14 GB had accrued in under two weeks, so
// every file was "recent". A count cap cannot be outrun by volume.
import { appendFileSync } from "node:fs";

const KEEP_NEWEST = {
  "playwright-report": 5,
};

const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const dryRun = String(process.env.DRY_RUN ?? "").toLowerCase() === "true";
if (!repo || !token) {
  console.error("need GITHUB_REPOSITORY and GH_TOKEN");
  process.exit(2);
}

const api = async (path, init = {}) => {
  const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      ...(init.headers ?? {}),
    },
  });
  if (!r.ok && r.status !== 404) throw new Error(`GitHub API ${r.status} on ${path}`);
  return r.status === 204 || r.status === 404 ? null : r.json();
};

// Paginate: with retention windows and many runs a day, one page is not enough,
// and a silent truncation here would look exactly like "the prune works".
const all = [];
for (let page = 1; page <= 20; page++) {
  const res = await api(`actions/artifacts?per_page=100&page=${page}`);
  const batch = res?.artifacts ?? [];
  all.push(...batch);
  if (batch.length < 100) break;
}

const live = all.filter((a) => !a.expired);
const mb = (n) => (n / 1048576).toFixed(1);
const before = live.reduce((a, r) => a + r.size_in_bytes, 0);

const doomed = [];
for (const [name, keep] of Object.entries(KEEP_NEWEST)) {
  const of = live
    .filter((a) => a.name === name)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  doomed.push(...of.slice(keep));
}

const lines = [`## Artifact housekeeping${dryRun ? " (dry run)" : ""}`, ""];
if (!doomed.length) {
  lines.push(`Nothing to prune. ${live.length} live artifacts, ${mb(before)} MB.`);
} else {
  const freed = doomed.reduce((a, r) => a + r.size_in_bytes, 0);
  lines.push(
    `| kind | live | keeping | deleting | freeing |`,
    `| --- | --- | --- | --- | --- |`,
    ...Object.entries(KEEP_NEWEST).map(([name, keep]) => {
      const n = live.filter((a) => a.name === name).length;
      const d = doomed.filter((a) => a.name === name);
      return `| ${name} | ${n} | ${Math.min(n, keep)} | ${d.length} | ${mb(
        d.reduce((a, r) => a + r.size_in_bytes, 0),
      )} MB |`;
    }),
    "",
    `Total before: ${mb(before)} MB · freeing ${mb(freed)} MB.`,
    "",
    `Untouched (evidence, not debris): ${
      [...new Set(live.filter((a) => !(a.name in KEEP_NEWEST)).map((a) => a.name))].join(", ") ||
      "none"
    }`,
  );
}

let deleted = 0;
if (!dryRun) {
  for (const a of doomed) {
    try {
      await api(`actions/artifacts/${a.id}`, { method: "DELETE" });
      deleted++;
    } catch (e) {
      // One failed delete must not abort the sweep — the next run retries it.
      console.error(`could not delete ${a.id} (${a.name}): ${e.message}`);
    }
  }
  lines.push("", `Deleted ${deleted}/${doomed.length}.`);
}

const summary = lines.join("\n");
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
