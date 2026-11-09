/**
 * First-login onboarding state machine + the verify->unlock eligibility bridge.
 * See onboardingStore.ts for the full design rationale.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  advanceOnboardingFromCallout,
  advanceOnboardingFromIntro,
  armIfEligible,
  captureEligibility,
  dismissOnboardingTeaser,
  skipOnboarding,
  skipToOnboardingTeaser,
} from "./onboardingStore";
import { getQuonState, quon } from "./quonStore";

beforeEach(() => {
  sessionStorage.clear();
  // Reset to the safe "already seen" defaults an existing account would have -
  // mirrors quonStore's own defaults, since resetState() isn't exported for tests.
  quon.setOnboardingStep("done");
  quon.setOnboardingSeen(true);
});

describe("eligibility bridge (verify -> unlock, possibly different tabs)", () => {
  it("an existing account (onboarding_pending undefined/false) never arms", () => {
    captureEligibility(false);
    armIfEligible();
    expect(getQuonState().onboardingStep).toBe("done");
    expect(getQuonState().onboardingSeen).toBe(true);

    captureEligibility(undefined);
    armIfEligible();
    expect(getQuonState().onboardingStep).toBe("done");
  });

  it("a fresh signup arms step 0 once verify->unlock completes in the same tab", () => {
    captureEligibility(true);
    armIfEligible();
    expect(getQuonState().onboardingStep).toBe(0);
    expect(getQuonState().onboardingSeen).toBe(false);
  });

  it("the eligibility marker is consumed exactly once (single-use, like the verify token)", () => {
    captureEligibility(true);
    armIfEligible();
    quon.setOnboardingStep("done");
    quon.setOnboardingSeen(true); // simulate the flow completing
    armIfEligible(); // a second call (e.g. a stray re-render) must not re-arm
    expect(getQuonState().onboardingStep).toBe("done");
  });

  it("verify and unlock in different tabs: no marker present -> fails closed to no onboarding", () => {
    // Nothing captured in this "tab" - armIfEligible must be a no-op.
    armIfEligible();
    expect(getQuonState().onboardingStep).toBe("done");
    expect(getQuonState().onboardingSeen).toBe(true);
  });
});

describe("step state machine", () => {
  it("advances 0 -> 1 on the first send, and is a no-op from other steps", () => {
    quon.setOnboardingStep(0);
    advanceOnboardingFromIntro();
    expect(getQuonState().onboardingStep).toBe(1);

    quon.setOnboardingStep(2);
    advanceOnboardingFromIntro(); // not step 0 - no-op
    expect(getQuonState().onboardingStep).toBe(2);
  });

  it("completing step 1 advances to 2 AND marks the whole flow seen", () => {
    quon.setOnboardingStep(1);
    quon.setOnboardingSeen(false);
    advanceOnboardingFromCallout();
    expect(getQuonState().onboardingStep).toBe(2);
    expect(getQuonState().onboardingSeen).toBe(true);
  });

  it("dismissing the step-2 teaser ends the flow", () => {
    quon.setOnboardingStep(2);
    dismissOnboardingTeaser();
    expect(getQuonState().onboardingStep).toBe("done");
  });

  it("skip marks seen immediately from any step", () => {
    quon.setOnboardingStep(0);
    skipOnboarding();
    expect(getQuonState().onboardingStep).toBe("done");
    expect(getQuonState().onboardingSeen).toBe(true);
  });

  it("skipToOnboardingTeaser jumps 0 -> 2 and marks seen (the no-PII-first-send edge case)", () => {
    // A step-1 callout with "0 redacted" would have nothing to point at - ScreenChat
    // calls this instead of advanceOnboardingFromIntro when the first send redacted
    // nothing, so the flow can't get stranded at an invisible step 1.
    quon.setOnboardingStep(0);
    quon.setOnboardingSeen(false);
    skipToOnboardingTeaser();
    expect(getQuonState().onboardingStep).toBe(2);
    expect(getQuonState().onboardingSeen).toBe(true);
  });

  it("skipToOnboardingTeaser is a no-op outside step 0", () => {
    quon.setOnboardingStep(1);
    skipToOnboardingTeaser();
    expect(getQuonState().onboardingStep).toBe(1);
  });
});
