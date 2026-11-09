import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useQuonHealth } from "@/hooks/useQuonHealth";
import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";
import type { QuonStatus } from "@/lib/quonApi";

const PRESENTATION: Record<
  QuonStatus,
  {
    dot: string;
    text: string;
    labelKey: "nav.statusActive" | "nav.statusFallback" | "nav.statusOffline" | "nav.statusLoading";
    detailKey:
      | "nav.statusActiveDetail"
      | "nav.statusFallbackDetail"
      | "nav.statusOfflineDetail"
      | "nav.statusLoadingDetail";
    Icon: typeof ShieldCheck;
  }
> = {
  active: {
    dot: "bg-quon-green glow-green",
    text: "text-quon-green",
    labelKey: "nav.statusActive",
    detailKey: "nav.statusActiveDetail",
    Icon: ShieldCheck,
  },
  fallback: {
    dot: "bg-quon-yellow",
    text: "text-quon-yellow",
    labelKey: "nav.statusFallback",
    detailKey: "nav.statusFallbackDetail",
    Icon: ShieldAlert,
  },
  offline: {
    dot: "bg-red-500",
    text: "text-red-400",
    labelKey: "nav.statusOffline",
    detailKey: "nav.statusOfflineDetail",
    Icon: ShieldX,
  },
  loading: {
    dot: "bg-quon-muted animate-pulse",
    text: "text-quon-muted",
    labelKey: "nav.statusLoading",
    detailKey: "nav.statusLoadingDetail",
    Icon: ShieldCheck,
  },
};

export function StatusIndicator({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const { status, health } = useQuonHealth();
  // Show the badge only when there is something to act on - the scrubber is
  // unreachable ("offline") or degraded ("fallback"). The healthy "QUON aktiv"
  // (and the brief "loading") states are visual noise, so they render nothing.
  if (status === "active" || status === "loading") return null;
  const p = PRESENTATION[status];
  const label = t(p.labelKey);
  const detail = t(p.detailKey);

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium",
              status === "offline"
                ? "border-red-500/30 bg-red-500/10"
                : status === "fallback"
                  ? "border-quon-yellow/30 bg-quon-yellow/10"
                  : "border-quon-border bg-quon-surface",
              p.text,
            )}
            role="status"
            aria-label={label}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", p.dot)} />
            {compact ? <p.Icon className="h-3 w-3" /> : label}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="max-w-[240px] border border-quon-border bg-quon-surface text-xs text-quon-text"
        >
          <div className="mb-1 font-semibold text-quon-text">{label}</div>
          <p className="text-quon-muted">{detail}</p>
          {health && (
            <p className="mt-1.5 text-[10px] text-quon-muted">
              {t("nav.statusVersion", { version: health.version })}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
