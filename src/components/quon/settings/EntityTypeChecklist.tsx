import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { getEntities, type EntityTypeInfo } from "@/lib/quonApi";
import { entityStyle } from "@/lib/quonEntityStyles";
import { useT } from "@/lib/i18n/i18n";

/**
 * Reusable per-type on/off checklist over the server entity catalog (GET
 * /entities, single source of truth). CUSTOM (the on-device always-redact list)
 * is never shown - it isn't a detector toggle. `disabled` is the drop-list;
 * `onToggle(type, enabled)` is called on each change. Used by the global
 * settings card and the per-project override editor.
 */
export function EntityTypeChecklist({
  disabled,
  onToggle,
}: {
  disabled: string[];
  onToggle: (type: string, enabled: boolean) => void;
}) {
  const { t } = useT();
  const [catalog, setCatalog] = useState<EntityTypeInfo[] | null>(null);

  useEffect(() => {
    getEntities()
      .then((c) => setCatalog(c.filter((e) => e.type !== "CUSTOM")))
      .catch(() => setCatalog([]));
  }, []);

  if (catalog === null) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-quon-muted">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("settings.typesLoading")}
      </div>
    );
  }

  const off = new Set(disabled);
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {catalog.map((e) => {
        const enabled = !off.has(e.type);
        const style = entityStyle(e.type);
        return (
          <label
            key={e.type}
            className="flex items-center gap-2 rounded-lg border border-quon-border bg-quon-surface-2 px-2.5 py-1.5"
            title={e.description}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(ev) => onToggle(e.type, ev.target.checked)}
            />
            <span className={`h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs text-quon-text">{style.label}</span>
            <span className="text-[10px] text-quon-muted">{e.placeholder}</span>
          </label>
        );
      })}
    </div>
  );
}
