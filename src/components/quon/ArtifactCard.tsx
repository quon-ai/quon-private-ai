/**
 * A saveable artifact detected in an assistant reply (a complete Markdown doc
 * or HTML page the model produced). Renders a compact preview + a one-click
 * "save into Documents" (zero-knowledge - same on-device encrypt/index pipeline
 * as any document). HTML is rendered STATICALLY through the shared allowlist
 * sanitizer (no scripts), matching the document viewer.
 */
import { useMemo, useState } from "react";
import { Check, FileCode2, FileText, Loader2, Save, X } from "lucide-react";

import type { Artifact } from "@/lib/artifacts/detect";
import { artifactFilename } from "@/lib/artifacts/detect";
import { sanitizeDocxHtml } from "@/lib/documents/docxHtml";
import { ingestDocument } from "@/lib/documents/ingest";
import { createDocumentId } from "@/lib/documentStore";
import { useT } from "@/lib/i18n/i18n";
import { Markdown } from "./Markdown";
import { ProjectPickerBadge } from "./ProjectPickerBadge";

/** Stable id from the message + artifact index, so re-saving the same artifact
 *  updates in place rather than piling up duplicates. */
function artifactDocId(messageId: number, index: number): string {
  return `artifact:${messageId}:${index}`;
}

export function ArtifactCard({
  artifact,
  messageId,
  index,
  defaultProjectId,
  onDismiss,
}: {
  artifact: Artifact;
  messageId: number;
  index: number;
  /** Project this chat belongs to - the save target defaults here. A "Global"
   *  default would move a document written inside a project out of that
   *  project unless the user noticed and changed the picker. The chat's scope
   *  is the only sane default; the picker still allows anything. */
  defaultProjectId?: string;
  /** Discard this card (the user doesn't want it in Documents). Remembered on
   *  the message, so it stays gone after a reload. */
  onDismiss?: () => void;
}) {
  const { t } = useT();
  const [target, setTarget] = useState<string | undefined>(defaultProjectId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const isHtml = artifact.type === "html";
  const safeHtml = useMemo(
    () => (isHtml ? sanitizeDocxHtml(artifact.content) : ""),
    [isHtml, artifact.content],
  );

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const filename = artifactFilename(artifact);
      const mime = isHtml ? "text/html" : "text/markdown";
      const res = await ingestDocument({
        id: createDocumentId(),
        file: new File([artifact.content], filename, { type: mime }),
        filename,
        mime,
        projectId: target,
        // Provenance so it's identifiable/removable; keepOriginal so the HTML
        // "Original" layout view has its bytes (sourced ingests normally skip).
        source: { connector: "artifact", ref: artifactDocId(messageId, index) },
        keepOriginal: isHtml,
      });
      if (res.status === "failed") throw new Error(res.error ?? "save failed");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-quon-border bg-quon-surface">
      <div className="flex items-center gap-2 border-b border-quon-border px-3 py-2">
        {isHtml ? (
          <FileCode2 className="h-4 w-4 shrink-0 text-quon-indigo" />
        ) : (
          <FileText className="h-4 w-4 shrink-0 text-quon-indigo" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-quon-text">{artifact.title}</div>
          <div className="text-[10px] uppercase tracking-wide text-quon-muted">
            {t("chat.artifact.badge", { type: isHtml ? "HTML" : "Markdown" })}
          </div>
        </div>
      </div>

      <div
        className={`overflow-y-auto px-3 py-2 text-xs text-quon-text ${
          expanded ? "max-h-[28rem]" : "max-h-40"
        }`}
      >
        {isHtml ? (
          <div dangerouslySetInnerHTML={{ __html: safeHtml }} />
        ) : (
          <Markdown>{artifact.content}</Markdown>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-quon-border px-3 py-2">
        {saved ? (
          <span className="flex items-center gap-1.5 text-[11px] text-quon-green">
            <Check className="h-3.5 w-3.5" /> {t("chat.artifact.saved")}
          </span>
        ) : (
          <>
            <button
              onClick={() => void save()}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {t("chat.artifact.save")}
            </button>
            <ProjectPickerBadge value={target} onChange={setTarget} />
            {/* Not everything the model produces belongs in Documents - let the
                card go away instead of sitting there forever (reported). */}
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="flex items-center gap-1.5 rounded-lg border border-quon-border px-2.5 py-1.5 text-xs text-quon-muted hover:border-destructive/40 hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
                {t("chat.artifact.dismiss")}
              </button>
            )}
          </>
        )}
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto text-[11px] text-quon-indigo hover:underline"
        >
          {expanded ? t("chat.artifact.collapse") : t("chat.artifact.expand")}
        </button>
      </div>
      {error && <div className="px-3 pb-2 text-[11px] text-red-400">{error}</div>}
    </div>
  );
}
