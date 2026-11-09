// Wall-clock budgets for each CI job: a ratchet, like the detection floors in
// tests/test_corpus.py and the send-path budget in LATENCY.md.
//
// Why this exists: a job's duration is visible only by subtracting two API
// timestamps by hand, so a job that goes from 2 min to 25 min and dies on its
// timeout on every run says nothing on its own. A number that matters and is
// measured nowhere is a number that regresses in silence.
//
// `budget` is generous on purpose. It is not a performance target, it is a
// tripwire for the 10x regression: a 2 min -> 25 min cache upload trips a 6 min
// budget on the first run it appears. Tighten only after re-measuring; never
// loosen a budget to make a red build green, which is exactly how the ratchet
// gets defeated.
//
// `timeout` must mirror `timeout-minutes` in .github/workflows/ci.yml. It
// enforces nothing; it is how ci-status.mjs tells a job that timed out apart
// from one that was superseded, because GitHub reports both as "cancelled".
// checkTimeoutDrift() below fails loudly if the two files disagree.

export const JOBS = [
  // measured: 5m20s (typecheck · lint · unit · build)
  { match: /^Frontend/, label: "Frontend", budget: 12 * 60, timeout: 20 * 60 },
  // measured on two runs: 2m01s and 1m45s.
  { match: /^Backend/, label: "Backend", budget: 6 * 60, timeout: 25 * 60 },
  // measured on the self-hosted box: 53m02s serial (50.5m of tests), 39m54s
  // with two workers. 55 leaves ~38% headroom over the two-worker measurement,
  // a tripwire for a 10x-class regression, not a performance target.
  //
  // Do not estimate this suite by straight-lining a partial run: the back half
  // is far faster than the front, and a linear extrapolation from the first
  // hundred tests overshoots by 75%. Measure the whole run before writing a
  // number here.
  //
  // A ratchet is tightened when the measurement genuinely improves, never
  // loosened to turn a build green. If E2E legitimately grows past this because
  // the suite grew, add the tests and move this with a new measurement quoted;
  // do not nudge it to pass.
  //
  // Hosted runners are a different machine class and get their own measured
  // entry, not a loosened one: 59m08s on ubuntu-latest (2 cores, 1 worker), and
  // 80 min is the same ~38% headroom over that. The Gate job exports CI_RUNNER
  // (empty on hosted runners) so this file can tell.
  {
    match: /^E2E/,
    label: "E2E",
    budget: (process.env.CI_RUNNER ? 55 : 80) * 60,
    timeout: 100 * 60,
  },
  // measured: 5m36s with a warm cargo cache.
  { match: /^Native/, label: "Native", budget: 12 * 60, timeout: 30 * 60 },
  // Listed so checkTimeoutDrift() below sees every timeout-minutes in ci.yml -
  // Not enforced: this is the job that runs the ratchet, and a job cannot
  // measure its own completion (it is still in_progress while it reports).
  { match: /^Gate/, label: "Gate", budget: null, timeout: 5 * 60 },
];

export function budgetFor(jobName) {
  return JOBS.find((j) => j.match.test(jobName)) ?? null;
}

/**
 * Split a job's lifetime into QUEUE WAIT and EXECUTION, and say whether it ever
 * actually ran.
 *
 * The naive `completed_at - started_at` is wrong in a way that produces
 * confident nonsense, which is worse than no tool at all. When a job never gets
 * dispatched, GitHub sets `started_at` equal to `created_at` and returns zero
 * steps - so a job that sat 72 minutes in the queue and was then cancelled
 * measures as a 72-minute "run" and gets called a timeout against a 20-minute
 * limit.
 *
 * Splitting them also surfaces queue wait, which is the number that matters most
 * on a single-runner setup and which nothing else in this repo reports: a job
 * can wait an hour for the lane and then run in five minutes.
 */
export function timings(job) {
  const t = (s) => (s ? Date.parse(s) : null);
  const created = t(job.created_at);
  const started = t(job.started_at);
  const done = t(job.completed_at);
  const steps = (job.steps ?? []).filter((s) => s.conclusion != null).length;
  // Zero executed steps AND no gap between created and started => never dispatched.
  const everRan = steps > 0 || (created != null && started != null && started > created);
  return {
    queueSec: created != null && started != null ? Math.max(0, (started - created) / 1000) : null,
    runSec: everRan && started != null && done != null ? (done - started) / 1000 : null,
    everRan,
  };
}

/** The one distinction that matters: timeout, supersede, or never dispatched. */
export function verdictFor(job, spec, runSec, everRan) {
  if (job.status !== "completed") return job.status;
  if (job.conclusion !== "cancelled") return job.conclusion ?? "—";
  if (!everRan) return "never ran";
  if (spec && runSec != null && runSec >= spec.timeout - 60) return "TIMED OUT";
  return "superseded";
}

export function fmt(sec) {
  if (sec == null || Number.isNaN(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

/**
 * The table above duplicates ci.yml's timeout-minutes, so it can drift. Rather
 * than parse YAML (a dependency, and a parser is one more thing to be wrong),
 * collect the numbers with a regex and compare them as a multiset: if someone
 * changes a timeout in ci.yml and not here, ci-status.mjs would start
 * mis-classifying timeouts as supersedes - silently, which is the one failure
 * mode this whole file exists to prevent.
 *
 * Returns null when consistent, or a human-readable complaint.
 */
export function checkTimeoutDrift(ciYmlText) {
  const inYml = [...ciYmlText.matchAll(/^\s*timeout-minutes:\s*(\d+)\s*$/gm)]
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const inTable = JOBS.map((j) => j.timeout / 60).sort((a, b) => a - b);
  const same = inYml.length === inTable.length && inYml.every((v, i) => v === inTable[i]);
  return same ? null : `timeout drift: ci.yml has [${inYml}] but ci-budgets.mjs has [${inTable}]`;
}
