import { AnimatePresence, motion } from "motion/react";
import { Eye, Lock, ShieldAlert, X } from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useT } from "@/lib/i18n/i18n";
import { skipOnboarding } from "@/lib/onboardingStore";

/**
 * Onboarding step 1: a callout pointing at the "Redacted N" badge right after
 * the user's first real scrubbed send. Desktop/tablet: an anchored bubble
 * above the badge. Mobile (375px): a bottom-docked sheet instead — a tooltip
 * anchored to a scroll-position-dependent badge is unreliable at that width,
 * and a sheet reads as deliberate rather than clipped/misplaced.
 *
 * Two distinct exits, per the "3 steps, always skippable" rule: "Got it"
 * completes step 1 normally (advances to the optional step-2 teaser and marks
 * the whole guided flow seen — `onDismiss` is `advanceOnboardingFromCallout`);
 * the corner X / "Skip the tour" end the flow immediately without the teaser
 * (`skipOnboarding`, also marks seen — either way it never re-triggers).
 */
export function OnboardingCallout({
  count,
  fallbackMode = false,
  onDismiss,
}: {
  count: number;
  /** True when this first send ran with AI enrichment skipped (local NER/regex
   *  only) — some items may have been missed. The default "celebrate the count"
   *  copy would be dishonest here (report #1, 2026-07-15 UX walkthrough): the
   *  very first thing a new user sees must not imply more protection than the
   *  send actually got. */
  fallbackMode?: boolean;
  /** Called for the primary "Got it" action — normal step-1 completion. */
  onDismiss: () => void;
}) {
  const isMobile = useIsMobile();
  const { t, plural } = useT();

  const body = (
    <>
      <div className="flex items-start gap-2">
        <div
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            fallbackMode ? "bg-quon-yellow/15" : "bg-quon-indigo/15"
          }`}
        >
          {fallbackMode ? (
            <ShieldAlert className="h-3.5 w-3.5 text-quon-yellow" />
          ) : (
            <Lock className="h-3.5 w-3.5 text-quon-indigo" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-quon-text">
            {fallbackMode
              ? t("onboarding.callout.fallback", { count })
              : plural(count, {
                  one: "onboarding.callout.normal.one",
                  other: "onboarding.callout.normal.other",
                })}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-quon-muted">
            <Eye className="h-3 w-3 shrink-0" /> {t("onboarding.callout.showHint")}
          </p>
        </div>
        <button
          onClick={skipOnboarding}
          aria-label={t("onboarding.callout.skipAriaLabel")}
          className="shrink-0 rounded-md p-1 text-quon-muted transition hover:bg-quon-surface-2 hover:text-quon-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={onDismiss}
          className="text-xs font-semibold text-quon-indigo hover:underline"
        >
          {t("common.gotIt")}
        </button>
        <button
          onClick={skipOnboarding}
          className="text-xs font-medium text-quon-muted hover:text-quon-text"
        >
          {t("onboarding.callout.skip")}
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: "spring", stiffness: 300, damping: 28 }}
          role="status"
          className="fixed inset-x-3 bottom-3 z-50 rounded-2xl border border-quon-indigo/30 bg-quon-bg px-4 py-3 shadow-2xl"
        >
          {body}
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ type: "spring", stiffness: 320, damping: 26 }}
        role="status"
        className="absolute bottom-full right-0 z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-quon-indigo/30 bg-quon-bg px-3.5 py-3 shadow-2xl"
      >
        {body}
      </motion.div>
    </AnimatePresence>
  );
}
