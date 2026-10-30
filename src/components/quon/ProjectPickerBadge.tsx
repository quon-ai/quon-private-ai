import { Folder } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/lib/i18n/i18n";
import { PROJECT_COLOR_HEX, useProjects, type ProjectColor } from "@/lib/projectStore";

const hex = (c?: ProjectColor) => PROJECT_COLOR_HEX[c ?? "indigo"];

/**
 * Compact badge showing which project an item belongs to ("Global" when none),
 * doubling as a picker to move it. Renders nothing when there are no projects and
 * the item is global — so the Memory/Documents screens look exactly as before
 * until the user actually creates a project.
 */
export function ProjectPickerBadge({
  value,
  onChange,
}: {
  value?: string;
  onChange: (projectId: string | undefined) => void;
}) {
  const { t } = useT();
  const projects = useProjects();
  if (projects.length === 0 && !value) return null;

  const current = value ? projects.find((p) => p.id === value) : undefined;
  // A projectId pointing at a not-yet-synced/deleted project: show a neutral label.
  const label = value
    ? (current?.name ?? t("projects.pickerUnknownProject"))
    : t("projects.pickerGlobal");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          title={t("projects.pickerMoveToProject")}
          aria-label={t("projects.pickerMoveToProject")}
          className="inline-flex items-center gap-1 rounded-full border border-quon-border bg-quon-surface-2 px-2 py-0.5 text-[10px] text-quon-muted transition hover:text-quon-text"
        >
          {value ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: hex(current?.color) }}
            />
          ) : (
            <Folder className="h-3 w-3 shrink-0" />
          )}
          <span className="max-w-[90px] truncate">{label}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem disabled={!value} onSelect={() => onChange(undefined)}>
          <Folder className="h-3.5 w-3.5" /> {t("projects.pickerGlobalOption")}
        </DropdownMenuItem>
        {projects.length > 0 && <DropdownMenuSeparator />}
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} disabled={p.id === value} onSelect={() => onChange(p.id)}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: hex(p.color) }} />
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
