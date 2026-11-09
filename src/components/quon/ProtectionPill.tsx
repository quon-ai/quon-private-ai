import { Link } from "@tanstack/react-router";
import { ArrowRight, Cloud, Cpu, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useQuonHealth } from "@/hooks/useQuonHealth";
import { useT } from "@/lib/i18n/i18n";
import { isProtected, useQuonState } from "@/lib/quonStore";
import { protectionLevelMeta } from "./ProtectionSlider";

/**
 * The "Geschützt" pill - clickable, and it tells the truth.
 *
 * A hardcoded green dot with a static label, disconnected from the live health
 * probe, is the wrong shape: a trust badge you cannot interrogate is
 * decoration, and decoration next to sensitive data breeds distrust. The pill
 *  - takes its color from the same status the health probe drives everywhere
 *    else (green active / yellow degraded / red unreachable),
 *  - opens a popover naming what is protecting you right now: protection
 *    level, detection engine (cloud/local) and its reachability, and how many
 *    items have been kept private so far,
 *  - links to /trust, where the full "what runs where" story lives.
 */
export function ProtectionPill() {
  const { t, plural } = useT();
  const { status, health } = useQuonHealth();
  const { protectionLevel, redactedTotal } = useQuonState();
  const level = protectionLevelMeta(protectionLevel, t);
  const protectedNow = isProtected(protectionLevel);

  const dot = !protectedNow
    ? "bg-quon-yellow"
    : status === "active"
      ? "bg-quon-green glow-green"
      : status === "fallback"
        ? "bg-quon-yellow"
        : status === "offline"
          ? "bg-red-500"
          : "bg-quon-muted animate-pulse";

  const label = !protectedNow
    ? t("trust.pillUnprotected")
    : status === "offline"
      ? t("nav.statusOffline")
      : t("nav.protected");

  // Detection is local, unconditionally - spaCy + GLiNER + the regex net run
  // in-process and there is no LLM tier. The copy is not conditional because
  // the condition does not exist; a flag that could say "cloud" here would be
  // a bug, not a mode.
  const engineReady = status === "active";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={t("trust.pillAria")}
          className="flex items-center gap-1.5 rounded-full border border-quon-border bg-quon-surface px-2 py-0.5 text-[10px] text-quon-muted transition hover:border-quon-indigo/50 hover:text-quon-text"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3 text-xs">
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            {status === "offline" ? (
              <ShieldX className="h-4 w-4 shrink-0 text-red-400" />
            ) : status === "fallback" || !protectedNow ? (
              <ShieldAlert className="h-4 w-4 shrink-0 text-quon-yellow" />
            ) : (
              <ShieldCheck className="h-4 w-4 shrink-0 text-quon-green" />
            )}
            <span className="font-semibold text-quon-text">
              {t("trust.pillLevel", { level: level.short })}
            </span>
          </div>

          <div className="flex items-start gap-2 text-quon-muted">
            <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-snug">
              {t("trust.pillEngineLocal")}{" "}
              <span className={engineReady ? "text-quon-green" : "text-quon-yellow"}>
                {status === "offline"
                  ? t("trust.pillEngineOffline")
                  : engineReady
                    ? t("trust.pillEngineReady")
                    : t("trust.pillEngineDegraded")}
              </span>
            </span>
          </div>

          {redactedTotal > 0 && (
            <p className="text-quon-muted">
              {plural(redactedTotal, {
                one: "nav.itemsKeptPrivateOne",
                other: "nav.itemsKeptPrivateOther",
              })}
            </p>
          )}

          <Link
            to="/trust"
            className="flex items-center gap-1 pt-0.5 font-semibold text-quon-indigo transition hover:text-quon-indigo-hover"
          >
            {t("trust.pillLink")} <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
