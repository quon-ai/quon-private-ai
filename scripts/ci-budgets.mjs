// Wall-clock budgets for each CI job — a RATCHET, exactly like the detection
// floors in tests/test_corpus.py and the send-path budget in LATENCY.md.
//
// Why this exists: on 2026-08-15 the Backend job went from ~2 min to 25 min and
// then died on its timeout, EVERY run, for two days — and nothing said so. The
// duration was visible only by subtracting two API timestamps by hand. A number
// that matters and is measured nowhere is a number that regresses in silence;
// this project already learned that for detection recall and for send latency,
// and CI itself was the last place still running on trust.
//
// `budget` is generous on purpose. It is not a performance target — it is a
// tripwire for the 10x regression. The 2 min -> 25 min cache upload would have
// tripped a 6 min budget on the first run it appeared, twelve days and 14 GB
// before a human noticed. Tighten only after re-measuring; never loosen a budget
// to make a red build green, which is exactly how the ratchet gets defeated.
//
// `timeout` MUST mirror `timeout-minutes` in .github/workflows/ci.yml. It is not
// used to enforce anything — it is how ci-status.mjs tells a job that TIMED OUT
// apart from one that was SUPERSEDED, because GitHub reports both as
// "cancelled". Confusing those two is what hid the outage. checkTimeoutDrift()
// below fails loudly if the two files disagree.

export const JOBS = [
  // measured 2026-08-16: 5m20s (typecheck · lint · unit · build)
  { match: /^Frontend/, label: "Frontend", budget: 12 * 60, timeout: 20 * 60 },
  // measured 2026-08-16: 2m01s and 1m45s on two runs, post-cache-fix.
  // Pre-fix this job sat at 25m07s — the timeout — on every single run.
  { match: /^Backend/, label: "Backend", budget: 6 * 60, timeout: 25 * 60 },
  // MEASURED 2026-08-16, run 31969370349: 53m02s for the job, 50.5m of tests
  // (211 passed · 3 flaky · 4 skipped · 0 failures) on the self-hosted box.
  //
  // Worth keeping as a lesson about estimates: this budget was briefly left
  // unenforced because the only datum was "test 99 of 218 after 42m10s", which
  // linearly extrapolates to ~93 min. The truth was 53. The back half of the
  // suite is far faster than the front, and a straight-line extrapolation was
  // 75% high — high enough that it was used to argue E2E could not run on this
  // machine at all. Refusing to write 95 into this field was the right call.
  //
  // RATCHETED 2026-08-19 → 55m, after workers:2 landed. Measured 39m54s on run
  // 32254062108 (was 53m02s serial). A ratchet is tightened when the measurement
  // genuinely improves — that is the whole point of one — but never loosened to
  // turn a build green. 55 leaves ~38% headroom over the measurement, which is
  // a tripwire for a 10x-class regression, not a performance target. If E2E
  // legitimately grows past this because the SUITE grew, add the tests and move
  // this with a new measurement quoted; do not nudge it to pass.
  //
  // HOSTED runners are a different machine class and get their own measured
  // entry, not a loosened one: run 41108741619 (quon-private-ai, ubuntu-latest,
  // 2 cores, 1 worker) measured 59m08s on 2026-10-30 with 200 passed · 14
  // skipped. 80 min is the same ~38% headroom over that measurement. The Gate
  // job exports CI_RUNNER (empty on hosted runners) so this file can tell.
  {
    match: /^E2E/,
    label: "E2E",
    budget: (process.env.CI_RUNNER ? 55 : 80) * 60,
    timeout: 100 * 60,
  },
  // measured 2026-08-16: 5m36s with a warm cargo cache.
  { match: /^Native/, label: "Native", budget: 12 * 60, timeout: 30 * 60 },
  // Listed so checkTimeoutDrift() below sees every timeout-minutes in ci.yml —
  // NOT enforced: this is the job that runs the ratchet, and a job cannot
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
 * steps — so a job that sat 72 minutes in the queue and was then cancelled
 * measures as a 72-minute "run" and gets called a TIMEOUT against a 20-minute
 * limit. Observed here on 2026-08-16 the first time this script was pointed at
 * real data.
 *
 * Splitting them also surfaces queue wait, which is the number that matters most
 * on a single-runner setup and which nothing else in this repo reports: on that
 * same run, Native waited 64 minutes for the lane and then ran in 5m37s.
 */
export function timings(job) {
  const t = (s) => (s ? Date.parse(s) : null);
  const created = t(job.created_at);
  const started = t(job.started_at);
  const done = t(job.completed_at);
  const steps = (job.steps ?? []).filter((s) => s.conclusion != null).length;
  // Zero executed steps AND no gap between created and started ⇒ never dispatched.
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
 * mis-classifying timeouts as supersedes — silently, which is the one failure
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
