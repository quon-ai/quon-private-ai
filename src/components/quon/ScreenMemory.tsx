import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Brain,
  Check,
  ClipboardPaste,
  FileText,
  Info,
  Loader2,
  MessageSquare,
  Pencil,
  Pin,
  Download,
  Plus,
  Search,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  embedText,
  EMBED_DIM,
  EMBED_MODEL,
  isEmbedderReady,
  onEmbedderReady,
  warmEmbedder,
} from "@/lib/embedding/embedder";
import { createDocumentId, getDocument } from "@/lib/documentStore";
import { ingestDocument } from "@/lib/documents/ingest";
import { downloadText } from "@/lib/download";
import {
  FACT_MAX_CHARS,
  createMemoryId,
  deleteMemoryItem,
  getAllMemory,
  getMemoryItem,
  isActiveMemory,
  kindForText,
  setMemoryProject,
  upsertMemoryItem,
  useMemory,
  type MemoryItem,
  type MemoryKind,
} from "@/lib/memoryStore";
import { extractFromText } from "@/lib/memoryExtract";
import { applyMergeSuggestion } from "@/lib/memoryTidy";
import {
  deleteMemorySuggestion,
  useMemorySuggestions,
  type MemorySuggestion,
} from "@/lib/memorySuggestionStore";
import { CHAT_MODELS, getModels } from "@/lib/quonApi";
import { getChatSession, useQuonState } from "@/lib/quonStore";
import { ensureEmbeddingsCurrent } from "@/lib/reembed";
import { looksLikeMarkdown } from "@/lib/markdownHeuristic";
import { topK } from "@/lib/search/vector";
import { useT } from "@/lib/i18n/i18n";
import { LearnFromChatsButton, LearnFromDocumentsButton } from "./LearnFromChatsButton";
import { ArchivedMemoriesSection, MemoryHealthRow, PinCrowdingHint } from "./MemoryMaintenance";
import { Markdown } from "./Markdown";
import { ProjectPickerBadge } from "./ProjectPickerBadge";

/**
 * Memory list. With `projectId` set it is scoped to that project (list, search and
 * newly-added items); without it (the global /memory route) it shows everything,
 * with a per-item project badge. `embedded` drops the page chrome for use inside
 * the project detail screen.
 */
/** Memory item body. Plain notes keep their line breaks (whitespace-pre-wrap);
 *  texts with real Markdown syntax (pasted answers, Obsidian notes) render as
 *  Markdown instead of showing raw `**`/`-`/`#`. Long entries collapse behind a
 *  fade with a Show more toggle so one big note doesn't dominate the list. */
function MemoryText({ text }: { text: string }) {
  const { t } = useT();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 4;
  return (
    <div className="min-w-0 text-xs leading-relaxed text-quon-text">
      <div
        className={
          long && !expanded
            ? "max-h-20 overflow-hidden [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
            : undefined
        }
      >
        {looksLikeMarkdown(text) ? (
          <Markdown>{text}</Markdown>
        ) : (
          <p className="break-words whitespace-pre-wrap">{text}</p>
        )}
      </div>
      {long && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[10px] font-medium text-quon-indigo hover:underline"
        >
          {expanded ? t("memory.showLess") : t("memory.showMore")}
        </button>
      )}
    </div>
  );
}

/** Above this many characters a new memory is almost certainly pasted content
 *  (a report, an article, a mail thread) - saving opens the triage dialog
 *  (save as document / distill facts / note anyway) instead of saving directly.
 *  Long items also get the "large" badge + one-click move to Documents. */
const PASTE_TRIAGE_CHARS = 800;

/** Wrap memory text as a .txt File for the shared document-ingest pipeline. */
function textAsDocumentFile(text: string, label?: string): { file: File; filename: string } {
  const base =
    (label?.trim() || text.slice(0, 40).replace(/\s+/g, " ").trim() || "Memory").replace(
      /[/\\:*?"<>|]/g,
      "",
    ) || "Memory";
  const filename = `${base}.txt`;
  return { file: new File([text], filename, { type: "text/plain" }), filename };
}

/** Serialize memories to a single Markdown file (facts as "**key** - text",
 *  notes as-is), with tags. Built on-device from decrypted items; nothing
 *  leaves the browser. */
function memoriesToMarkdown(items: MemoryItem[]): string {
  const lines: string[] = ["# QUON — Erinnerungen", ""];
  for (const m of items) {
    if (m.kind === "fact" && m.key) lines.push(`## ${m.key}`);
    lines.push(m.text.trim());
    if (m.tags.length) lines.push(`\n*Tags: ${m.tags.join(", ")}*`);
    lines.push("", "---", "");
  }
  return lines.join("\n");
}

export function ScreenMemory({
  onBack,
  projectId,
  embedded,
}: { onBack?: () => void; projectId?: string; embedded?: boolean } = {}) {
  const { t, plural } = useT();
  const items = useMemory();
  const { activeModelId, alwaysRedact, neverRedact } = useQuonState();
  const scoped = (m: { projectId?: string }) => (projectId ? m.projectId === projectId : true);
  const [ready, setReady] = useState(isEmbedderReady());
  const [adding, setAdding] = useState(false);
  // Id of the item being edited; the add form doubles as the edit form.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftKind, setDraftKind] = useState<MemoryKind>("fact");
  const [draftTags, setDraftTags] = useState("");
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemoryItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSeq = useRef(0);
  const queryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Review queue (Auto-Memory): facts mined from chats by "Learn from chats",
  // scoped like the list itself. Nothing is saved to Memory until kept here.
  const suggestions = useMemorySuggestions().filter(scoped);
  // The sweep buttons sit at the top; the queue they fill is far below and can
  // be off-screen entirely on a phone. Scroll it into view rather than leaving
  // the user to guess where the result went.
  const reviewRef = useRef<HTMLDivElement | null>(null);
  const showReview = () =>
    reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  const [keepingId, setKeepingId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Large-paste triage: choose document / distilled facts / note for a big new text.
  const [triageOpen, setTriageOpen] = useState(false);
  const [triageBusy, setTriageBusy] = useState<"doc" | "extract" | "note" | null>(null);
  const [triageNotice, setTriageNotice] = useState<string | null>(null);
  // One-click "move to Documents" for existing large items.
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // Warm the on-device model when the screen opens; track readiness; re-embed any
  // items left over from a previous embedding model.
  useEffect(() => {
    warmEmbedder();
    void ensureEmbeddingsCurrent();
    return onEmbedderReady(setReady);
  }, []);

  // Debounce search: embedding + the O(N) vector scan are too heavy to run on
  // every keystroke. Clear immediately when emptied; else run ~250ms after typing.
  useEffect(() => () => clearTimeout(queryTimer.current ?? undefined), []);
  function onQueryChange(v: string) {
    setQuery(v);
    clearTimeout(queryTimer.current ?? undefined);
    if (!v.trim()) {
      setResults(null);
      return;
    }
    queryTimer.current = setTimeout(() => void runSearch(v), 250);
  }

  function closeForm() {
    setDraft("");
    setDraftKey("");
    setDraftTags("");
    setDraftKind("fact");
    setEditingId(null);
    setAdding(false);
    setTriageOpen(false);
    setTriageBusy(null);
    setTriageNotice(null);
  }

  function startEdit(m: MemoryItem) {
    setEditingId(m.id);
    setDraft(m.text);
    setDraftKey(m.key ?? "");
    setDraftKind(m.kind);
    setDraftTags(m.tags.join(", "));
    setAdding(true);
  }

  // Pin a short curated fact so it's always offered as chat context, bypassing
  // the relevance gate (see rag.ts). Text is untouched -> embedding/chunks stay
  // valid (spread preserves every field), so no re-embedding is triggered.
  function togglePin(m: MemoryItem) {
    upsertMemoryItem({ ...m, pinned: !m.pinned, updatedAt: Date.now() });
  }

  // Save the form - a new item, or an edit of an existing one (same id, so sync
  // LWW replaces it everywhere; the text is re-embedded since it changed).
  async function performSave() {
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    let embedding: number[] | undefined;
    try {
      embedding = await embedText(text);
    } catch {
      embedding = undefined; // stored anyway; just not semantically searchable
    }
    const now = Date.now();
    const tags = draftTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const original = editingId ? items.find((m) => m.id === editingId) : undefined;
    upsertMemoryItem({
      ...original, // keeps createdAt, projectId and any provenance fields on edit
      id: original?.id ?? createMemoryId(),
      // Long texts are always notes - see kindForText (the retrieval gate trusts
      // the short fact tier more than free-form pastes).
      kind: kindForText(text, draftKind),
      key: draftKey.trim() || undefined,
      text,
      tags,
      embedding,
      // Chunks from the pre-edit text would be stale (and ensureEmbeddingsCurrent
      // only rebuilds when they're missing) - drop them; the next mount or the
      // chat's retrieval self-heal re-chunks the new text. Same as keepSuggestion.
      chunks: undefined,
      dim: embedding ? EMBED_DIM : undefined,
      embModel: embedding ? EMBED_MODEL : undefined,
      projectId: original ? original.projectId : projectId,
      createdAt: original?.createdAt ?? now,
      updatedAt: now,
    });
    closeForm();
    setSaving(false);
  }

  async function handleSave() {
    const text = draft.trim();
    if (!text || saving) return;
    // A big pasted text is almost never a memory - offer the better homes first.
    // Edits of existing items skip the triage (the badge in the list covers them).
    if (!editingId && text.length > PASTE_TRIAGE_CHARS) {
      setTriageNotice(null);
      setTriageOpen(true);
      return;
    }
    await performSave();
  }

  /** Triage: index the pasted text as a document via the shared ingest pipeline. */
  async function triageSaveAsDocument() {
    if (triageBusy) return;
    setTriageBusy("doc");
    setTriageNotice(null);
    try {
      const text = draft.trim();
      const { file, filename } = textAsDocumentFile(text, draftKey);
      const doc = await ingestDocument({
        id: createDocumentId(),
        file,
        filename,
        mime: "text/plain",
        projectId,
      });
      if (doc.status === "failed") {
        setTriageNotice(t("memory.pasteTriage.docFailed"));
        return;
      }
      closeForm();
    } finally {
      setTriageBusy(null);
    }
  }

  /** Triage: distill short facts from the paste (scrub -> relay -> local re-hydrate,
   *  same ZK pipeline as "Learn from chats") into the review queue. */
  async function triageExtractFacts() {
    if (triageBusy) return;
    setTriageBusy("extract");
    setTriageNotice(null);
    try {
      // Same model resolution as the chat composer / LearnFromChatsButton.
      const models = await getModels().catch(() => CHAT_MODELS);
      const selected = models.find((m) => m.id === activeModelId);
      const added = await extractFromText(draft.trim(), {
        scope: projectId,
        model: selected?.model || activeModelId,
        connectionId: selected?.connection_id,
        alwaysRedact,
        neverRedact,
      });
      if (added === 0) {
        // Nothing new (all duplicates / nothing durable) - keep the dialog open
        // so the user can still pick document or note.
        setTriageNotice(t("memory.pasteTriage.nothingFound"));
        return;
      }
      closeForm(); // the review queue on this screen now shows the suggestions
    } catch {
      setTriageNotice(t("memory.pasteTriage.failed"));
    } finally {
      setTriageBusy(null);
    }
  }

  async function triageSaveAsNote() {
    if (triageBusy) return;
    setTriageBusy("note");
    try {
      setDraftKind("note");
      await performSave(); // kindForText forces "note" for long texts anyway
    } finally {
      setTriageBusy(null);
    }
  }

  /** One-click "move to Documents" for an existing large item: index the text as
   *  a document, then remove the memory item (only after a successful ingest). */
  async function convertToDocument(m: MemoryItem) {
    if (convertingId) return;
    setConvertingId(m.id);
    try {
      const { file, filename } = textAsDocumentFile(m.text, m.key);
      const doc = await ingestDocument({
        id: createDocumentId(),
        file,
        filename,
        mime: "text/plain",
        projectId: m.projectId,
      });
      if (doc.status !== "failed") deleteMemoryItem(m.id);
    } finally {
      setConvertingId(null);
    }
  }

  async function runSearch(q: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const qv = await embedText(trimmed);
      if (seq !== searchSeq.current) return; // a newer search superseded this one
      const ranked = topK(
        qv,
        getAllMemory(),
        (m) => (m.embModel === EMBED_MODEL ? m.embedding : undefined),
        20,
      )
        .filter((r) => r.score > 0.15)
        .map((r) => r.item);
      setResults(ranked);
    } catch {
      // Fallback to a lexical match if embedding fails.
      const lower = trimmed.toLowerCase();
      setResults(
        getAllMemory().filter(
          (m) =>
            m.text.toLowerCase().includes(lower) ||
            (m.key ?? "").toLowerCase().includes(lower) ||
            m.tags.some((t) => t.toLowerCase().includes(lower)),
        ),
      );
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }

  /** Accept a suggestion into Memory: create a new item, or update the one it
   *  refines (same id -> sync LWW replaces it everywhere). Embeds like handleSave;
   *  chunks are rebuilt by ensureEmbeddingsCurrent on the next mount. Returns the
   *  saved item so Edit can reopen it in the form. */
  async function keepSuggestion(s: MemorySuggestion): Promise<MemoryItem> {
    // Tidy-run merges have their own accept path: one merged item is created and
    // every source item is superseded (reversible from the archive drawer).
    if (s.mode === "merge") return applyMergeSuggestion(s);
    let embedding: number[] | undefined;
    try {
      embedding = await embedText(s.text);
    } catch {
      embedding = undefined; // stored anyway; just not semantically searchable yet
    }
    const now = Date.now();
    const target = s.mode === "update" && s.targetId ? getMemoryItem(s.targetId) : undefined;
    const item: MemoryItem = {
      ...target, // an update keeps the target's id/createdAt/projectId/kind
      id: target?.id ?? createMemoryId(),
      kind: target?.kind ?? s.kind,
      key: s.key ?? target?.key,
      text: s.text,
      tags: target ? [...new Set([...target.tags, ...s.tags])] : s.tags,
      embedding,
      chunks: undefined, // stale for the new text - rebuilt on the next mount
      dim: embedding ? EMBED_DIM : undefined,
      embModel: embedding ? EMBED_MODEL : undefined,
      projectId: target ? target.projectId : s.projectId,
      // Paste-distilled suggestions have neither source - they're "manual".
      source: s.sourceDocId ? "document" : s.sourceSessionId ? "chat" : "manual",
      sourceSessionId: s.sourceSessionId,
      sourceDocId: s.sourceDocId,
      createdAt: target?.createdAt ?? now,
      updatedAt: now,
    };
    upsertMemoryItem(item);
    deleteMemorySuggestion(s.id);
    return item;
  }

  async function keepOne(s: MemorySuggestion) {
    if (keepingId || bulkBusy) return;
    setKeepingId(s.id);
    try {
      await keepSuggestion(s);
    } finally {
      setKeepingId(null);
    }
  }

  // Edit = accept, then reopen in the edit form (the suggestion is consumed).
  async function editOne(s: MemorySuggestion) {
    if (keepingId || bulkBusy) return;
    setKeepingId(s.id);
    try {
      startEdit(await keepSuggestion(s));
    } finally {
      setKeepingId(null);
    }
  }

  async function keepAll() {
    if (bulkBusy) return;
    setBulkBusy(true);
    try {
      for (const s of suggestions) await keepSuggestion(s);
    } finally {
      setBulkBusy(false);
    }
  }

  function discardAll() {
    for (const s of suggestions) deleteMemorySuggestion(s.id);
  }

  // Superseded/archived items are hidden from the main list (and search) -
  // they live in the ArchivedMemoriesSection drawer at the bottom instead.
  const shown = (results ?? items).filter((m) => scoped(m) && isActiveMemory(m));
  const factCount = useMemo(
    () => items.filter((m) => scoped(m) && isActiveMemory(m)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projectId],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {onBack && (
          <button
            onClick={onBack}
            aria-label={t("common.back")}
            className="rounded-lg p-1.5 text-quon-muted hover:text-quon-text"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {/* Global sweep: mine chats without a project. Project chats are swept
              from the project dashboard instead. */}
          {!embedded && !projectId && <LearnFromChatsButton onShowReview={showReview} />}
          {!embedded && !projectId && <LearnFromDocumentsButton onShowReview={showReview} />}
          {items.filter(scoped).length > 0 && (
            <button
              onClick={() =>
                downloadText("quon-erinnerungen.md", memoriesToMarkdown(items.filter(scoped)))
              }
              title={t("memory.export")}
              aria-label={t("memory.export")}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-quon-border px-2.5 py-1.5 text-xs text-quon-text hover:border-quon-indigo/50"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t("memory.export")}</span>
            </button>
          )}
          <button
            onClick={() => (adding ? closeForm() : setAdding(true))}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover"
          >
            <Plus className="h-3.5 w-3.5" /> {t("memory.addMemory")}
          </button>
        </div>
      </div>

      {!embedded && (
        <div className="mt-4 flex items-center gap-2 text-xs text-quon-muted">
          <Brain className="h-4 w-4 shrink-0 text-quon-indigo" />
          <span className="text-quon-text">
            {plural(factCount, { one: "memory.count.one", other: "memory.count.other" })}
          </span>
          <span aria-hidden>·</span>
          <span>{t("memory.e2eeLabel")}</span>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t("memory.aboutEncryptionAria")}
                  className="text-quon-muted hover:text-quon-text"
                >
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-64 text-xs">
                {t("memory.encryptionTooltip")}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {!ready && (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> {t("memory.preparingSearchModel")}
            </span>
          )}
        </div>
      )}

      {/* Search */}
      <div className="mt-3 flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-quon-muted" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("memory.searchPlaceholder")}
          className="w-full bg-transparent text-sm text-quon-text outline-none placeholder:text-quon-muted"
        />
        {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-quon-muted" />}
        {query && !searching && (
          <button
            onClick={() => {
              setQuery("");
              setResults(null);
            }}
            className="text-quon-muted hover:text-quon-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Add / edit form */}
      <Dialog open={adding} onOpenChange={(o) => !o && closeForm()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingId ? t("memory.editingMemoryTitle") : t("memory.addMemoryTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="flex gap-2">
              {(["fact", "note"] as MemoryKind[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setDraftKind(k)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize ${
                    draftKind === k
                      ? "bg-quon-indigo text-white"
                      : "border border-quon-border text-quon-muted"
                  }`}
                >
                  {k === "fact" ? t("memory.kindFact") : t("memory.kindNote")}
                </button>
              ))}
            </div>
            {draftKind === "fact" && (
              <input
                value={draftKey}
                onChange={(e) => setDraftKey(e.target.value)}
                placeholder={t("memory.labelPlaceholder")}
                className="w-full rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-sm text-quon-text outline-none placeholder:text-quon-muted"
              />
            )}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("memory.textPlaceholder")}
              className="max-h-[55vh] min-h-[12rem] w-full resize-y rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 font-mono text-sm leading-relaxed text-quon-text outline-none placeholder:text-quon-muted"
            />
            {draftKind === "fact" && draft.trim().length > FACT_MAX_CHARS && (
              <p className="text-[10px] text-quon-yellow">{t("memory.longFactHint")}</p>
            )}
            <input
              value={draftTags}
              onChange={(e) => setDraftTags(e.target.value)}
              placeholder={t("memory.tagsPlaceholder")}
              className="w-full rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-xs text-quon-text outline-none placeholder:text-quon-muted"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={closeForm}
                className="rounded-lg px-3 py-1.5 text-xs text-quon-muted hover:text-quon-text"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleSave}
                disabled={!draft.trim() || saving}
                className="flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                {t("common.save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Large-paste triage - a big new text is almost never a memory. Offer the
          better homes first; "note anyway" stays available (honestly labeled). */}
      <Dialog open={triageOpen} onOpenChange={(o) => !o && !triageBusy && setTriageOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{t("memory.pasteTriage.title")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs leading-relaxed text-quon-muted">{t("memory.pasteTriage.intro")}</p>
          <div className="space-y-2">
            <button
              onClick={() => void triageSaveAsDocument()}
              disabled={triageBusy !== null}
              className="flex w-full items-start gap-2.5 rounded-xl border border-quon-border bg-quon-surface-2 p-3 text-left hover:border-quon-indigo/50 disabled:opacity-50"
            >
              {triageBusy === "doc" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-quon-indigo" />
              ) : (
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-quon-indigo" />
              )}
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-quon-text">
                  {t("memory.pasteTriage.asDocument")}
                </span>
                <span className="block text-[11px] text-quon-muted">
                  {t("memory.pasteTriage.asDocumentDesc")}
                </span>
              </span>
            </button>
            <button
              onClick={() => void triageExtractFacts()}
              disabled={triageBusy !== null}
              className="flex w-full items-start gap-2.5 rounded-xl border border-quon-border bg-quon-surface-2 p-3 text-left hover:border-quon-indigo/50 disabled:opacity-50"
            >
              {triageBusy === "extract" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-quon-indigo" />
              ) : (
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-quon-indigo" />
              )}
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-quon-text">
                  {t("memory.pasteTriage.extract")}
                </span>
                <span className="block text-[11px] text-quon-muted">
                  {t("memory.pasteTriage.extractDesc")}
                </span>
              </span>
            </button>
            <button
              onClick={() => void triageSaveAsNote()}
              disabled={triageBusy !== null}
              className="flex w-full items-start gap-2.5 rounded-xl border border-quon-border p-3 text-left hover:border-quon-indigo/50 disabled:opacity-50"
            >
              {triageBusy === "note" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-quon-muted" />
              ) : (
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-quon-muted" />
              )}
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-quon-text">
                  {t("memory.pasteTriage.asNote")}
                </span>
                <span className="block text-[11px] text-quon-muted">
                  {t("memory.pasteTriage.asNoteDesc")}
                </span>
              </span>
            </button>
          </div>
          {triageBusy === "extract" && (
            <p className="text-[11px] text-quon-muted">{t("memory.pasteTriage.extracting")}</p>
          )}
          {triageNotice && <p className="text-[11px] text-quon-yellow">{triageNotice}</p>}
        </DialogContent>
      </Dialog>

      {/* Review queue - suggestions mined from chats ("Learn from chats").
          Keep upserts to Memory, Edit keeps then reopens the form, Discard drops. */}
      {suggestions.length > 0 && (
        <div
          ref={reviewRef}
          className="mt-3 rounded-xl border border-quon-indigo/40 bg-quon-surface"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-quon-border px-3 py-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-quon-text">
              {t("memory.suggestionsHeader", { count: suggestions.length })}
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void keepAll()}
                disabled={bulkBusy || keepingId !== null}
                className="flex items-center gap-1 rounded-lg bg-quon-indigo px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
              >
                {bulkBusy && <Loader2 className="h-3 w-3 animate-spin" />} {t("memory.keepAll")}
              </button>
              <button
                onClick={discardAll}
                disabled={bulkBusy || keepingId !== null}
                className="rounded-lg border border-quon-border px-2.5 py-1 text-[10px] text-quon-muted hover:text-quon-text disabled:opacity-50"
              >
                {t("memory.discardAll")}
              </button>
            </div>
          </div>
          <div className="space-y-2 p-3">
            {suggestions.map((s) => {
              const target =
                s.mode === "update" && s.targetId ? getMemoryItem(s.targetId) : undefined;
              const sourceTitle = s.sourceSessionId
                ? getChatSession(s.sourceSessionId)?.title
                : undefined;
              // Looked up live, so a renamed document shows its current name.
              const sourceFilename = s.sourceDocId
                ? getDocument(s.sourceDocId)?.filename
                : undefined;
              const busy = bulkBusy || keepingId === s.id;
              return (
                <div
                  key={s.id}
                  className="rounded-lg border border-quon-border bg-quon-surface-2 p-2.5"
                >
                  {s.key && (
                    <div className="mb-0.5 text-xs font-semibold text-quon-text">{s.key}</div>
                  )}
                  <MemoryText text={s.text} />
                  {s.mode === "merge" && (s.targetIds?.length ?? 0) > 0 && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer list-none text-[10px] font-medium text-quon-indigo hover:underline">
                        {t("memory.mergeShowOriginals")}
                      </summary>
                      <ul className="mt-1 space-y-1 border-l-2 border-quon-border pl-2">
                        {s.targetIds!.map((id) => {
                          const orig = getMemoryItem(id);
                          return (
                            <li key={id} className="break-words text-[10px] text-quon-muted">
                              {orig ? orig.text : t("memory.deletedMemoryFallback")}
                            </li>
                          );
                        })}
                      </ul>
                    </details>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {s.mode === "merge" ? (
                      <>
                        <span className="inline-block rounded-full border border-quon-indigo/40 bg-quon-indigo/10 px-2 py-0.5 text-[10px] text-quon-indigo">
                          {t("memory.mergeBadge")}
                        </span>
                        <span className="text-[10px] text-quon-muted">
                          {plural(s.targetIds?.length ?? 0, {
                            one: "memory.mergeSources.one",
                            other: "memory.mergeSources.other",
                          })}
                        </span>
                      </>
                    ) : s.mode === "update" ? (
                      <span className="inline-block max-w-56 truncate rounded-full border border-quon-yellow/40 bg-quon-yellow/10 px-2 py-0.5 text-[10px] text-quon-yellow">
                        {t("memory.updatesLabel")}{" "}
                        {target
                          ? target.key || target.text.slice(0, 40)
                          : t("memory.deletedMemoryFallback")}
                      </span>
                    ) : (
                      <span className="inline-block rounded-full border border-quon-green/40 bg-quon-green/10 px-2 py-0.5 text-[10px] text-quon-green">
                        {t("memory.newBadge")}
                      </span>
                    )}
                    <span className="inline-block rounded-full border border-quon-border px-2 py-0.5 text-[10px] capitalize text-quon-muted">
                      {s.kind === "fact" ? t("memory.kindFact") : t("memory.kindNote")}
                    </span>
                    <span className="inline-flex min-w-0 items-center gap-1 text-[10px] text-quon-muted">
                      {s.sourceSessionId ? (
                        <MessageSquare className="h-3 w-3 shrink-0" />
                      ) : s.sourceDocId ? (
                        <FileText className="h-3 w-3 shrink-0" />
                      ) : (
                        <ClipboardPaste className="h-3 w-3 shrink-0" />
                      )}
                      <span className="max-w-40 truncate">
                        {s.sourceSessionId
                          ? (sourceTitle ?? t("memory.deletedChatFallback"))
                          : s.sourceDocId
                            ? (sourceFilename ?? t("memory.deletedDocFallback"))
                            : t("memory.fromPaste")}
                      </span>
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => void keepOne(s)}
                        disabled={busy}
                        className="flex items-center gap-1 rounded-lg bg-quon-indigo px-2 py-1 text-[10px] font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
                      >
                        {keepingId === s.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                        {t("memory.keep")}
                      </button>
                      <button
                        onClick={() => void editOne(s)}
                        disabled={busy}
                        className="rounded-lg border border-quon-border px-2 py-1 text-[10px] text-quon-muted hover:text-quon-text disabled:opacity-50"
                      >
                        {t("common.edit")}
                      </button>
                      <button
                        onClick={() => deleteMemorySuggestion(s.id)}
                        disabled={busy}
                        aria-label={t("memory.discardSuggestionAria")}
                        className="rounded-lg border border-quon-border px-2 py-1 text-[10px] text-quon-muted hover:text-destructive disabled:opacity-50"
                      >
                        {t("memory.discard")}
                      </button>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Maintenance row (P5) - renders nothing unless conflicts/attic/tidy exist */}
      <MemoryHealthRow projectId={projectId} />
      <PinCrowdingHint projectId={projectId} />

      {/* List / results */}
      <div className="mt-4 flex-1 space-y-2 overflow-y-auto">
        {shown.length === 0 && (
          <div className="rounded-xl border border-dashed border-quon-border px-4 py-8 text-center text-xs text-quon-muted">
            {results !== null ? t("memory.noMatches") : t("memory.emptyState")}
          </div>
        )}
        {shown.map((m) => (
          <div key={m.id} className="rounded-xl border border-quon-border bg-quon-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {m.key && (
                  <div className="mb-0.5 text-xs font-semibold text-quon-text">{m.key}</div>
                )}
                <MemoryText text={m.text} />
              </div>
              <div className="flex shrink-0 items-center">
                {m.text.length <= FACT_MAX_CHARS && (
                  <button
                    onClick={() => togglePin(m)}
                    aria-pressed={!!m.pinned}
                    title={m.pinned ? t("memory.unpin") : t("memory.pin")}
                    aria-label={m.pinned ? t("memory.unpin") : t("memory.pin")}
                    className={`rounded p-1 ${
                      m.pinned ? "text-quon-indigo" : "text-quon-muted hover:text-quon-text"
                    }`}
                  >
                    <Pin className={`h-3.5 w-3.5 ${m.pinned ? "fill-current" : ""}`} />
                  </button>
                )}
                <button
                  onClick={() => startEdit(m)}
                  className="rounded p-1 text-quon-muted hover:text-quon-text"
                  aria-label={t("memory.editMemoryAria")}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => deleteMemoryItem(m.id)}
                  className="rounded p-1 text-quon-muted hover:text-destructive"
                  aria-label={t("memory.deleteMemoryAria")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="inline-block rounded-full border border-quon-border bg-quon-surface-2 px-2 py-0.5 text-[10px] capitalize text-quon-muted">
                {m.kind === "fact" ? t("memory.kindFact") : t("memory.kindNote")}
              </span>
              {m.pinned && (
                <span className="inline-flex items-center gap-1 rounded-full border border-quon-indigo/40 bg-quon-indigo/10 px-2 py-0.5 text-[10px] text-quon-indigo">
                  <Pin className="h-2.5 w-2.5 fill-current" />
                  {t("memory.pinnedBadge")}
                </span>
              )}
              {m.text.length > PASTE_TRIAGE_CHARS && (
                <>
                  <span className="inline-block rounded-full border border-quon-yellow/40 bg-quon-yellow/10 px-2 py-0.5 text-[10px] text-quon-yellow">
                    {t("memory.largeBadge")}
                  </span>
                  <button
                    onClick={() => void convertToDocument(m)}
                    disabled={convertingId !== null}
                    aria-label={t("memory.convertToDocumentAria")}
                    className="inline-flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-[10px] text-quon-muted hover:border-quon-indigo/50 hover:text-quon-text disabled:opacity-50"
                  >
                    {convertingId === m.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {t("memory.convertToDocument")}
                  </button>
                </>
              )}
              {m.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block rounded-full border border-quon-border bg-quon-surface-2 px-2 py-0.5 text-[10px] text-quon-muted"
                >
                  {tag}
                </span>
              ))}
              {!m.embedding && (
                <span className="text-[10px] text-quon-yellow">{t("memory.notIndexed")}</span>
              )}
              <span className="ml-auto">
                <ProjectPickerBadge
                  value={m.projectId}
                  onChange={(pid) => setMemoryProject(m.id, pid)}
                />
              </span>
            </div>
          </div>
        ))}
        {/* Recovery drawer for superseded/archived items - quiet text link only */}
        <ArchivedMemoriesSection projectId={projectId} />
      </div>
    </div>
  );
}
