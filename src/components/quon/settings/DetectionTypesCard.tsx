import { Link } from "@tanstack/react-router";
import { ScanText } from "lucide-react";

import { useQuonHealth } from "@/hooks/useQuonHealth";

import { quon, useQuonState } from "@/lib/quonStore";
import { useT } from "@/lib/i18n/i18n";
import { EntityTypeChecklist } from "./EntityTypeChecklist";

const CARD = "rounded-xl border border-quon-border bg-quon-surface p-4";

/**
 * Choose which entity TYPES QUON redacts (Names, Amounts, Dates, Address ...).
 * Everything on by default; unchecking a type adds it to `disabledEntityTypes`
 * (sent as `disabled_types` with each /scrub, per-project overridable).
 */
export function DetectionTypesCard() {
  const { t } = useT();
  const { disabledEntityTypes } = useQuonState();
  const { status, health } = useQuonHealth();

  function toggle(type: string, enabled: boolean) {
    const next = new Set(disabledEntityTypes);
    if (enabled) next.delete(type);
    else next.add(type);
    quon.setDisabledEntityTypes([...next]);
  }

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo">
          <ScanText className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.typesTitle")}</div>
          <div className="text-[10px] text-quon-muted">{t("settings.typesDesc")}</div>
        </div>
      </div>
      <div className="mt-3">
        <EntityTypeChecklist disabled={disabledEntityTypes} onToggle={toggle} />
      </div>
      {disabledEntityTypes.length > 0 && (
        <p className="mt-2 text-[10px] text-quon-yellow">
          {t("settings.typesDisabledWarning", { count: disabledEntityTypes.length })}
        </p>
      )}
      {/* The status the header badge shows, stated where the setting is
          made - and a link to what the engines actually do. "Later in the chat
          is a bit late." */}
      <p
        className={`mt-3 border-t border-quon-border pt-3 text-[10px] ${
          status === "offline"
            ? "text-red-400"
            : status === "fallback"
              ? "text-quon-yellow"
              : "text-quon-muted"
        }`}
        data-testid="detection-status"
      >
        {status === "offline"
          ? t("settings.detectStatusOffline")
          : status === "fallback"
            ? t("settings.detectStatusDegraded")
            : t("settings.detectStatusOk", {
                gliner: health?.gliner_loaded
                  ? t("settings.detectStatusGlinerOn")
                  : t("settings.detectStatusGlinerOff"),
              })}{" "}
        <Link to="/trust" className="font-semibold text-quon-indigo hover:text-quon-indigo-hover">
          {t("settings.detectStatusLink")}
        </Link>
      </p>
    </section>
  );
}
