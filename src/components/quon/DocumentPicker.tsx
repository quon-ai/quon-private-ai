import { Check, FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDocuments, type DocItem } from "@/lib/documentStore";
import { useT } from "@/lib/i18n/i18n";

/** Pick already-indexed documents to attach in chat. Scoped to `projectId` when set
 *  (a project chat only sees its own documents), otherwise the global pool.
 *
 *  Several documents can be picked at once ("compare these three offers"); they are
 *  handed over as one list and combined under the shared attachment budget by the
 *  caller, so the scrub-before-send path stays identical to a single file. */
export function DocumentPicker({
  open,
  onClose,
  onPick,
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (docs: DocItem[]) => void;
  projectId?: string;
}) {
  const { t } = useT();
  const docs = useDocuments().filter(
    (d) => d.status === "ready" && (projectId ? d.projectId === projectId : true),
  );
  const [selected, setSelected] = useState<string[]>([]);

  // A reopened picker starts empty — the last message's choice must not carry over.
  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  function confirm() {
    const picked = selected
      .map((id) => docs.find((d) => d.id === id))
      .filter((d): d is DocItem => !!d);
    if (!picked.length) return;
    onPick(picked);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("docs.attachTitle")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[55vh] space-y-1.5 overflow-y-auto">
          {docs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-quon-border px-4 py-8 text-center text-xs text-quon-muted">
              {t("docs.attachEmpty")}
            </div>
          ) : (
            docs.map((d) => {
              const on = selected.includes(d.id);
              return (
                <button
                  key={d.id}
                  onClick={() => toggle(d.id)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left transition ${
                    on
                      ? "border-quon-indigo bg-quon-indigo/5"
                      : "border-quon-border bg-quon-surface hover:border-quon-indigo/50"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-quon-indigo bg-quon-indigo text-white" : "border-quon-border"
                    }`}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <FileText className="h-4 w-4 shrink-0 text-quon-indigo" />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-quon-text">
                    {d.filename}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {docs.length > 0 && (
          <button
            onClick={confirm}
            disabled={selected.length === 0}
            className="w-full rounded-lg bg-quon-indigo px-4 py-2 text-xs font-medium text-white transition disabled:opacity-40"
          >
            {selected.length > 1
              ? t("docs.attachSelectedMany", { count: selected.length })
              : t("docs.attachSelected")}
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
