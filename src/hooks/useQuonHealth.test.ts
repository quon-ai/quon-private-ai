import { describe, expect, it } from "vitest";

import { shouldFlipToOffline } from "@/lib/healthStore";

// The anti-flicker grace period exists so a mobile background-tab wake-up
// hiccup does not flip the badge. Applied unconditionally it would hide a real
// outage on an already-open tab for up to two 30s poll intervals (a green
// "QUON Active" badge over a dead backend), so it forgives exactly one poll:
// the stale one that fires right after the tab resumes from background.
describe("shouldFlipToOffline", () => {
  it("never flips while the tab is hidden (background suspends JS)", () => {
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

  it("flips on the very first failed poll while the tab is in the foreground and was not a resume (a genuine outage)", () => {
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
