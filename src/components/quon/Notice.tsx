import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { cn } from "@/lib/utils";

export type NoticeVariant = "info" | "success" | "warning" | "error";

const VARIANT_STYLES: Record<
  NoticeVariant,
  { container: string; icon: string; iconComponent: typeof Info }
> = {
  info: {
    container: "border-quon-border bg-quon-surface text-quon-text",
    icon: "text-quon-indigo",
    iconComponent: Info,
  },
  success: {
    container: "border-quon-green/30 bg-quon-green/10 text-quon-green",
    icon: "text-quon-green",
    iconComponent: CheckCircle2,
  },
  warning: {
    container: "border-quon-yellow/30 bg-quon-yellow/10 text-quon-yellow",
    icon: "text-quon-yellow",
    iconComponent: AlertTriangle,
  },
  error: {
    container: "border-red-500/30 bg-red-500/10 text-red-400",
    icon: "text-red-400",
    iconComponent: AlertTriangle,
  },
};

/**
 * Shared banner/notice shell - one consistent padding/radius/typography treatment
 * for the ad-hoc status bars scattered across the app (quota warnings, sync
 * errors, fallback-mode hints, budget hints...). Variant sets color + default icon;
 * pass `icon` to override (e.g. a privacy-specific glyph). Compact by default to
 * match the existing banners' density - this is a status line, not a card.
 */
export function Notice({
  variant = "info",
  icon,
  children,
  onDismiss,
  action,
  className,
}: {
  variant?: NoticeVariant;
  /** Override the variant's default icon (e.g. keep a specific privacy glyph).
   *  Pass `null` to omit the icon entirely. */
  icon?: ReactNode | null;
  children: ReactNode;
  onDismiss?: () => void;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  const { t } = useT();
  const style = VARIANT_STYLES[variant];
  const Icon = style.iconComponent;

  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[10px]",
        style.container,
        className,
      )}
    >
      {icon !== null && (
        <span className={cn("mt-0.5 shrink-0", style.icon)}>
          {icon ?? <Icon className="h-3 w-3" />}
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className={cn("shrink-0 font-semibold underline-offset-2 hover:underline", style.icon)}
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("onboarding.notice.dismiss")}
          className={cn("shrink-0 opacity-70 transition hover:opacity-100", style.icon)}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
