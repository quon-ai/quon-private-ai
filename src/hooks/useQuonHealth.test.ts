import { describe, expect, it } from "vitest";

import { shouldFlipToOffline } from "@/lib/healthStore";

// report #5 (2026-07-15 UX walkthrough): "while the backend was down, the header
// still showed a green 'QUON Active' badge" — the anti-flicker grace period (added
// 2026-07-02 to stop a mobile background-tab wake-up hiccup from flipping the
// badge) used to apply unconditionally, so a REAL outage on an already-open tab
// could stay green for up to two 30s poll intervals. It must now only forgive the
// one stale poll that fires right after the tab resumes from background.
describe("shouldFlipToOffline", () => {
  it("never flips while the tab is hidden (background suspends JS — see the 2026-07-02 fix)", () => {
    expect(
      shouldFlipToOffline({
        visibilityHidden: true,
        isResumePoll: false,
        everSucceeded: true,
        consecutiveFails: 5,
      }),
    ).toBe(false);
  });

  it("forgives exactly the first failure of a resume (wake-up) poll", () => {
    expect(
      shouldFlipToOffline({
        visibilityHidden: false,
        isResumePoll: true,
        everSucceeded: true,
        consecutiveFails: 1,
      }),
    ).toBe(false);
  });

  it("flips on the resume poll's SECOND consecutive failure", () => {
    expect(
      shouldFlipToOffline({
        visibilityHidden: false,
        isResumePoll: true,
        everSucceeded: true,
        consecutiveFails: 2,
      }),
    ).toBe(true);
  });

  it("flips on the very FIRST failed poll while the tab is in the foreground and was not a resume (a genuine outage)", () => {
    expect(
      shouldFlipToOffline({
        visibilityHidden: false,
        isResumePoll: false,
        everSucceeded: true,
        consecutiveFails: 1,
      }),
    ).toBe(true);
  });

  it("flips immediately if the scrubber has never been reachable (nothing to forgive)", () => {
    expect(
      shouldFlipToOffline({
        visibilityHidden: false,
        isResumePoll: true,
        everSucceeded: false,
        consecutiveFails: 1,
      }),
    ).toBe(true);
  });
});
