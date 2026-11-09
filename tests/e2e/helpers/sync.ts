import type { Page } from "@playwright/test";

/**
 * Run `action`, and don't return until the sync push it triggers has landed.
 *
 * Why this exists as a helper rather than hand-rolled copies: the order is the
 * whole trick, and every call site gets it wrong the same way.
 * `collectionSync` debounces a push by 1500 ms, so the sequence
 *
 *     await button.click();
 *     await confirmButton.click();
 *     await page.waitForResponse(isPush, { timeout: 8000 });   // <- too late
 *
 * registers the listener after the push has usually already gone out - a
 * two-click dialog comfortably outlasts 1500 ms. The wait then matches nothing
 * and burns its entire timeout, every single run: ~8 s of dead wait per test,
 * well over a minute per suite in one file alone.
 *
 * Worse than the waste, it makes cleanup non-deterministic in a way that only
 * shows up under parallelism: whether the write actually reached the server
 * before the context closed is left to luck, and a Review-mode flag or a
 * connector connection survives into the next spec's pass. That is the
 * cross-spec residue that makes `workers=2` unsafe.
 *
 * Registering the listener first removes the race entirely, and as a bonus the
 * wait resolves in ~1.5 s instead of timing out at 8 s.
 *
 * Non-fatal by design: cleanup must never fail a suite. But a miss is loud;
 * silence is what lets this class hide.
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
