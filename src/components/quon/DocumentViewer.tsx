import { useEffect, useRef, useState } from "react";
import { Download, FileText, Loader2, ScanSearch } from "lucide-react";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  TextLayer as PdfTextLayer,
} from "pdfjs-dist";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { I18n } from "@/lib/i18n/i18n";
import { SCRUB_CONCURRENCY } from "@/lib/scrubChunked";
import {
  formatElapsed,
  interpolateScrubFraction,
  isStalled,
  shouldRevealProgress,
} from "@/lib/scrubProgressEta";
import { getDocumentText, type DocItem } from "@/lib/documentStore";
import { fetchOriginal } from "@/lib/documents/originalSync";
import { loadOriginal, originalKind } from "@/lib/documents/originalStore";
import {
  dismissHit,
  runDetectionPreview,
  segmentText,
  withNeverRedacted,
  highlightDomText,
  injectManualHit,
  type DetectionHit,
  type DetectState,
} from "@/lib/documents/detectionPreview";
import { addDocumentRedactTerm } from "@/lib/documentStore";
import { resolveDurableRedaction, type DurableRedactMatch } from "@/lib/manualRedact";
import { quon, useQuonState } from "@/lib/quonStore";
import { downloadBytes, downloadText } from "@/lib/download";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { Markdown } from "./Markdown";
import { AlwaysRedactButton, type RedactScope } from "./AlwaysRedactButton";

/**
 * Read-only viewer for an uploaded document, with two modes:
 *
 * - **Original** — the document rendered, not raw: PDF pages via pdf.js, DOCX
 *   via mammoth's HTML conversion, HTML sanitized through the same allowlist
 *   (docxHtml.ts), Markdown through the chat's Markdown renderer. PDF/DOCX/HTML
 *   need the original bytes: they come from this device's sealed IndexedDB
 *   cache when present; otherwise, when the DocItem's `original` manifest says
 *   a synced original exists, its encrypted chunks are fetched on demand
 *   (originalSync), decrypted locally and cached — so the doc is
 *   offline-viewable afterwards. Markdown renders straight from the extracted
 *   text (the text IS the source), so it works for every md doc — old uploads
 *   and connector imports included.
 * - **Text** — the on-device extracted text (the same content used for
 *   search/RAG). The only mode for plain-text formats, connector imports, and
 *   documents whose original is neither cached nor fetchable (fail-closed
 *   fallback — never a blank viewer). Extracted text is never fed to the HTML
 *   renderer — its tags are already stripped.
 */

/**
 * The detection-scan progress row.
 *
 * The raw (done,total) from scrubLarge ticks once per 8000-char piece. At the
 * measured ~2.0s per 1000 chars (SCRUB_LATENCY.md) that is ~16 SECONDS between
 * ticks, and a document under SCRUB_SPLIT_THRESHOLD never splits at all — so the
 * old bar sat at 0% for the whole scan and then jumped to 100%. On a 50k
 * document that is 84 seconds of a bar that looks hung.
 *
 * So it uses the same helpers as the send path (scrubProgressEta.ts): the bar
 * creeps between real ticks at the throughput observed so far, and the row shows
 * ELAPSED time — never a remaining-time estimate. That module documents three
 * separate attempts at a prediction, each of which wandered in both directions;
 * elapsed is monotonic and always true.
 */
function DetectProgress({
  detect,
  t,
}: {
  detect: { done: number; total: number; startedAt: number; updatedAt: number };
  t: I18n["t"];
}) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, []);

  // A bar that moves BACKWARD reads as a bug and destroys trust in the number,
  // so clamp to the high-water mark — same belt-and-braces as ScreenChat.
  const high = useRef(0);
  useEffect(() => {
    high.current = 0;
  }, [detect.startedAt]);

  const raw = interpolateScrubFraction(
    detect.startedAt,
    { done: detect.done, total: detect.total, updatedAt: detect.updatedAt },
    now,
    SCRUB_CONCURRENCY,
  );
  high.current = Math.max(high.current, raw);
  const pct = Math.round(high.current * 100);
  const elapsed = formatElapsed(now - detect.startedAt);
  const stalled = isStalled(detect.updatedAt, now);

  // A quick scan should not flash a progress bar on screen and vanish.
  if (!shouldRevealProgress(detect.startedAt, now)) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-quon-muted">
        {t("docs.detectRunning")}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-[11px] text-quon-muted">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-quon-surface-2">
        <div
          className="h-full rounded-full bg-quon-green transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="tabular-nums">{pct}%</span>
      <span className="tabular-nums">{elapsed}</span>
      {stalled && <span className="text-quon-amber">{t("docs.detectSlow")}</span>}
    </div>
  );
}

/**
 * A document that is NOT (yet) a library item — a staged chat attachment (#72):
 * a fresh upload, a Paperless pull, a combined multi-document attachment. The
 * viewer renders it exactly like a DocItem (bytes when the composer kept them,
 * the extracted text otherwise); the one difference is what a redaction made
 * here MEANS — per-send, handed to the parent via `onRedactForSend`, never
 * saved anywhere. `redactTerms` are the per-send terms already chosen, so
 * reopening the preview shows them painted.
 */
export interface AdhocDocument {
  filename: string;
  mime: string;
  text: string;
  bytes?: Uint8Array;
  redactTerms: string[];
}

export function DocumentViewer({
  doc,
  adhoc = null,
  onClose,
  onRedactForSend,
}: {
  doc: DocItem | null;
  /** Staged-attachment preview; ignored when `doc` is set. */
  adhoc?: AdhocDocument | null;
  onClose: () => void;
  /** Ad-hoc only: the parent owns the per-send term list. */
  onRedactForSend?: (value: string) => void;
}) {
  const { t } = useT();
  const { neverRedact: neverRedactList } = useQuonState();
  const source = doc ?? adhoc;
  const text = doc ? getDocumentText(doc).trim() : (adhoc?.text.trim() ?? "");
  const filename = source?.filename ?? "";
  const kind = source ? originalKind(source.mime, source.filename) : null;
  const docId = doc?.id;
  const manifest = doc?.original;
  // Which redaction the select-to-redact button promises: saved on the
  // document (library) or applied to this one message (ad-hoc).
  const redactScope: RedactScope = doc ? "document" : "send";
  // Markdown's rendered view is built from the extracted text — no bytes needed.
  const needsBytes = kind !== null && kind !== "md";

  // null while looking the original up / when none exists; `checked` separates
  // "still loading / fetching" from "definitively absent" (drives the fallback hint).
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [checked, setChecked] = useState(false);
  const [fetching, setFetching] = useState<{ done: number; total: number } | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [view, setView] = useState<"original" | "text">("original");
  // Bumped by the Retry button after a failed chunk fetch — re-runs the effect.
  const [fetchAttempt, setFetchAttempt] = useState(0);
  // Detection preview (feedback #55): run the user's ACTUAL filter over the
  // full text and paint every hit into the document — a list cannot prove
  // completeness, only the document itself can.
  const [detect, setDetect] = useState<DetectState>(null);

  useEffect(() => {
    setBytes(null);
    setChecked(!needsBytes); // nothing to look up for text-only formats and md
    setFetching(null);
    setFetchFailed(false);
    setView("original");
    setDetect(null);
    if (!docId && adhoc) {
      // Ad-hoc: the composer kept the bytes (or didn't — text view then).
      setBytes(adhoc.bytes ?? null);
      setChecked(true);
      return;
    }
    if (!docId || !needsBytes) return;
    let cancelled = false;
    void (async () => {
      const local = await loadOriginal(docId);
      if (cancelled) return;
      if (local || !manifest) {
        setBytes(local);
        setChecked(true);
        return;
      }
      // Not cached here, but synced — pull the chunks now (lazy fetch).
      setFetching({ done: 0, total: manifest.chunkCount });
      const fetched = await fetchOriginal(docId, manifest, (done, total) => {
        if (!cancelled) setFetching({ done, total });
      });
      if (cancelled) return;
      setFetching(null);
      if (fetched) setBytes(fetched);
      else setFetchFailed(true);
      setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [docId, adhoc, needsBytes, manifest, fetchAttempt]);

  // Whether an "Original" rendering exists at all (drives the toggle too):
  // md needs only the text; the byte-backed kinds need the bytes in hand.
  async function toggleDetection() {
    if (detect?.status === "done" || detect?.status === "failed") {
      setDetect(null); // off — views re-render from source, marks disappear
      return;
    }
    if (detect?.status === "running" || !text) return;
    const startedAt = performance.now();
    setDetect({ status: "running", done: 0, total: 1, startedAt, updatedAt: startedAt });
    try {
      const hits = await runDetectionPreview(text, (done, total) =>
        setDetect({ status: "running", done, total, startedAt, updatedAt: performance.now() }),
      );
      // Terms already saved on this document paint alongside fresh detection —
      // opening a document you redacted last week must SHOW those redactions.
      const saved: DetectionHit[] = (doc?.redactTerms ?? adhoc?.redactTerms ?? []).map((value) => ({
        value,
        type: "MANUAL",
      }));
      setDetect(
        saved.reduce<DetectState>((d, h) => injectManualHit(d, h), { status: "done", hits }),
      );
    } catch {
      // Same fail-closed honesty as sending: an unreachable filter shows an
      // error state, never a document silently rendered "clean".
      setDetect({ status: "failed" });
    }
  }
  const detectHits = detect?.status === "done" ? detect.hits : null;

  // Text view's "Immer schwärzen" (durable redaction): fold the newly
  // remembered term into whatever the detection preview is currently showing
  // (off/failed/running/already-on) so it paints everywhere immediately — the
  // pure fold is injectManualHit (detectionPreview.ts), unit-tested there.
  function handleAlwaysRedacted(hit: DetectionHit) {
    // Save ON the document: a durable term belongs to the DocItem (syncs with
    // it, applies to every future send involving it) — not to the global
    // Settings list, which stays purely user-managed.
    if (doc) addDocumentRedactTerm(doc.id, hit.value);
    // Ad-hoc (staged attachment): nothing to save ON — the composer carries the
    // term into THIS send's enforced list and the button's copy says exactly that.
    else onRedactForSend?.(hit.value);
    setDetect((d) => injectManualHit(d, hit));
  }

  // Text view's click-to-dismiss: a false positive costs one click to undo.
  // It goes to the device's GLOBAL never-redact list rather than onto the
  // document, because a false positive is a property of the VALUE, not of this
  // file — "Versicherungsnehmer" is not a person in the next letter either.
  // That list is editable in Settings -> Redaction lists, so a suppression is
  // always visible and reversible; an invisible allow-list would be a leak
  // with a nice UI.
  function handleNeverRedact(hit: DetectionHit) {
    quon.setNeverRedact(withNeverRedacted(neverRedactList, hit.value));
    // Fold it out of the current preview immediately — the values are already
    // in hand, so there is no re-scrub and nothing new leaves the device.
    setDetect((d) => dismissHit(d, hit.value));
  }

  const hasOriginal = kind === "md" ? text.length > 0 : bytes !== null && kind !== null;
  const showOriginal = view === "original" && hasOriginal;
  // Download to the device: the real original bytes when we have them, else the
  // extracted text (honestly named .txt when the original isn't a text format).
  const canDownload = !!source && (bytes !== null || text.length > 0);
  function download() {
    if (!source) return;
    if (bytes) {
      downloadBytes(source.filename, bytes, source.mime);
      return;
    }
    const base = source.filename.replace(/\.[^.]+$/, "");
    const name = kind === "md" ? source.filename : `${base}.txt`;
    downloadText(name, text);
  }

  return (
    <Dialog open={!!source} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex min-w-0 items-center gap-2 pr-6 text-sm">
            <FileText className="h-4 w-4 shrink-0 text-quon-indigo" />
            <span className="min-w-0 truncate">{filename}</span>
            {text.length > 0 && (
              <button
                onClick={() => void toggleDetection()}
                title={t("docs.detectToggle")}
                aria-label={t("docs.detectToggle")}
                aria-pressed={detect?.status === "done"}
                data-testid="detect-toggle"
                // A LABEL, not just the magnifier: feedback #71 found this
                // feature "more by accident", and an icon whose only
                // explanation is `title` shows nothing on a touch device —
                // the same trap the mic button fell into.
                className={`ml-auto flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold transition ${
                  detect?.status === "done"
                    ? "bg-quon-green/10 text-quon-green"
                    : "text-quon-muted hover:bg-quon-surface-2 hover:text-quon-text"
                }`}
              >
                {detect?.status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ScanSearch className="h-4 w-4" />
                )}
                <span>{t("docs.detectLabel")}</span>
              </button>
            )}
            {canDownload && (
              <button
                onClick={download}
                title={t("docs.download")}
                aria-label={t("docs.download")}
                className={`shrink-0 rounded-md p-1 text-quon-muted hover:text-quon-text ${text.length > 0 ? "" : "ml-auto"}`}
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            {hasOriginal && (
              <span
                className={`flex shrink-0 gap-0.5 rounded-lg bg-quon-surface-2 p-0.5 ${canDownload ? "" : "ml-auto"}`}
              >
                {(["original", "text"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition ${
                      view === v
                        ? "bg-quon-indigo text-white"
                        : "text-quon-muted hover:text-quon-text"
                    }`}
                  >
                    {v === "original" ? t("docs.viewOriginal") : t("docs.viewText")}
                  </button>
                ))}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Staged attachment (#72): say what a redaction here is worth BEFORE
            the user makes one — this message only, nothing remembered. */}
        {!doc && adhoc && (
          <p className="text-[11px] text-quon-muted" data-testid="attachment-preview-hint">
            {t("docs.previewForSendHint")}
          </p>
        )}
        {detect?.status === "running" && <DetectProgress detect={detect} t={t} />}
        {detect?.status === "done" && (
          <div className="space-y-0.5" data-testid="detect-result">
            <p className="text-[11px] text-quon-muted">
              {detect.hits.length > 0
                ? t("docs.detectDone", { count: detect.hits.length })
                : t("docs.detectNone")}
            </p>
            {/* The marks are interactive and nothing said so (#70, #71). Only
                worth showing once there is something to interact with. */}
            {detect.hits.length > 0 && (
              <p className="text-[10px] text-quon-muted/80">{t("docs.detectHowto")}</p>
            )}
          </div>
        )}
        {detect?.status === "failed" && (
          <p className="text-[11px] text-quon-yellow">{t("docs.detectFailed")}</p>
        )}

        {needsBytes && !checked && view !== "text" ? (
          <div className="flex max-h-[60vh] flex-col items-center justify-center gap-2 rounded-lg border border-quon-border bg-quon-surface-2 p-8">
            <Loader2 className="h-4 w-4 animate-spin text-quon-muted" />
            {fetching && (
              <span className="text-[10px] text-quon-muted">
                {t("docs.fetchingOriginalPct", {
                  percent: Math.round((fetching.done / Math.max(1, fetching.total)) * 100),
                })}
              </span>
            )}
            {/* Never a spinner without an exit: the extracted TEXT is already
                local, so waiting on the network must always be optional
                (feedback #59 — a user sat in front of this for minutes). */}
            {text.length > 0 && (
              <button
                onClick={() => setView("text")}
                className="mt-1 rounded-md border border-quon-border px-2 py-1 text-[10px] text-quon-muted transition hover:text-quon-text"
              >
                {t("docs.showTextInstead")}
              </button>
            )}
          </div>
        ) : view === "text" ? (
          <TextView
            text={text}
            hits={detectHits}
            onAlwaysRedacted={handleAlwaysRedacted}
            redactScope={redactScope}
            onNeverRedact={handleNeverRedact}
          />
        ) : showOriginal && kind === "pdf" && bytes !== null ? (
          <PdfOriginal
            bytes={bytes}
            hits={detectHits}
            text={text}
            onAlwaysRedacted={handleAlwaysRedacted}
            redactScope={redactScope}
            fallback={
              <TextView
                text={text}
                hits={detectHits}
                onAlwaysRedacted={handleAlwaysRedacted}
                redactScope={redactScope}
                onNeverRedact={handleNeverRedact}
              />
            }
          />
        ) : showOriginal && kind === "docx" && bytes !== null ? (
          <DocxOriginal
            bytes={bytes}
            hits={detectHits}
            fallback={
              <TextView
                text={text}
                hits={detectHits}
                onAlwaysRedacted={handleAlwaysRedacted}
                redactScope={redactScope}
                onNeverRedact={handleNeverRedact}
              />
            }
          />
        ) : showOriginal && kind === "html" && bytes !== null ? (
          <HtmlOriginal
            bytes={bytes}
            hits={detectHits}
            fallback={
              <TextView
                text={text}
                hits={detectHits}
                onAlwaysRedacted={handleAlwaysRedacted}
                redactScope={redactScope}
                onNeverRedact={handleNeverRedact}
              />
            }
          />
        ) : showOriginal && kind === "md" ? (
          <MarkdownOriginal text={text} hits={detectHits} />
        ) : showOriginal && kind === "image" && bytes !== null ? (
          <ImageOriginal bytes={bytes} mime={source?.mime ?? "image/jpeg"} alt={filename} />
        ) : (
          <>
            <TextView
              text={text}
              hits={detectHits}
              onAlwaysRedacted={handleAlwaysRedacted}
              redactScope={redactScope}
              onNeverRedact={handleNeverRedact}
            />
            {needsBytes && checked && bytes === null && (
              <p className="flex flex-wrap items-center gap-2 text-[10px] text-quon-muted">
                <span>
                  {fetchFailed ? t("docs.fetchFailedFallback") : t("docs.textOnlyFallback")}
                </span>
                {fetchFailed && (
                  <button
                    onClick={() => setFetchAttempt((n) => n + 1)}
                    className="rounded-md border border-quon-border px-2 py-0.5 font-semibold text-quon-text hover:border-quon-indigo/50"
                  >
                    {t("docs.retryFetchOriginal")}
                  </button>
                )}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The selection-driven redact affordance shared by TextView and PdfOriginal.
 *
 * The button appears with a selection inside `containerRef` and STAYS after a
 * successful redaction: its confirmation line ("saved on this document — N
 * places" / "redacted in this message — N places") lives inside the button,
 * and the old `hasSelection &&` render unmounted it the instant the selection
 * was cleared — so the named outcome AlwaysRedactButton promises never showed
 * in the viewer (found by #72's E2E; the Review panel keeps its button mounted
 * and never had the problem). A fresh selection remounts the button through
 * `key`, so a stale confirmation never outlives the next attempt.
 */
function useRedactAffordance(
  containerRef: { current: HTMLElement | null },
  enabled: boolean,
): { show: boolean; key: number; afterRedact: () => void } {
  const [hasSelection, setHasSelection] = useState(false);
  const [redacted, setRedacted] = useState(false);
  const [seq, setSeq] = useState(0);
  const had = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    function onSelectionChange() {
      const sel = window.getSelection();
      const next =
        !!sel &&
        !sel.isCollapsed &&
        !!sel.toString().trim() &&
        !!containerRef.current?.contains(sel.anchorNode);
      if (next && !had.current) setSeq((n) => n + 1);
      had.current = next;
      setHasSelection(next);
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [enabled, containerRef]);

  function afterRedact() {
    window.getSelection()?.removeAllRanges();
    had.current = false;
    setHasSelection(false);
    setRedacted(true);
  }

  return { show: enabled && (hasSelection || redacted), key: seq, afterRedact };
}

/**
 * The extracted-text view — the one mode that works for every document type,
 * scans included (their text came from OCR, so it's the only place a scan's
 * content can be selected at all). Selecting text here surfaces "Immer
 * schwärzen" (durable redaction, feedback pass after #55/#58): resolves the
 * same way the chat Review panel's attachment section does
 * (resolveDurableRedaction against the full extracted text), remembers the
 * term, and paints every occurrence via the SAME detection-preview mechanism
 * feedback #55 built — a list can't prove completeness, only the document can.
 */
function TextView({
  text,
  hits = null,
  onAlwaysRedacted,
  redactScope = "document",
  onNeverRedact,
}: {
  text: string;
  hits?: DetectionHit[] | null;
  /** Omit to render the view read-only (no selection affordance). */
  onAlwaysRedacted?: (hit: DetectionHit) => void;
  redactScope?: RedactScope;
  /** Omit to render highlights inert (no click-to-dismiss). */
  onNeverRedact?: (hit: DetectionHit) => void;
}) {
  const { t } = useT();
  const { neverRedact } = useQuonState();
  const containerRef = useRef<HTMLDivElement>(null);
  const affordance = useRedactAffordance(containerRef, !!onAlwaysRedacted);

  function handleAlwaysRedact(): DurableRedactMatch | null {
    const resolved = resolveDurableRedaction(window.getSelection()?.toString(), text, neverRedact);
    if ("error" in resolved) return resolved;
    // The PARENT saves — it owns the DocItem, and a durable term is a property
    // of the document (DocItem.redactTerms), not of this device's global list.
    onAlwaysRedacted?.({ value: resolved.value, type: "MANUAL" });
    affordance.afterRedact();
    return resolved;
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="min-w-0 max-h-[60vh] select-text overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-quon-border bg-quon-surface-2 p-3 text-xs leading-relaxed text-quon-text"
      >
        {text ? (
          hits && hits.length > 0 ? (
            segmentText(text, hits).map((seg, i) =>
              seg.type ? (
                // Stays a <mark>: it IS a highlight, the existing E2E
                // selectors and the print stylesheet target mark[data-quon-hit],
                // and swapping in a <button> broke detection-preview.spec.ts.
                // role/tabIndex/keydown give it the button semantics instead, so
                // it is reachable by keyboard as well as pointer.
                <mark
                  key={i}
                  data-quon-hit={seg.type}
                  title={onNeverRedact ? t("docs.dismissHit", { type: seg.type }) : seg.type}
                  aria-label={onNeverRedact ? t("docs.dismissHit", { type: seg.type }) : undefined}
                  role={onNeverRedact ? "button" : undefined}
                  tabIndex={onNeverRedact ? 0 : undefined}
                  className={cn(
                    "quon-detect-mark",
                    onNeverRedact &&
                      "cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-quon-accent",
                  )}
                  onClick={
                    onNeverRedact
                      ? () => onNeverRedact({ value: seg.text, type: seg.type! })
                      : undefined
                  }
                  onKeyDown={
                    onNeverRedact
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onNeverRedact({ value: seg.text, type: seg.type! });
                          }
                        }
                      : undefined
                  }
                >
                  {seg.text}
                </mark>
              ) : (
                <span key={i}>{seg.text}</span>
              ),
            )
          ) : (
            text
          )
        ) : (
          <span className="text-quon-muted">{t("docs.noReadableText")}</span>
        )}
      </div>
      {affordance.show && (
        <div className="mt-2">
          <AlwaysRedactButton
            key={affordance.key}
            onClick={handleAlwaysRedact}
            scope={redactScope}
          />
        </div>
      )}
    </div>
  );
}

/** The scanned photo itself (OCR documents) — decrypted bytes → object URL. */
function ImageOriginal({ bytes, mime, alt }: { bytes: Uint8Array; mime: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [bytes, mime]);
  if (!url) return null;
  return (
    <div className="min-w-0 max-h-[60vh] overflow-y-auto rounded-lg border border-quon-border bg-quon-surface-2 p-2">
      <img src={url} alt={alt} className="mx-auto h-auto max-w-full rounded" />
    </div>
  );
}

/** Real PDF pages, rendered lazily: the document loads once, but each page only
 *  rasterizes when scrolled near the viewport (IntersectionObserver), so a
 *  100-page file doesn't allocate 100 canvases' worth of pixels up front.
 *
 *  Each rasterized page also gets a real, selectable pdf.js text layer
 *  (`PdfPage`), so "Immer schwärzen" (durable redaction) works here exactly
 *  like it does in the Text view: same `resolveDurableRedaction` gate, same
 *  shared `AlwaysRedactButton`, same parent-owned save
 *  (`onAlwaysRedacted` → `handleAlwaysRedacted` in DocumentViewer). One button
 *  for the whole scroll area, not one per page. */
function PdfOriginal({
  bytes,
  hits = null,
  text,
  onAlwaysRedacted,
  redactScope = "document",
  fallback,
}: {
  bytes: Uint8Array;
  hits?: DetectionHit[] | null;
  redactScope?: RedactScope;
  /** The full on-device EXTRACTED text — the same string the Text view
   *  resolves against. Selections are validated against this, not against the
   *  text layer's own string: the resolver checks what is actually sent, and
   *  the text layer's inter-item spacing can differ from extraction. */
  text: string;
  /** Omit to render read-only (no selection affordance) — same contract as TextView. */
  onAlwaysRedacted?: (hit: DetectionHit) => void;
  fallback: React.ReactNode;
}) {
  const { neverRedact } = useQuonState();
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | null = null;
    setPdf(null);
    setFailed(false);
    // Watchdog: pdf.js can HANG rather than reject when its worker never comes
    // up (e.g. a long-open tab whose hashed worker chunk was replaced by a
    // redeploy). A wedged render must degrade to the text fallback, not to an
    // eternal spinner (feedback #59).
    const watchdog = setTimeout(() => {
      if (!disposed) setFailed(true);
    }, 20_000);
    void (async () => {
      try {
        const { pdfjs } = await import("@/lib/documents/pdfjs");
        // pdf.js transfers the buffer to its worker (detaching it) — hand it a
        // copy so the cached bytes stay usable for the next open / view switch.
        task = pdfjs.getDocument({ data: bytes.slice() });
        const loaded = await task.promise;
        clearTimeout(watchdog);
        if (!disposed) setPdf(loaded);
      } catch {
        clearTimeout(watchdog);
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(watchdog);
      void task?.destroy().catch(() => {});
    };
  }, [bytes]);

  // Same selection affordance as TextView, scoped to the pages container: a
  // real pdf.js text layer sits on top of every rasterized page, so selecting
  // rendered PDF text is a real DOM selection like any other.
  const affordance = useRedactAffordance(containerRef, !!onAlwaysRedacted);

  function handleAlwaysRedact(): DurableRedactMatch | null {
    const resolved = resolveDurableRedaction(window.getSelection()?.toString(), text, neverRedact);
    if ("error" in resolved) return resolved;
    // The PARENT saves (DocumentViewer.handleAlwaysRedacted) — same contract
    // as TextView, so both surfaces write to the same DocItem.redactTerms.
    onAlwaysRedacted?.({ value: resolved.value, type: "MANUAL" });
    affordance.afterRedact();
    return resolved;
  }

  if (failed) return <>{fallback}</>;
  return (
    <div>
      <div
        ref={containerRef}
        className="min-w-0 max-h-[60vh] space-y-3 overflow-y-auto rounded-lg border border-quon-border bg-quon-surface-2 p-3"
      >
        {!pdf ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-4 w-4 animate-spin text-quon-muted" />
          </div>
        ) : (
          Array.from({ length: pdf.numPages }, (_, i) => (
            <PdfPage key={i + 1} pdf={pdf} pageNum={i + 1} hits={hits} />
          ))
        )}
      </div>
      {affordance.show && (
        <div className="mt-2">
          <AlwaysRedactButton
            key={affordance.key}
            onClick={handleAlwaysRedact}
            scope={redactScope}
          />
        </div>
      )}
    </div>
  );
}

/** One rendered PDF page, with optional detection-highlight overlay.
 *
 *  The overlay rects come from pdf.js's text layer (`getTextContent`): the
 *  page text is reassembled with a space between items and every character
 *  mapped back to its item, so a value SPLIT ACROSS ITEMS ("Anna" + "Müller")
 *  still matches; a partial-item hit is placed proportionally by character
 *  count — an approximation that is exactly good enough for "did the filter
 *  see this?" (feedback #55), and honest about not being text selection. */
function PdfPage({
  pdf,
  pageNum,
  hits = null,
}: {
  pdf: PDFDocumentProxy;
  pageNum: number;
  hits?: DetectionHit[] | null;
}) {
  const { t } = useT();
  const ref = useRef<HTMLCanvasElement>(null);
  const textLayerContainerRef = useRef<HTMLDivElement>(null);
  const textLayerRef = useRef<PdfTextLayer | null>(null);
  const pageRef = useRef<{ page: PDFPageProxy; viewport: PageViewport } | null>(null);
  const hitsRef = useRef<DetectionHit[] | null>(hits);
  hitsRef.current = hits;
  // null = detection is off / nothing computed yet, so nothing is claimed about
  // this page either way.
  const [marks, setMarks] = useState<PageMarks | null>(null);

  // (Re)compute overlay rects — after render, and whenever hits change.
  useEffect(() => {
    const current = pageRef.current;
    if (!current || !hits || hits.length === 0) {
      setMarks(null);
      return;
    }
    let disposed = false;
    void (async () => {
      const found = await computePdfHighlightRects(current.page, current.viewport, hits);
      if (!disposed) setMarks(found);
    })().catch(() => {});
    return () => {
      disposed = true;
    };
  }, [hits, pageNum]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let disposed = false;
    let started = false;

    const render = async () => {
      if (started) return;
      started = true;
      const page = await pdf.getPage(pageNum);
      if (disposed || !ref.current) return;
      // Fit the page to the dialog width; render the backing store at
      // devicePixelRatio for retina sharpness (capped — a 3x canvas of an A0
      // poster page would exhaust canvas memory on phones).
      const width = canvas.parentElement?.clientWidth || 560;
      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.aspectRatio = "";
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      await page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      }).promise;
      if (disposed) return;
      pageRef.current = { page, viewport };
      // Hits may already be active when a lazy page first scrolls into view.
      if (hitsRef.current?.length) {
        const found = await computePdfHighlightRects(page, viewport, hitsRef.current);
        if (!disposed) setMarks(found);
      }
      // Only ever mounted for a page that just rasterized — never for a page
      // still offscreen, which never reaches this line at all.
      void mountTextLayer(page, viewport);
    };

    // Real, selectable text on top of the rasterized page — the same
    // "Immer schwärzen" affordance the Text view has. Mounted per page (not
    // globally) so it only exists where a canvas actually exists.
    const mountTextLayer = async (page: PDFPageProxy, viewport: PageViewport) => {
      const container = textLayerContainerRef.current;
      if (disposed || !container) return;
      const { pdfjs } = await import("@/lib/documents/pdfjs");
      if (disposed || !textLayerContainerRef.current) return;
      container.style.setProperty("--scale-factor", String(viewport.scale));
      // The TextLayer constructor ITSELF calls pdf.js's setLayerDimensions
      // internally (text_layer.js), which sizes the box via a CSS round()
      // expression tied to custom properties (--total-scale-factor,
      // --scale-round-x/y) that only pdf_viewer.css defines — QUON doesn't
      // load it (see styles.css). Left alone that resolves to an INVALID
      // width, collapsing the container to 0px and stacking every span's
      // percentage-based `left` at the same spot — selection would still
      // "work" (the text is there) but every hit-test would land on the
      // wrong character. So: let the constructor do its thing, THEN pin the
      // box explicitly to match the canvas — setting it any earlier gets
      // clobbered by the constructor's own call.
      const layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      });
      container.style.width = `${viewport.width}px`;
      container.style.height = `${Math.floor(viewport.height)}px`;
      textLayerRef.current = layer;
      try {
        await layer.render();
      } catch {
        // Selection is a nice-to-have on top of an already-rendered page —
        // never take the rasterized canvas down with it (also hit on normal
        // cancellation via layer.cancel() below).
      }
    };

    // Placeholder canvases are A4-shaped (see JSX) so offscreen pages already
    // occupy realistic scroll height; render when scrolled within ~400px.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void render().catch(() => {});
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(canvas);
    return () => {
      disposed = true;
      io.disconnect();
      textLayerRef.current?.cancel();
      textLayerRef.current = null;
    };
  }, [pdf, pageNum]);

  return (
    <div className="relative">
      <canvas
        ref={ref}
        className="block w-full rounded bg-white shadow-sm"
        style={{ aspectRatio: "1 / 1.414" }}
        aria-label={t("docs.pdfPageAria", { page: pageNum })}
      />
      {/* Populated imperatively by mountTextLayer() once the page above has
          rasterized — see styles.css for the minimal text-layer CSS (QUON
          doesn't import pdf.js's own pdf_viewer.css). */}
      <div ref={textLayerContainerRef} className="quon-pdf-text-layer" />
      {marks?.rects.map((r, i) => (
        <div
          key={i}
          title={r.type}
          className={cn(
            "pointer-events-none absolute rounded-[2px]",
            // Same indigo-vs-yellow split as the text marks (styles.css): a
            // hand-redacted term reads differently from one the filter caught.
            r.type === "MANUAL"
              ? "quon-detect-mark-manual"
              : "bg-yellow-300/40 ring-1 ring-yellow-400/60",
          )}
          style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
        />
      ))}
      {/* Detection is on and this page cannot carry marks — say so rather than
          rendering a clean page, which reads as "nothing found here". */}
      {marks && !marks.markable && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-1.5">
          <span className="rounded-md bg-quon-yellow/15 px-2 py-1 text-[10px] font-medium text-quon-yellow ring-1 ring-quon-yellow/30">
            {t("docs.detectScannedPage")}
          </span>
        </div>
      )}
    </div>
  );
}

/** What a page can show. `markable: false` means the page carries no text layer
 *  (a scan), so marks cannot be placed on it at all — distinct from "no hits". */
interface PageMarks {
  rects: Array<{ left: number; top: number; width: number; height: number; type: string }>;
  markable: boolean;
}

/** DOCX with its formatting: mammoth converts the original bytes to HTML on
 *  device, which is allowlist-sanitized (docxHtml.ts) before injection. */
function DocxOriginal({
  bytes,
  hits = null,
  fallback,
}: {
  bytes: Uint8Array;
  hits?: DetectionHit[] | null;
  fallback: React.ReactNode;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setHtml(null);
    setFailed(false);
    void (async () => {
      try {
        const [{ default: mammoth }, { sanitizeDocxHtml }] = await Promise.all([
          import("mammoth"),
          import("@/lib/documents/docxHtml"),
        ]);
        const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer });
        const safe = sanitizeDocxHtml(value);
        if (disposed) return;
        if (safe.trim()) setHtml(safe);
        else setFailed(true);
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [bytes]);

  if (failed) return <>{fallback}</>;
  if (html === null) {
    return (
      <div className="flex max-h-[60vh] items-center justify-center rounded-lg border border-quon-border bg-quon-surface-2 p-8">
        <Loader2 className="h-4 w-4 animate-spin text-quon-muted" />
      </div>
    );
  }
  return <HighlightableHtml html={html} hits={hits} />;
}

/** Uploaded HTML with its formatting: the ORIGINAL bytes are decoded and pushed
 *  through the same allowlist sanitizer as the DOCX conversion (docxHtml.ts)
 *  before injection, into the same styled container. Never fed the extracted
 *  text — that has all markup stripped already. */
function HtmlOriginal({
  bytes,
  hits = null,
  fallback,
}: {
  bytes: Uint8Array;
  hits?: DetectionHit[] | null;
  fallback: React.ReactNode;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    setHtml(null);
    setFailed(false);
    void (async () => {
      try {
        const { sanitizeDocxHtml } = await import("@/lib/documents/docxHtml");
        const safe = sanitizeDocxHtml(new TextDecoder().decode(bytes));
        if (disposed) return;
        if (safe.trim()) setHtml(safe);
        else setFailed(true); // sanitized to nothing → text view, never blank
      } catch {
        if (!disposed) setFailed(true);
      }
    })();
    return () => {
      disposed = true;
    };
  }, [bytes]);

  if (failed) return <>{fallback}</>;
  if (html === null) {
    return (
      <div className="flex max-h-[60vh] items-center justify-center rounded-lg border border-quon-border bg-quon-surface-2 p-8">
        <Loader2 className="h-4 w-4 animate-spin text-quon-muted" />
      </div>
    );
  }
  return <HighlightableHtml html={html} hits={hits} />;
}

/** Sanitized HTML container that repaints detection marks AFTER every render.
 *  Highlighting must happen on TEXT NODES post-render (string-level replacement
 *  could match inside tags/attributes); `key={hits ? "on" : "off"}` forces a
 *  fresh render from the sanitized source when toggling, so turning the
 *  preview OFF genuinely removes every mark instead of trusting cleanup. */
function HighlightableHtml({ html, hits }: { html: string; hits: DetectionHit[] | null }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && hits && hits.length > 0) highlightDomText(ref.current, hits);
  }, [html, hits]);

  return (
    <div
      key={hits && hits.length > 0 ? "marks-on" : "marks-off"}
      ref={ref}
      className="quon-docx min-w-0 max-h-[60vh] overflow-auto break-words rounded-lg border border-quon-border bg-white p-5 text-[13px] leading-relaxed text-neutral-900"
      // Sanitized upstream: tag/attribute allowlist, data:-image-only srcs, no scripts.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Markdown rendered through the chat's Markdown component. Works from the
 *  extracted text alone (for md the text IS the source), so every md document
 *  gets this — old uploads and connector imports included. */
function MarkdownOriginal({ text, hits = null }: { text: string; hits?: DetectionHit[] | null }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && hits && hits.length > 0) highlightDomText(ref.current, hits);
  }, [text, hits]);
  return (
    <div
      key={hits && hits.length > 0 ? "marks-on" : "marks-off"}
      ref={ref}
      className="min-w-0 max-h-[60vh] overflow-auto rounded-lg border border-quon-border bg-quon-surface-2 p-3 text-xs leading-relaxed text-quon-text"
    >
      {text ? (
        <Markdown>{text}</Markdown>
      ) : (
        <span className="text-quon-muted">{t("docs.noReadableText")}</span>
      )}
    </div>
  );
}

/** Map detection hits to page-space rectangles via pdf.js's text content.
 *
 *  Reassembles the page text with a single space between items, keeping a
 *  char→(item, offset) map, then runs the same highlight regex the other views
 *  use. A hit spanning several items yields one rect per touched item; a hit
 *  inside an item is placed proportionally by character count. Approximate by
 *  design — the goal is "show me where the filter found something", not text
 *  selection. */
async function computePdfHighlightRects(
  page: PDFPageProxy,
  viewport: PageViewport,
  hits: DetectionHit[],
): Promise<PageMarks> {
  const { buildHighlightRegex, hasPlaceableText, typeOfMatch } =
    await import("@/lib/documents/detectionPreview");
  const { pdfjs } = await import("@/lib/documents/pdfjs");
  const re = buildHighlightRegex(hits);
  if (!re) return { rects: [], markable: true };

  type Item = { str: string; transform: number[]; width: number };
  const content = (await page.getTextContent()) as { items: Item[] };
  const items = content.items.filter((it) => typeof it.str === "string");

  // ⚠️ A page with no text layer is a SCAN: its text only exists because OCR
  // produced it, and OCR positions are discarded at extraction. So there is
  // nowhere to put a mark. Returning an empty rect list here used to be
  // indistinguishable from "the filter found nothing on this page" — so a
  // scanned document showed zero marks in Original view while Text view showed
  // them all, with no explanation. Report it instead.
  if (!hasPlaceableText(items)) {
    return { rects: [], markable: false };
  }

  // Page string + char→item map ("-1" = the synthetic joiner space).
  let pageText = "";
  const owner: Array<{ item: number; offset: number }> = [];
  items.forEach((it, idx) => {
    if (pageText.length > 0) {
      pageText += " ";
      owner.push({ item: -1, offset: 0 });
    }
    for (let c = 0; c < it.str.length; c++) owner.push({ item: idx, offset: c });
    pageText += it.str;
  });

  const rects: Array<{ left: number; top: number; width: number; height: number; type: string }> =
    [];
  for (const m of pageText.matchAll(re)) {
    const type = typeOfMatch(hits, m[0]);
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // Group the covered chars per item.
    const perItem = new Map<number, { from: number; to: number }>();
    for (let i = start; i < end; i++) {
      const o = owner[i];
      if (!o || o.item < 0) continue;
      const cur = perItem.get(o.item);
      if (!cur) perItem.set(o.item, { from: o.offset, to: o.offset + 1 });
      else cur.to = o.offset + 1;
    }
    for (const [itemIdx, span] of perItem) {
      const it = items[itemIdx];
      if (!it.str.length || !it.width) continue;
      const tx = pdfjs.Util.transform(viewport.transform, it.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const itemWidth = it.width * viewport.scale;
      const left = tx[4] + (span.from / it.str.length) * itemWidth;
      const width = ((span.to - span.from) / it.str.length) * itemWidth;
      rects.push({ left, top: tx[5] - fontHeight, width, height: fontHeight * 1.15, type });
    }
  }
  return { rects, markable: true };
}
