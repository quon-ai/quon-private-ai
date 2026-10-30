/**
 * Settings card wrapping the shared protection-level slider.
 * Reads from and writes to the same quonStore as the Dashboard's compact
 * protection row, so every surface always shows the same value.
 */
import { motion } from "motion/react";
import { Shield } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { useQuonState } from "@/lib/quonStore";
import { ProtectionSlider, protectionLevelMeta } from "../ProtectionSlider";

export function ProtectionLevelCard() {
  const { t } = useT();
  const { protectionLevel } = useQuonState();
  const level = protectionLevelMeta(protectionLevel, t);

  return (
    <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-quon-text">
            {t("settings.protectionLevelTitle")}
          </div>
          <div className="text-[10px] text-quon-muted">{t("settings.protectionLevelDesc")}</div>
        </div>
        <motion.div
          key={level.id}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <Shield
            className="h-4 w-4"
            style={{ color: level.color, filter: `drop-shadow(0 0 6px ${level.color}80)` }}
          />
        </motion.div>
      </div>

      <div className="mt-3">
        <ProtectionSlider />
      </div>
    </section>
  );
}
