import type { Page } from "@playwright/test";

/**
 * Run `action`, and don't return until the sync push it triggers has landed.
 *
 * Why this exists as a helper rather than three hand-rolled copies: all three
 * call sites got the ORDER wrong in the same way, and the order is the whole
 * trick. `collectionSync` debounces a push by 1500 ms, so the sequence
 *
 *     await button.click();
 *     await confirmButton.click();
 *     await page.waitForResponse(isPush, { timeout: 8000 });   // ← too late
 *
 * registers the listener AFTER the push has usually already gone out — a
 * two-click dialog comfortably outlasts 1500 ms. The wait then matches nothing
 * and burns its entire timeout, every single run. Measured 2026-08-18: the
 * paperless cleanup warned on 5 of 5 tests on an IDLE laptop, ~8 s of dead wait
 * each, ~80 s per suite in that one file alone.
 *
 * Worse than the waste, it made cleanup non-deterministic in a way that only
 * shows up under parallelism: whether the write actually reached the server
 * before the context closed was left to luck. That is the "leftover cross-spec
 * residue" that has kept `workers=2` off by default — a Review-mode flag or a
 * connector connection surviving into the next spec's pass.
 *
 * Registering the listener FIRST removes the race entirely, and as a bonus the
 * wait now resolves in ~1.5 s instead of timing out at 8 s.
 *
 * Non-fatal by design: cleanup must never fail a suite. But a miss is LOUD —
 * silence is what let this hide for weeks.
 */
export async function withSyncPush<T>(
  page: Page,
  action: () => Promise<T>,
  opts: { timeout?: number; label?: string; contains?: string } = {},
): Promise<T> {
  const { timeout = 15_000, label = "sync", contains } = opts;
  const landed = page
    .waitForResponse(
      (r) =>
        r.url().includes("/sync/push") &&
        r.ok() &&
        (contains ? (r.request().postData() ?? "").includes(contains) : true),
      { timeout },
    )
    .catch(() => null);

  const result = await action();

  if (!(await landed)) {
    console.warn(
      `[${label}] no /sync/push landed within ${timeout} ms — the account may keep ` +
        "this state for the next spec. Setup must repair it rather than assume it.",
    );
  }
  return result;
}
