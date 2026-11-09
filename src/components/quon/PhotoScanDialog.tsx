import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Cloud, Loader2, Lock, RotateCcw } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ingestDocument } from "@/lib/documents/ingest";
import { createDocumentId } from "@/lib/documentStore";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useT } from "@/lib/i18n/i18n";
import { isChunkLoadError } from "@/lib/appVersion";
import { Notice } from "./Notice";

type Phase = "model" | "recognize" | "review" | "error";

/**
 * Review step for photo scans: the photo is OCR'd fully on-device (see
 * lib/documents/ocr.ts) and the transcript is shown EDITABLE before anything
 * is saved - printed text reads reliably (our eval: CER <=2% on photographed
 * German/English documents), handwriting often doesn't, and the user is told
 * so instead of silently indexing garbage. Zero-knowledge: photo and text
 * never leave the device unencrypted.
 *
 * Two modes:
 * - default ("Save to Documents"): the normal ingest pipeline runs with the
 *   reviewed text; the photo is kept as the encrypted original for the viewer.
 * - `attachMode` (chat paperclip): confirm hands the reviewed text back to the
 *   caller as a message attachment instead - no document is created and the
 *   photo is discarded; the text then goes through the same scrub-before-send
 *   path as any attachment.
 *
 * Cloud escalation (hybrid, like the PII scrubber): when the on-device result
 * is poor (handwriting, hard photos) the user can EXPLICITLY send this one
 * photo via the QUON server to a cloud vision model (ZDR routing, never
 * stored). It never happens automatically - the on-device promise holds until
 * the user opts out per photo, and the header chip switches wording so the
 * dialog never claims a privacy level it no longer has.
 */
export function PhotoScanDialog({
  file,
  projectId,
  onClose,
  attachMode,
  queue,
  autoAccept,
  onAcceptAll,
}: {
  file: File | null;
  projectId?: string;
  onClose: () => void;
  attachMode?: { onAttach: (a: { filename: string; text: string }) => void };
  /** Position in a multi-photo selection; the dialog reopens per photo, so
   *  without this the user can't tell how many are still coming. */
  queue?: { index: number; total: number };
  /** Take every remaining photo without stopping for review. Set by the parent
   *  when the user pressed "take them all" - reviewing five screenshots one at
   *  a time is the cost this buys out of. */
  autoAccept?: boolean;
  /** Offered only inside a batch; the parent flips `autoAccept`. */
  onAcceptAll?: () => void;
}) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>("model");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [avgScore, setAvgScore] = useState(1);
  const [filename, setFilename] = useState("");
  const [saving, setSaving] = useState(false);
  // Bumping retries the whole OCR run (e.g. after an offline model download).
  const [attempt, setAttempt] = useState(0);
  // Which engine produced the current transcript - drives the honesty chip.
  const [tier, setTier] = useState<"device" | "cloud">("device");
  const [cloudState, setCloudState] = useState<"idle" | "confirm" | "busy">("idle");
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudModel, setCloudModel] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  /** Guards the auto-accept effect from firing twice for one photo. */
  const autoSaved = useRef(false);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!file) return;
    setPhase("model");
    setError(null);
    setText("");
    setAvgScore(1);
    setTier("device");
    setCloudState("idle");
    setCloudError(null);
    setCloudModel(null);
    setFilename(defaultFilename(file));
    autoSaved.current = false;
    let cancelled = false;
    void (async () => {
      try {
        const { ocrPhoto } = await import("@/lib/documents/ocr");
        const result = await ocrPhoto(file, (p) => {
          if (!cancelled) setPhase(p);
        });
        if (cancelled) return;
        setText(result.text);
        setAvgScore(result.avgScore);
        setPhase("review");
      } catch (err) {
        if (cancelled) return;
        // "Failed to fetch dynamically imported module" means this instance
        // outlived its build (the OCR chunk was replaced by a deploy) - not
        // that the scanner is broken. Say what actually helps; the update bar
        // with its reload button is showing by now (UpdateBanner listens for
        // exactly this).
        setError(
          isChunkLoadError(err)
            ? t("docs.scanStaleBuild")
            : err instanceof Error
              ? err.message
              : t("docs.scanGenericError"),
        );
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` intentionally excluded: it only feeds the rare non-Error catch fallback,
    // and re-running the whole OCR pass on a language switch would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, attempt]);

  async function save() {
    if (!file || !text.trim() || saving) return;
    setSaving(true);
    try {
      const finalName = filename.trim() || defaultFilename(file);
      if (attachMode) {
        attachMode.onAttach({ filename: finalName, text });
      } else {
        // Fire the normal pipeline with the reviewed transcript; the list shows
        // the processing state, so the dialog can close right away.
        void ingestDocument({
          id: createDocumentId(),
          file,
          filename: finalName,
          mime: file.type || "image/jpeg",
          projectId,
          textOverride: text,
        });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // In "take them all" mode a finished transcript is accepted straight away.
  // An OCR failure deliberately does not auto-skip: the error phase stays on
  // screen so a photo that could not be read is noticed rather than silently
  // dropped from the batch.
  useEffect(() => {
    if (!autoAccept || phase !== "review" || saving || autoSaved.current) return;
    if (!text.trim()) return;
    autoSaved.current = true;
    void save();
    // `save` is stable enough for this one-shot per photo; listing it would
    // re-run the effect on every keystroke in the review textarea.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAccept, phase, saving, text]);

  async function runCloud() {
    if (!file || cloudState === "busy") return;
    setCloudState("busy");
    setCloudError(null);
    try {
      const { ocrPhotoCloud } = await import("@/lib/documents/ocr");
      const result = await ocrPhotoCloud(file);
      setText(result.text);
      setCloudModel(result.model);
      setTier("cloud");
      setPhase("review");
      setCloudState("idle");
    } catch (err) {
      setCloudError(translateApiError(err, t));
      // Back to the consent step so a retry is one click (consent was given).
      setCloudState("confirm");
    }
  }

  const busy = phase === "model" || phase === "recognize";

  // Escalation affordance - only offered while the transcript is on-device
  // (after a cloud read there is nothing stronger to escalate to).
  const cloudBlock = tier === "device" && (
    <div className="flex flex-col gap-2 rounded-lg border border-quon-border bg-quon-surface-2 p-2.5">
      {cloudError && <Notice variant="error">{cloudError}</Notice>}
      {cloudState === "idle" && (
        <button
          onClick={() => setCloudState("confirm")}
          className="flex items-center gap-1.5 text-left text-[11px] font-semibold text-quon-text hover:text-quon-indigo"
        >
          <Cloud className="h-3.5 w-3.5 shrink-0 text-quon-indigo" />
          {t("docs.cloudEscalationPrompt")}
        </button>
      )}
      {cloudState === "confirm" && (
        <>
          <p className="text-[10px] leading-snug text-quon-muted">{t("docs.cloudConsentText")}</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void runCloud()}
              className="flex items-center gap-1.5 rounded-lg bg-quon-indigo px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-quon-indigo-hover"
            >
              <Cloud className="h-3 w-3" /> {t("docs.cloudSendButton")}
            </button>
            <button
              onClick={() => {
                setCloudState("idle");
                setCloudError(null);
              }}
              className="rounded-lg border border-quon-border px-2.5 py-1 text-[11px] text-quon-text hover:border-quon-indigo/50"
            >
              {t("docs.cloudKeepDeviceButton")}
            </button>
          </div>
        </>
      )}
      {cloudState === "busy" && (
        <div className="flex items-center gap-2 text-[11px] text-quon-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-quon-indigo" />
          {t("docs.cloudBusyText")}
        </div>
      )}
    </div>
  );

  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Camera className="h-4 w-4 shrink-0 text-quon-indigo" />
            {t("docs.scanDialogTitle")}
            {queue && queue.total > 1 && (
              <span className="shrink-0 rounded-full bg-quon-surface-2 px-2 py-0.5 text-[10px] font-medium normal-case text-quon-muted">
                {t("docs.scanQueuePosition", { index: queue.index, total: queue.total })}
              </span>
            )}
            {tier === "cloud" ? (
              <span className="ml-auto flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-[9px] font-medium normal-case text-quon-muted">
                <Cloud className="h-2.5 w-2.5" /> {t("docs.chipCloud")}
              </span>
            ) : (
              <span className="ml-auto flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-[9px] font-medium normal-case text-quon-muted">
                <Lock className="h-2.5 w-2.5" /> {t("docs.chipDevice")}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid max-h-[65vh] grid-cols-1 gap-3 overflow-y-auto sm:grid-cols-2">
          {previewUrl && (
            <div className="rounded-lg border border-quon-border bg-quon-surface-2 p-2">
              <img
                src={previewUrl}
                alt={t("docs.photoAlt")}
                className="mx-auto max-h-[28rem] w-auto max-w-full rounded"
              />
            </div>
          )}

          <div className="flex min-w-0 flex-col gap-2">
            {busy && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-quon-border bg-quon-surface-2 p-6 text-center">
                <Loader2 className="h-4 w-4 animate-spin text-quon-indigo" />
                <span className="text-[11px] text-quon-muted">
                  {phase === "model" ? t("docs.phaseModel") : t("docs.phaseRecognize")}
                </span>
              </div>
            )}

            {phase === "error" && (
              <div className="flex flex-1 flex-col justify-center gap-2">
                <Notice variant="error">{error}</Notice>
                <button
                  onClick={() => setAttempt((a) => a + 1)}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-quon-border px-3 py-1.5 text-xs font-semibold text-quon-text hover:border-quon-indigo/50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> {t("common.tryAgain")}
                </button>
                {cloudBlock}
              </div>
            )}

            {phase === "review" && (
              <>
                <label className="text-[10px] font-semibold uppercase tracking-wide text-quon-muted">
                  {t("docs.reviewLabel")}
                </label>
                <textarea
                  ref={textRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="min-h-[14rem] w-full flex-1 resize-y rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 font-mono text-xs leading-relaxed text-quon-text outline-none"
                />
                {tier === "device" && avgScore < 0.85 && (
                  <Notice variant="warning">{t("docs.lowConfidenceWarning")}</Notice>
                )}
                <p className="text-[10px] leading-snug text-quon-muted">
                  {tier === "cloud"
                    ? t("docs.cloudReadCaption", {
                        model: cloudModel ?? t("docs.cloudModelDefault"),
                      })
                    : t("docs.deviceReadCaption")}{" "}
                  {attachMode ? t("docs.attachModeCaption") : t("docs.keepOriginalCaption")}
                </p>
                {cloudBlock}
                <input
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder={t("docs.documentNamePlaceholder")}
                  className="w-full rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-1.5 text-xs text-quon-text outline-none placeholder:text-quon-muted"
                />
              </>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-quon-border px-3 py-1.5 text-xs text-quon-text hover:border-quon-indigo/50"
          >
            {t("common.cancel")}
          </button>
          {/* Only inside a batch, and only while photos remain: reviewing five
              screenshots one by one is exactly what this buys out of. Honest
              about the cost - the rest is taken UNREVIEWED. */}
          {onAcceptAll && queue && queue.total > 1 && queue.index < queue.total && !autoAccept && (
            <button
              onClick={() => {
                onAcceptAll();
                void save();
              }}
              disabled={phase !== "review" || !text.trim() || saving}
              title={t("docs.acceptAllHint")}
              className="rounded-lg border border-quon-border px-3 py-1.5 text-xs font-semibold text-quon-text hover:border-quon-indigo/50 disabled:opacity-50"
            >
              {t("docs.acceptAllRemaining", { count: queue.total - queue.index + 1 })}
            </button>
          )}
          <button
            onClick={() => void save()}
            disabled={phase !== "review" || !text.trim() || saving}
            className="flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />{" "}
            {attachMode ? t("docs.attachToMessageButton") : t("docs.saveToDocumentsButton")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function defaultFilename(file: File): string {
  // Camera captures arrive as generic "image.jpg" - date-stamp those; keep
  // meaningful gallery names as-is.
  const generic = /^(image|img|photo|capture)[-_ ]?\d*\.(jpe?g|png|webp|heic|heif)$/i;
  if (file.name && !generic.test(file.name)) return file.name;
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}.${String(d.getMinutes()).padStart(
    2,
    "0",
  )}`;
  const ext = file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg";
  return `Scan ${stamp}${ext}`;
}
