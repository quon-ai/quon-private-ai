import { useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Brain, Lock } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { dismissOnboardingTeaser } from "@/lib/onboardingStore";
import { Notice } from "./Notice";

/**
 * Onboarding step 2: one dismissible inline card surfacing the two things
 * worth knowing beyond the core redact/send loop - Review mode and Memory &
 * Projects. Not a tour: each row is a single fact + a "Show me" shortcut: it
 * is not required reading and never gates anything.
 */
export function OnboardingTeaserCard({
  onShowReview,
  onDismiss,
}: {
  /** Turn Review mode on (the caller owns the protection-level pill). */
  onShowReview: () => void;
  onDismiss: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useT();

  function dismiss() {
    dismissOnboardingTeaser();
    onDismiss();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="mx-4 mb-2"
    >
      <Notice
        variant="info"
        icon={null}
        onDismiss={dismiss}
        className="items-start px-3.5 py-3 text-sm"
      >
        <p className="font-medium text-quon-text">{t("onboarding.teaser.heading")}</p>

        <div className="mt-2.5 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-quon-border bg-quon-surface-2 px-2.5 py-2">
            <div className="flex min-w-0 items-start gap-2">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-quon-indigo" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-quon-text">
                  {t("onboarding.teaser.reviewTitle")}
                </div>
                <div className="text-[11px] text-quon-muted">
                  {t("onboarding.teaser.reviewDescription")}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                onShowReview();
                dismiss();
              }}
              className="shrink-0 rounded-md border border-quon-indigo/30 bg-quon-indigo/10 px-2 py-1 text-[11px] font-medium text-quon-indigo transition hover:bg-quon-indigo/20"
            >
              {t("onboarding.teaser.showMe")}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-lg border border-quon-border bg-quon-surface-2 px-2.5 py-2">
            <div className="flex min-w-0 items-start gap-2">
              <Brain className="mt-0.5 h-3.5 w-3.5 shrink-0 text-quon-indigo" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-quon-text">
                  {t("onboarding.teaser.memoryTitle")}
                </div>
                <div className="text-[11px] text-quon-muted">
                  {t("onboarding.teaser.memoryDescription")}
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                dismiss();
                void navigate({ to: "/memory" });
              }}
              className="shrink-0 rounded-md border border-quon-indigo/30 bg-quon-indigo/10 px-2 py-1 text-[11px] font-medium text-quon-indigo transition hover:bg-quon-indigo/20"
            >
              {t("onboarding.teaser.showMe")}
            </button>
          </div>
        </div>

        <button
          onClick={dismiss}
          className="mt-2.5 text-xs font-medium text-quon-muted hover:text-quon-text"
        >
          {t("common.gotIt")}
        </button>
      </Notice>
    </motion.div>
  );
}
