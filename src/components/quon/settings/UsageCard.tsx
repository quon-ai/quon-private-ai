/**
 * "Included AI budget" card - shows how much of the account's capped OpenRouter
 * sub-key budget is used (hosted deployments only). Renders nothing when the
 * account isn't provisioned (self-host / BYOK) or the fetch fails, so the
 * Providers tab is unchanged on those deployments.
 */
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { getUsage, type UsageStatus } from "@/lib/quonApi";

const WARN_AT = 0.8; // bar turns yellow
const CRITICAL_AT = 0.95; // bar turns red

const usd = (v: number) => `$${v.toFixed(2)}`;

export function UsageCard() {
  const { t } = useT();
  const [usage, setUsage] = useState<UsageStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUsage()
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        /* not signed in / unreachable -> keep the card hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!usage?.provisioned || usage.limit_usd == null || usage.limit_usd <= 0) return null;

  const used = usage.usage_usd ?? 0;
  const frac = Math.min(used / usage.limit_usd, 1);
  const barColor =
    frac >= CRITICAL_AT ? "bg-red-500" : frac >= WARN_AT ? "bg-quon-yellow" : "bg-quon-green";

  return (
    <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-quon-text">{t("settings.usageTitle")}</div>
            <div className="text-[10px] text-quon-muted">{t("settings.usageDesc")}</div>
          </div>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-quon-text">
          {t("settings.usageUsedOf", { used: usd(used), limit: usd(usage.limit_usd) })}
        </span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={Math.round(frac * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("settings.usageAriaLabel")}
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-quon-surface-2"
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(frac * 100, 1)}%` }}
        />
      </div>
      {usage.disabled && (
        <p className="mt-2 text-[10px] text-red-400">{t("settings.usageDisabledNotice")}</p>
      )}
    </section>
  );
}
