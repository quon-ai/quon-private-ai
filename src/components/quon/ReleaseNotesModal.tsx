import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles, X } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { FEATURES } from "@/lib/features";
import { getUnseenRelease, markReleaseSeen, type Release } from "@/lib/releases";

/**
 * One-time "What's new" popup. Shows the latest release once per device (tracked
 * in localStorage), then never again. Mount it once inside the authenticated app
 * shell — it self-gates and renders nothing when there's nothing new.
 */
export function ReleaseNotesModal() {
  const { t } = useT();
  const [release, setRelease] = useState<Release | null>(null);

  useEffect(() => {
    setRelease(FEATURES.releaseNotes ? getUnseenRelease() : null);
  }, []);

  function close() {
    if (release) markReleaseSeen(release.id);
    setRelease(null);
  }

  useEffect(() => {
    if (!release) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [release]);

  return (
    <AnimatePresence>
      {release && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("nav.releaseAriaLabel", { title: release.title })}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="relative z-10 w-full max-w-md overflow-hidden rounded-2xl border border-quon-border bg-quon-bg shadow-2xl"
          >
            <div className="relative border-b border-quon-border bg-gradient-to-br from-quon-indigo/20 to-quon-bg px-6 py-5">
              <button
                onClick={close}
                aria-label={t("common.close")}
                className="absolute right-3 top-3 rounded-lg p-1.5 text-quon-muted transition hover:bg-quon-surface hover:text-quon-text"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-quon-indigo">
                <Sparkles className="h-3.5 w-3.5" />{" "}
                {t("nav.releaseWhatsNew", { date: release.date })}
              </div>
              <h2 className="mt-1.5 text-lg font-semibold text-quon-text">{release.title}</h2>
              {release.subtitle && (
                <p className="mt-1 text-xs leading-snug text-quon-muted">{release.subtitle}</p>
              )}
            </div>

            <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto px-6 py-5">
              {release.items.map((it, i) => (
                <motion.div
                  key={it.title}
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 + i * 0.06 }}
                  className="flex items-start gap-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-quon-indigo/15">
                    <it.icon className="h-5 w-5 text-quon-indigo" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-quon-text">{it.title}</div>
                    <div className="mt-0.5 text-xs leading-snug text-quon-muted">{it.desc}</div>
                  </div>
                </motion.div>
              ))}
            </div>

            <div className="border-t border-quon-border px-6 py-4">
              <button
                onClick={close}
                className="w-full rounded-xl bg-quon-indigo px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-quon-indigo-hover glow-indigo"
              >
                {t("common.gotIt")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
