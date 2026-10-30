import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isImageFile } from "@/lib/documents/isImageFile";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  FileText,
  Link as LinkIcon,
  Loader2,
  Lock,
  Pencil,
  Pin,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { syncApi, type OriginalsUsage } from "@/lib/api/syncApi";
import { ingestDocument } from "@/lib/documents/ingest";
import { fetchUrl } from "@/lib/quonApi";
import {
  getOriginalSyncIssues,
  getOriginalSyncIssuesServer,
  rescanOriginals,
  subscribeOriginalSyncIssues,
} from "@/lib/documents/originalSync";
import {
  allDocChunks,
  createDocumentId,
  deleteDocument,
  renameDocument,
  setDocumentPinned,
  setDocumentProject,
  useDocuments,
  type DocItem,
} from "@/lib/documentStore";
import { DocumentViewer } from "./DocumentViewer";
import { PhotoScanDialog } from "./PhotoScanDialog";
import {
  embedText,
  isEmbedderReady,
  onEmbedderReady,
  warmEmbedder,
} from "@/lib/embedding/embedder";
import { Notice } from "./Notice";
import { ensureEmbeddingsCurrent } from "@/lib/reembed";
import { topK } from "@/lib/search/vector";
import { useT } from "@/lib/i18n/i18n";
import { ProjectPickerBadge } from "./ProjectPickerBadge";

interface QueryHit {
  docId: string;
  filename: string;
  index: number;
  text: string;
  score: number;
}

/** Bytes → megabytes for the storage line: whole MB from 10 MB up, one decimal
 *  below (so small usage doesn't read as "0 MB"). */
function formatMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? String(Math.round(mb)) : mb.toFixed(1);
}

/**
 * Document list. With `projectId` set it is scoped to that project (list, search
 * and newly-uploaded files); without it (the global /documents route) it shows
 * everything, with a per-item project badge. `embedded` drops the page chrome for
 * use inside the project detail screen.
 */
export function ScreenDocuments({
  onBack,
  projectId,
  embedded,
}: { onBack?: () => void; projectId?: string; embedded?: boolean } = {}) {
  const { t, plural } = useT();
  const docs = useDocuments();
  const scoped = (x: { projectId?: string }) => (projectId ? x.projectId === projectId : true);
  const [ready, setReady] = useState(isEmbedderReady());
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<QueryHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Per-document indexing progress (0–100), shown while status === "processing".
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [viewing, setViewing] = useState<DocItem | null>(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  // Originals that couldn't sync (server storage quota) — non-blocking banner:
  // the document itself is synced/searchable, only the layout-view bytes stay local.
  const syncIssues = useSyncExternalStore(
    subscribeOriginalSyncIssues,
    getOriginalSyncIssues,
    getOriginalSyncIssuesServer,
  );
  const [quotaBannerDismissed, setQuotaBannerDismissed] = useState(false);
  // Show only failed documents (toggled from the failed-count chip) so a single
  // failure isn't lost in a long list — the connector import result only reports
  // a COUNT, this is where "which one / why" lives.
  const [onlyFailed, setOnlyFailed] = useState(false);
  const failedDocs = docs.filter((d) => scoped(d) && d.status === "failed");
  const quotaDocs = docs.filter((d) => scoped(d) && syncIssues[d.id] === "quota");
  const tooBigDocs = docs.filter((d) => scoped(d) && syncIssues[d.id] === "toobig");
  // Larger than THIS device can push safely (deviceClass.ts) — the original is
  // cached here and syncs the next time the document is opened on a desktop.
  const deviceDocs = docs.filter((d) => scoped(d) && syncIssues[d.id] === "device");
  // Server-side originals storage (used / quota) — informational, best-effort.
  const [usage, setUsage] = useState<OriginalsUsage | null>(null);
  // Photos wait here for the OCR review dialog (one at a time — closing the
  // dialog advances to the next queued photo). `total` counts the whole batch
  // so the dialog can say "2 / 5"; it resets once the queue drains.
  const [photoQueue, setPhotoQueue] = useState<{ files: File[]; total: number }>({
    files: [],
    total: 0,
  });
  /** "Take all": the rest of the scan batch is saved without a review stop. */
  const [autoAcceptScans, setAutoAcceptScans] = useState(false);
  // Inline filename edit — only one row at a time.
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    warmEmbedder();
    void ensureEmbeddingsCurrent();
    // Opening the Documents screen is a natural moment to retry pending
    // original uploads (backfill / after a failure) and to refresh the
    // storage line. Both are best-effort.
    rescanOriginals();
    let cancelled = false;
    void syncApi
      .originalsUsage()
      .then((u) => {
        if (!cancelled) setUsage(u);
      })
      .catch(() => {
        /* offline / older backend — the line is simply not shown */
      });
    const off = onEmbedderReady(setReady);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Debounce search: embedding + the O(N) vector scan are too heavy to run on
  // every keystroke (jank with many documents). Clear results immediately when
  // the box is emptied; otherwise run ~250ms after typing stops.
  useEffect(() => () => clearTimeout(queryTimer.current ?? undefined), []);
  function onQueryChange(v: string) {
    setQuery(v);
    clearTimeout(queryTimer.current ?? undefined);
    if (!v.trim()) {
      setHits(null);
      return;
    }
    queryTimer.current = setTimeout(() => void runQuery(v), 250);
  }

  async function ingest(file: File) {
    // Manual upload → the shared pipeline (no provenance; connectors pass `source`).
    const id = createDocumentId();
    try {
      await ingestDocument({
        id,
        file,
        filename: file.name,
        mime: file.type || "application/octet-stream",
        projectId,
        onProgress: (done, total) =>
          setProgress((p) => ({ ...p, [id]: Math.round((done / total) * 100) })),
      });
    } finally {
      setProgress((p) => {
        if (!(id in p)) return p;
        const rest = { ...p };
        delete rest[id];
        return rest;
      });
    }
  }

  // Import a public web page as a document: the backend fetches + Readability-
  // extracts the text (server sees the URL + public content — see the honest
  // note in the UI), then it's ingested + encrypted locally like any document.
  async function importUrl() {
    const url = urlDraft.trim();
    if (!url || urlBusy) return;
    setUrlBusy(true);
    setUrlError(null);
    try {
      const page = await fetchUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`);
      const host = (() => {
        try {
          return new URL(page.url).hostname.replace(/^www\./, "");
        } catch {
          return "seite";
        }
      })();
      const base = (page.title.trim() || host).replace(/[/\\:*?"<>|]/g, "").slice(0, 80) || host;
      const filename = `${base}.md`;
      const id = createDocumentId();
      const res = await ingestDocument({
        id,
        file: new File([page.text], filename, { type: "text/markdown" }),
        filename,
        mime: "text/markdown",
        projectId,
        source: { connector: "url", ref: page.url },
      });
      if (res.status === "failed") throw new Error(res.error || "indexing failed");
      setUrlDraft("");
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : t("docs.urlError"));
    } finally {
      setUrlBusy(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files);
    // Photos take the OCR review path (extract.ts can't read images, and the
    // transcript must be user-checked before it is indexed).
    const photos = list.filter(isImageFile);
    if (photos.length) {
      setAutoAcceptScans(false); // a fresh pick always starts with review
      setPhotoQueue((q) => ({ files: [...q.files, ...photos], total: q.total + photos.length }));
    }
    for (const file of list) {
      if (!isImageFile(file)) await ingest(file);
    }
  }

  async function runQuery(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      setHits(null);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const qv = await embedText(trimmed);
      if (seq !== searchSeq.current) return;
      const ranked = topK(qv, allDocChunks().filter(scoped), (c) => c.embedding, 8)
        .filter((r) => r.score > 0.2)
        .map((r) => ({ ...r.item, score: r.score }));
      setHits(ranked);
    } catch {
      const lower = trimmed.toLowerCase();
      setHits(
        allDocChunks()
          .filter((c) => scoped(c) && c.text.toLowerCase().includes(lower))
          .slice(0, 8)
          .map((c) => ({ ...c, score: 0 })),
      );
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  return (
    <div
      data-testid="documents-scroll"
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-5 pb-16"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void handleFiles(e.dataTransfer.files);
      }}
    >
      {onBack && (
        <button
          onClick={onBack}
          aria-label={t("common.back")}
          className="rounded-lg p-1.5 text-quon-muted hover:text-quon-text"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".txt,.md,.csv,.json,.html,.pdf,.docx,text/*,application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {/* "Scan a photo" opens the camera directly on mobile (`capture`). An
          existing gallery/library image is still scannable via "Drop files or
          browse" above — it accepts image/* and routes into the same OCR review
          dialog. (On desktop `capture` is ignored → a normal file dialog.) */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {/* Same OCR pipeline, but capture-free: mobile opens the photo library
          instead of jumping straight into the camera. `multiple` matters: the
          library UI lets you tick several photos either way, and without it the
          browser hands us only the first one — the rest were silently dropped. */}
      <input
        ref={galleryInput}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {!embedded && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <FileText className="h-5 w-5 text-quon-indigo" />
            <h1 className="text-lg font-semibold text-quon-text">{t("docs.title")}</h1>
          </div>
          <p className="mt-1 text-xs text-quon-muted">{t("docs.subtitle")}</p>
        </>
      )}

      {/* #56: the ZK answer WHERE the doubt arises — one honest line above the
          dropzone, linking to the full data-flow story. A user with Depotauszüge
          in hand asked "liegen die jetzt ungeschwärzt auf deinem Server rum?";
          the answer existed but only in the architecture docs. */}
      <p className="mt-3 text-[11px] leading-snug text-quon-muted">
        {t("docs.zkHint")}{" "}
        <Link to="/trust" className="font-semibold text-quon-indigo hover:text-quon-indigo-hover">
          {t("docs.zkHintLink")}
        </Link>
      </p>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => fileInput.current?.click()}
          className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-quon-border bg-quon-surface/50 px-4 py-5 text-center transition hover:border-quon-indigo/50"
        >
          <Upload className="h-5 w-5 text-quon-muted" />
          <div className="text-xs font-semibold text-quon-text">{t("docs.uploadDropBrowse")}</div>
          <div className="flex items-center gap-1 text-[10px] text-quon-muted">
            <Lock className="h-3 w-3" /> {t("docs.uploadFormats")}
          </div>
          {!ready && (
            <div className="mt-1 flex items-center gap-1 text-[10px] text-quon-muted">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("docs.preparingModel")}
            </div>
          )}
        </button>
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-quon-border bg-quon-surface/50 px-4 py-4 text-center sm:w-44">
          <button
            onClick={() => photoInput.current?.click()}
            className="flex w-full flex-col items-center gap-1 rounded-lg py-1 transition hover:text-quon-indigo"
          >
            <Camera className="h-5 w-5 text-quon-muted" />
            <div className="text-xs font-semibold text-quon-text">{t("docs.scanAPhoto")}</div>
          </button>
          <button
            onClick={() => galleryInput.current?.click()}
            className="w-full rounded-lg border border-quon-border px-2 py-1 text-[11px] text-quon-text transition hover:border-quon-indigo/50"
          >
            {t("docs.scanFromGallery")}
          </button>
          <div className="flex items-center gap-1 text-[10px] text-quon-muted">
            <Lock className="h-3 w-3" /> {t("docs.scanPhotoHint")}
          </div>
        </div>
      </div>

      {/* Import a web page as a document (server-side Readability). Honestly
          labelled: the URL + public page content are seen by the server. */}
      <div className="mt-2">
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-quon-border bg-quon-surface px-2.5 py-1.5">
            <LinkIcon className="h-3.5 w-3.5 shrink-0 text-quon-muted" />
            <input
              type="url"
              inputMode="url"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void importUrl()}
              placeholder={t("docs.urlPlaceholder")}
              className="min-w-0 flex-1 bg-transparent text-xs text-quon-text outline-none placeholder:text-quon-muted"
            />
          </div>
          <button
            onClick={() => void importUrl()}
            disabled={urlBusy || !urlDraft.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
          >
            {urlBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("docs.urlImport")}
          </button>
        </div>
        <p className="mt-1 text-[10px] text-quon-muted">{t("docs.urlHint")}</p>
        {urlError && <p className="mt-1 text-[10px] text-destructive">{urlError}</p>}
      </div>

      {/* Server-side originals storage — informational only */}
      {usage && (
        <div className="mt-3 flex items-center gap-2 text-[10px] text-quon-muted">
          <div className="h-1 w-28 overflow-hidden rounded-full bg-quon-surface-2">
            <div
              className="h-full rounded-full bg-quon-indigo/70"
              style={{
                width: `${Math.min(100, Math.round((usage.used_bytes / Math.max(1, usage.quota_bytes)) * 100))}%`,
              }}
            />
          </div>
          <span>
            {t("docs.storageLine", {
              used: formatMb(usage.used_bytes),
              quota: formatMb(usage.quota_bytes),
            })}
          </span>
        </div>
      )}

      {/* Originals-sync quota notice (non-blocking; indexing/search unaffected) */}
      {quotaDocs.length > 0 && !quotaBannerDismissed && (
        <Notice variant="warning" className="mt-4" onDismiss={() => setQuotaBannerDismissed(true)}>
          <span className="font-semibold">
            {plural(quotaDocs.length, {
              one: "docs.quotaTitle.one",
              other: "docs.quotaTitle.other",
            })}
          </span>{" "}
          {plural(quotaDocs.length, { one: "docs.quotaBody.one", other: "docs.quotaBody.other" })}
          <div className="mt-1 truncate text-quon-muted/80">
            {quotaDocs.map((d) => d.filename).join(", ")}
          </div>
        </Notice>
      )}

      {/* Over-cap originals (never synced — layout view exists only here) */}
      {tooBigDocs.length > 0 && (
        <Notice variant="warning" className="mt-4">
          <span className="font-semibold">{t("docs.tooBigTitle")}</span> {t("docs.tooBigBody")}
          <div className="mt-1 truncate text-quon-muted/80">
            {tooBigDocs.map((d) => d.filename).join(", ")}
          </div>
        </Notice>
      )}

      {/* Originals this device is too small to push (iPhone-class memory) */}
      {deviceDocs.length > 0 && (
        <Notice variant="info" className="mt-4" data-testid="originals-device-notice">
          <span className="font-semibold">{t("docs.deviceLocalTitle")}</span>{" "}
          {t("docs.deviceLocalBody")}
          <div className="mt-1 truncate text-quon-muted/80">
            {deviceDocs.map((d) => d.filename).join(", ")}
          </div>
        </Notice>
      )}

      {/* Query */}
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-quon-muted" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("docs.searchPlaceholder")}
          className="w-full bg-transparent text-sm text-quon-text outline-none placeholder:text-quon-muted"
        />
        {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-quon-muted" />}
        {query && !searching && (
          <button
            onClick={() => {
              setQuery("");
              setHits(null);
            }}
            aria-label={t("docs.clearSearchAria")}
            className="text-quon-muted hover:text-quon-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Query results */}
      {hits !== null && (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-quon-muted">
            {plural(hits.length, { one: "docs.resultCount.one", other: "docs.resultCount.other" })}
          </div>
          {hits.map((h) => (
            <div
              key={`${h.docId}-${h.index}`}
              className="rounded-xl border border-quon-border bg-quon-surface p-3"
            >
              <div className="mb-1 flex items-center gap-1.5 text-[10px] text-quon-muted">
                <FileText className="h-3 w-3" /> {h.filename}
                {h.score > 0 && (
                  <span className="ml-auto">
                    {t("docs.matchPercent", { percent: (h.score * 100).toFixed(0) })}
                  </span>
                )}
              </div>
              <p className="text-xs text-quon-text">{h.text}</p>
            </div>
          ))}
          {hits.length === 0 && (
            <div className="text-xs text-quon-muted">{t("docs.noMatches")}</div>
          )}
        </div>
      )}

      {/* Document list */}
      <div className="mt-5 mb-2 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-quon-muted">
          {t("docs.yourDocuments")}
        </span>
        {failedDocs.length > 0 && (
          <button
            onClick={() => setOnlyFailed((v) => !v)}
            aria-pressed={onlyFailed}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              onlyFailed
                ? "border-destructive/50 bg-destructive/15 text-destructive"
                : "border-destructive/30 text-destructive hover:bg-destructive/10"
            }`}
          >
            <AlertTriangle className="h-3 w-3" />
            {t("docs.failedChip", { count: failedDocs.length })}
          </button>
        )}
      </div>
      <div data-testid="documents-list" className="space-y-2">
        {docs.filter(scoped).length === 0 && (
          <div className="rounded-xl border border-dashed border-quon-border px-4 py-8 text-center text-xs text-quon-muted">
            {t("docs.emptyState")}
          </div>
        )}
        {docs
          .filter(scoped)
          .filter((d) => !onlyFailed || d.status === "failed")
          .map((d) => {
            const ready_ = d.status === "ready";
            const failed = d.status === "failed";
            return (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-xl border border-quon-border bg-quon-surface p-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-quon-surface-2">
                  {failed ? (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  ) : (
                    <FileText className="h-4 w-4 text-quon-indigo" />
                  )}
                </div>
                {renaming?.id === d.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      renameDocument(d.id, renaming.value);
                      setRenaming(null);
                    }}
                  >
                    <input
                      autoFocus
                      value={renaming.value}
                      aria-label={t("docs.renameLabel")}
                      onChange={(e) => setRenaming({ id: d.id, value: e.target.value })}
                      onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                      className="min-w-0 flex-1 rounded-lg border border-quon-border bg-quon-surface-2 px-2 py-1 text-xs text-quon-text outline-none focus:border-quon-indigo"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-lg bg-quon-indigo px-2 py-1 text-[10px] font-medium text-white"
                    >
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenaming(null)}
                      className="shrink-0 rounded-lg px-2 py-1 text-[10px] text-quon-muted hover:text-quon-text"
                    >
                      {t("common.cancel")}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => ready_ && setViewing(d)}
                    disabled={!ready_}
                    title={ready_ ? t("docs.viewDocumentTitle") : undefined}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <div
                      className={`truncate text-xs font-semibold text-quon-text ${ready_ ? "hover:underline" : ""}`}
                    >
                      {d.filename}
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-quon-muted">
                      <span className="flex items-center gap-1">
                        {d.status === "processing" && (
                          <Loader2 className="h-3 w-3 animate-spin text-quon-yellow" />
                        )}
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            ready_ ? "bg-quon-green" : failed ? "bg-destructive" : "bg-quon-yellow"
                          }`}
                        />
                        <span
                          className={
                            ready_
                              ? "text-quon-green"
                              : failed
                                ? "text-destructive"
                                : "text-quon-yellow"
                          }
                        >
                          {ready_
                            ? t("docs.statusIndexed")
                            : failed
                              ? t("docs.statusFailed")
                              : progress[d.id] != null
                                ? t("docs.statusIndexingPct", { percent: progress[d.id] })
                                : t("docs.statusIndexing")}
                        </span>
                      </span>
                      {d.pinned && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-quon-indigo/40 bg-quon-indigo/10 px-1.5 py-0.5 text-[9px] text-quon-indigo">
                          <Pin className="h-2 w-2 fill-current" />
                          {t("docs.pinnedBadge")}
                        </span>
                      )}
                    </div>
                    {failed && d.error && (
                      <div className="mt-0.5 whitespace-normal break-words text-[10px] text-destructive">
                        {d.error}
                      </div>
                    )}
                  </button>
                )}
                {renaming?.id !== d.id && (
                  <button
                    onClick={() => setRenaming({ id: d.id, value: d.filename })}
                    title={t("docs.rename")}
                    aria-label={t("docs.rename")}
                    className="rounded p-1 text-quon-muted hover:text-quon-text"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                {ready_ && (
                  <button
                    onClick={() => setDocumentPinned(d.id, !d.pinned)}
                    aria-pressed={!!d.pinned}
                    title={d.pinned ? t("docs.unpin") : t("docs.pin")}
                    aria-label={d.pinned ? t("docs.unpin") : t("docs.pin")}
                    className={`rounded p-1 ${d.pinned ? "text-quon-indigo" : "text-quon-muted hover:text-quon-text"}`}
                  >
                    <Pin className={`h-3.5 w-3.5 ${d.pinned ? "fill-current" : ""}`} />
                  </button>
                )}
                <ProjectPickerBadge
                  value={d.projectId}
                  onChange={(pid) => setDocumentProject(d.id, pid)}
                />
                <button
                  onClick={() => deleteDocument(d.id)}
                  className="rounded p-1 text-quon-muted hover:text-destructive"
                  aria-label={t("docs.deleteDocumentAria")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
      </div>

      <DocumentViewer doc={viewing} onClose={() => setViewing(null)} />
      <PhotoScanDialog
        file={photoQueue.files[0] ?? null}
        projectId={projectId}
        queue={{
          index: photoQueue.total - photoQueue.files.length + 1,
          total: photoQueue.total,
        }}
        autoAccept={autoAcceptScans}
        onAcceptAll={() => setAutoAcceptScans(true)}
        onClose={() =>
          setPhotoQueue((q) => {
            const files = q.files.slice(1);
            if (!files.length) setAutoAcceptScans(false);
            return { files, total: files.length ? q.total : 0 };
          })
        }
      />
    </div>
  );
}
