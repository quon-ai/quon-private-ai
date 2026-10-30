/**
 * The 3-step protection-level slider (Basic → Filter → Review), shared by
 * Settings and the Dashboard's expandable "Change" panel so both render the
 * exact same control. Reads/writes quonStore — every surface that shows the
 * level stays in sync. ("Full Local" — on-device models — was dropped from
 * the UI 2026-07-06; it never shipped and only cluttered the slider.)
 */
import { motion } from "motion/react";

import { useT } from "@/lib/i18n/i18n";
import type { I18n } from "@/lib/i18n/i18n";
import type { MessageKey } from "@/lib/i18n/catalog";
import { quon, useQuonState, type ProtectionLevel } from "@/lib/quonStore";

export const PROTECTION_LEVELS = [
  {
    id: "none",
    short: "Basic",
    shortKey: "settings.protectionBasicShort" as MessageKey,
    desc: "No filtering, but requests still go through QUON — the provider never sees your account or name, unlike using ChatGPT or Gemini directly.",
    descKey: "settings.protectionBasicDesc" as MessageKey,
    score: 0,
    color: "#94a3b8",
    disabled: false,
  },
  {
    id: "local",
    short: "Filter",
    shortKey: "settings.protectionFilterShort" as MessageKey,
    desc: "Remove personal data such as emails, names, IDs before anything is sent",
    descKey: "settings.protectionFilterDesc" as MessageKey,
    score: 50,
    color: "#f59e0b",
    disabled: false,
  },
  {
    id: "review",
    short: "Review",
    shortKey: "settings.protectionReviewShort" as MessageKey,
    desc: "Make sure that no personal data is in your prompt, by reviewing and manually redacting your data",
    descKey: "settings.protectionReviewDesc" as MessageKey,
    score: 100,
    color: "#818cf8",
    disabled: false,
  },
] as const;

/** Meta (label/color/desc) for a level id — for pills and status lines.
 *  `t` is optional so existing English-only callers keep compiling untouched;
 *  pass `t` from useT() to get the localized short/desc instead of the raw
 *  English fallback baked into PROTECTION_LEVELS. */
export function protectionLevelMeta(level: ProtectionLevel, t?: I18n["t"]) {
  const meta =
    PROTECTION_LEVELS[
      Math.max(
        0,
        PROTECTION_LEVELS.findIndex((l) => l.id === level),
      )
    ];
  if (!t) return meta;
  return { ...meta, short: t(meta.shortKey), desc: t(meta.descKey) };
}

export function ProtectionSlider() {
  const { t } = useT();
  const { protectionLevel } = useQuonState();
  const levelIdx = Math.max(
    0,
    PROTECTION_LEVELS.findIndex((l) => l.id === protectionLevel),
  );
  const level = PROTECTION_LEVELS[levelIdx];

  return (
    <div>
      <div className="relative h-1.5 rounded-full bg-quon-surface-2">
        <motion.div
          className="absolute left-0 top-0 h-full rounded-full"
          animate={{ width: levelIdx === 0 ? "0%" : `${level.score}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 24 }}
          style={{
            background: "linear-gradient(90deg, #f59e0b 0%, #818cf8 100%)",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-between">
          {PROTECTION_LEVELS.map((l, i) => {
            const active = i === levelIdx;
            const reached = i <= levelIdx && levelIdx > 0;
            return (
              <button
                key={l.id}
                onClick={() => !l.disabled && quon.setProtectionLevel(l.id as ProtectionLevel)}
                disabled={l.disabled}
                aria-label={t(l.shortKey)}
                className={`relative -my-2 flex h-9 w-9 items-center justify-center ${l.disabled ? "cursor-not-allowed" : ""}`}
              >
                <motion.span
                  animate={{ scale: active ? 1.15 : 1 }}
                  className="block rounded-full border-2 transition-colors"
                  style={{
                    width: active ? 14 : 10,
                    height: active ? 14 : 10,
                    background: reached ? l.color : "var(--quon-surface)",
                    borderColor: reached || active ? l.color : "var(--quon-border)",
                    boxShadow: active ? `0 0 10px ${l.color}` : "none",
                    opacity: l.disabled ? 0.4 : 1,
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex justify-between text-[9px] uppercase tracking-wide text-quon-muted md:text-[10px]">
        {PROTECTION_LEVELS.map((l, i) => (
          <span
            key={l.id}
            className={`${i === levelIdx ? "font-semibold text-quon-text" : ""} ${l.disabled ? "opacity-40" : ""}`}
          >
            {t(l.shortKey)}
          </span>
        ))}
      </div>
      <div className="mt-2 text-[10px] leading-snug text-quon-muted md:text-xs">
        {t(level.descKey)}
      </div>
    </div>
  );
}
