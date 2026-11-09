/**
 * First-login onboarding - "guided doing" instead of a tour.
 *
 * State machine (persisted in the encrypted `quonStore`, see QuonState.onboarding*):
 *   0 - fresh chat shows an extra intro turn inviting the user to try a real
 *       message with a name + email. Any send (whatever the content) advances
 *       to step 1; the composer is never blocked or required.
 *   1 - after the first real scrubbed send, the "Redacted N" badge pulses once
 *       with a callout. Completing (or skipping) this step marks the whole
 *       flow `seen` - onboarding never runs again for this account.
 *   2 - a single dismissible teaser card (Review mode + Memory/Projects). Only
 *       reachable via the "?" re-entry menu item (AppSidebar, wired separately)
 *       through `reopenOnboardingTeaser` once the flow is already `seen`.
 *   "done" - nothing to show.
 *
 * Eligibility bridge: only accounts registered after this shipped ever reach
 * step 0. The server marks that with `MeResponse.onboarding_pending`, reported
 * exactly once on the /auth/verify response (see auth.py) - the one
 * unambiguous "this account just came alive" event, because verification and
 * the later unlock() that actually reaches `ready` may happen in different
 * tabs or even different devices. `captureEligibility` stashes that one-shot
 * signal in sessionStorage (tab-scoped, not sensitive - just a boolean) the
 * moment it's seen; `armIfEligible` consumes it once `ready` is reached in
 * that same tab and promotes it into `onboardingStep`. If verify and unlock
 * happen in different tabs/devices, the sessionStorage marker is simply
 * absent there and the account quietly never sees onboarding - fails closed
 * to "no onboarding", never to "wrong account sees onboarding".
 *
 * `armIfEligible` is called from `AppShell.tsx`'s ready-transition effect -
 * deliberately not from authStore's login()/unlock() themselves - because
 * that effect also runs `stopSync()` for any new/unknown previous account
 * (including every brand-new account's very first ready transition ever),
 * and `stopSync` calls `quonStore.resetState()`. Arming before that reset
 * would be silently wiped back to the "already seen" defaults a moment later.
 *
 * Note `onboardingStep`/`onboardingSeen` live in `QuonState` (quonStore.ts)
 * alongside `alwaysRedact`/`protectionLevel` - that store is a per-device
 * localStorage cache, not one of the E2E-synced blob collections (chat/
 * memory/documents/projects, see syncEngine.ts). So there is no cross-device
 * "already finished onboarding elsewhere" state to race against here: the
 * sessionStorage marker (itself single-consumption, backed by the verify
 * token) is the only source of truth `armIfEligible` needs.
 */

import { getQuonState, quon } from "./quonStore";

const ELIGIBLE_KEY = "quon_onboarding_eligible_v1";

/** Call right after a /auth/verify (or any MeResponse) response lands. Stashes
 *  the one-shot "brand new account" signal for this tab only. */
export function captureEligibility(onboardingPending: boolean | undefined): void {
  if (!onboardingPending || typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(ELIGIBLE_KEY, "1");
  } catch {
    /* ignore (private mode / quota) - worst case, no onboarding for this signup */
  }
}

/** Call once the app reaches `ready` (master key unlocked, right after a fresh
 *  `login()`/`unlock()`). Promotes a same-tab eligibility marker into the step
 *  state, then clears the marker so it's consumed exactly once - the marker
 *  itself is the only source of truth needed (no cross-device state to race
 *  against; see the module docstring), so this is a plain synchronous check. */
export function armIfEligible(): void {
  if (typeof sessionStorage === "undefined") return;
  let eligible = false;
  try {
    eligible = sessionStorage.getItem(ELIGIBLE_KEY) === "1";
    sessionStorage.removeItem(ELIGIBLE_KEY);
  } catch {
    /* ignore */
  }
  if (!eligible) return;
  quon.setOnboardingStep(0);
  quon.setOnboardingSeen(false);
}

/** Advance past step 0 (any message sent from the empty-chat intro). */
export function advanceOnboardingFromIntro(): void {
  if (getQuonState().onboardingStep === 0) quon.setOnboardingStep(1);
}

/** Skip step 1 straight to the step-2 teaser (and mark the flow seen, same as
 *  completing step 1 normally) - used when the step-0 message had nothing
 *  redacted, so the step-1 callout has no badge to anchor to and would never
 *  render; leaving `onboardingStep` at 1 in that case would strand the flow. */
export function skipToOnboardingTeaser(): void {
  if (getQuonState().onboardingStep !== 0) return;
  quon.setOnboardingStep(2);
  quon.setOnboardingSeen(true);
}

/** Advance past step 1 (the "Redacted N" callout was shown for a real scrubbed
 *  send). Completing step 1 is what marks the whole flow `seen` - step 2 is an
 *  optional bonus card, not a gate. */
export function advanceOnboardingFromCallout(): void {
  if (getQuonState().onboardingStep !== 1) return;
  quon.setOnboardingStep(2);
  quon.setOnboardingSeen(true);
}

/** Dismiss the step-2 teaser card (its own "Got it"). */
export function dismissOnboardingTeaser(): void {
  if (getQuonState().onboardingStep === 2) quon.setOnboardingStep("done");
}

/** Skip the entire flow from any in-progress step ("Skip" affordance). Marks
 *  `seen` immediately so it never re-triggers. */
export function skipOnboarding(): void {
  quon.setOnboardingStep("done");
  quon.setOnboardingSeen(true);
}
