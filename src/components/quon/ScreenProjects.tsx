import { useEffect, useState, useSyncExternalStore } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FileText,
  FolderKanban,
  FolderPlus,
  MessageSquare,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  createProjectId,
  deleteProjectAndOrphanContent,
  getProject,
  nextProjectColor,
  PROJECT_COLOR_HEX,
  PROJECT_COLORS,
  upsertProject,
  useProjects,
  type ProjectColor,
} from "@/lib/projectStore";
import { sharesApi } from "@/lib/api/sharesApi";
import { useDocuments } from "@/lib/documentStore";
import { translateApiError } from "@/lib/i18n/apiErrors";
import type { MessageKey } from "@/lib/i18n/catalog";
import { useT } from "@/lib/i18n/i18n";
import { useMemory } from "@/lib/memoryStore";
import { CHAT_MODELS, getModels, type ChatModel } from "@/lib/quonApi";
import { chatModelDisplay, showProviderTag } from "@/lib/modelDisplay";
import {
  quon,
  useChatHistory,
  useQuonState,
  type ProtectionLevel,
  type ReasoningEffort,
} from "@/lib/quonStore";
import { getSharedSnapshot, refreshSharedSync, subscribeShared } from "@/lib/sharedSync";
import { EntityTypeChecklist } from "./settings/EntityTypeChecklist";
import { LearnFromChatsButton, LearnFromDocumentsButton } from "./LearnFromChatsButton";
import { Notice } from "./Notice";
import { ProjectSharingCard } from "./ProjectSharingCard";
import { ProjectAgents } from "./ProjectAgents";
import { FEATURES } from "@/lib/features";
import { ScreenDocuments } from "./ScreenDocuments";
import { ScreenMemory } from "./ScreenMemory";

const hex = (c?: ProjectColor) => PROJECT_COLOR_HEX[c ?? "indigo"];

// Sentinel for the "no per-project default" state of the chat-default selects
// (radix Select items can't carry an empty-string value).
const GLOBAL_DEFAULT = "global";

/** Protection options offered as a project default (mirrors the chat pills;
 *  "full"/local-LLM is still disabled in the UI, so it isn't offered here). */
const PROTECTION_OPTIONS: Array<{ value: ProtectionLevel; labelKey: MessageKey }> = [
  { value: "none", labelKey: "projects.protectionNone" },
  { value: "local", labelKey: "projects.protectionFilter" },
  { value: "review", labelKey: "projects.protectionReview" },
];

const EFFORT_OPTIONS: Array<{ value: ReasoningEffort; labelKey: MessageKey }> = [
  { value: "off", labelKey: "projects.effortOff" },
  { value: "low", labelKey: "projects.effortLow" },
  { value: "medium", labelKey: "projects.effortMedium" },
  { value: "high", labelKey: "projects.effortHigh" },
];

/** Colour swatch aria-label — the id itself (e.g. "indigo") isn't user-facing text. */
const COLOUR_NAME_KEY: Record<ProjectColor, MessageKey> = {
  indigo: "projects.colourIndigo",
  green: "projects.colourGreen",
  yellow: "projects.colourYellow",
  sky: "projects.colourSky",
  rose: "projects.colourRose",
  teal: "projects.colourTeal",
  purple: "projects.colourPurple",
  orange: "projects.colourOrange",
};

export function ScreenProjects() {
  const { id } = useSearch({ from: "/projects" });
  return id ? <ProjectDetail id={id} /> : <ProjectList />;
}

// ---------------------------------------------------------------------------
// List mode
// ---------------------------------------------------------------------------

function ProjectList() {
  const navigate = useNavigate();
  const { t, plural } = useT();
  const projects = useProjects();
  const history = useChatHistory();
  const memItems = useMemory();
  const docItems = useDocuments();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");

  function create() {
    const clean = name.trim();
    if (!clean) return;
    const newId = createProjectId();
    const now = Date.now();
    upsertProject({
      id: newId,
      name: clean,
      color: nextProjectColor(projects),
      createdAt: now,
      updatedAt: now,
    });
    setName("");
    setAdding(false);
    navigate({ to: "/projects", search: { id: newId } });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderKanban className="h-5 w-5 text-quon-indigo" />
          <h1 className="text-lg font-semibold text-quon-text">{t("projects.title")}</h1>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover"
        >
          <FolderPlus className="h-3.5 w-3.5" /> {t("projects.newProject")}
        </button>
      </div>
      <p className="mt-1 text-xs text-quon-muted">{t("projects.subtitle")}</p>

      {adding && (
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-quon-indigo/40 bg-quon-surface p-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
            placeholder={t("projects.namePlaceholder")}
            className="w-full rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-sm text-quon-text outline-none placeholder:text-quon-muted"
          />
          <button
            onClick={create}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-2 text-xs font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> {t("projects.create")}
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects.length === 0 && !adding && (
          <div className="col-span-full rounded-xl border border-dashed border-quon-border px-4 py-10 text-center text-xs text-quon-muted">
            {t("projects.emptyState")}
          </div>
        )}
        {projects.map((p) => {
          const chatCount = history.filter((s) => s.projectId === p.id).length;
          const memCount = memItems.filter((m) => m.projectId === p.id).length;
          const docCount = docItems.filter((d) => d.projectId === p.id).length;
          return (
            <Link
              key={p.id}
              to="/projects"
              search={{ id: p.id }}
              className="flex flex-col gap-2 rounded-xl border border-quon-border bg-quon-surface p-4 transition hover:border-quon-indigo/50"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: hex(p.color) }}
                />
                <span className="truncate text-sm font-semibold text-quon-text">{p.name}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-quon-muted">
                <span>
                  {plural(chatCount, {
                    one: "projects.chatCountOne",
                    other: "projects.chatCountOther",
                  })}
                </span>
                <span>
                  {plural(memCount, {
                    one: "projects.memoryCountOne",
                    other: "projects.memoryCountOther",
                  })}
                </span>
                <span>
                  {plural(docCount, {
                    one: "projects.docCountOne",
                    other: "projects.docCountOther",
                  })}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail mode
// ---------------------------------------------------------------------------

type DetailTab = "overview" | "content" | "settings";

function ProjectDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const { t, plural } = useT();
  const projects = useProjects();
  const history = useChatHistory();
  const memItems = useMemory();
  const docItems = useDocuments();
  const project = projects.find((p) => p.id === id) ?? getProject(id);

  // Local tab state (not a search param): unsaved editor state survives tab
  // switches because it lives here, not inside the (unmounting) tab contents.
  const [tab, setTab] = useState<DetailTab>("overview");
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  // A different project always opens on Overview (the component isn't keyed,
  // so it stays mounted when navigating between projects).
  useEffect(() => {
    setTab("overview");
    setDefaultsOpen(false);
  }, [id]);
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [color, setColor] = useState<ProjectColor>("indigo");
  // Chat-default selects; GLOBAL_DEFAULT = no per-project default (use the global setting).
  const [defModel, setDefModel] = useState<string>(GLOBAL_DEFAULT);
  const [defProtection, setDefProtection] = useState<string>(GLOBAL_DEFAULT);
  const [defEffort, setDefEffort] = useState<string>(GLOBAL_DEFAULT);
  // null = use the global type set; an array = this project's own drop-list.
  const [defDisabledTypes, setDefDisabledTypes] = useState<string[] | null>(null);
  // Model options for the default-model select — same source as the chat picker:
  // the backend /models list, falling back to the bundled CHAT_MODELS.
  const [models, setModels] = useState<ChatModel[]>(CHAT_MODELS);

  // Sharing state, needed for the delete-project confirm dialog: an owner
  // deleting a shared project must unshare it first (see removeProject below),
  // and the dialog copy must say so up front rather than the members finding
  // out by their copy silently freezing.
  const shareRoles = useSyncExternalStore(subscribeShared, getSharedSnapshot, getSharedSnapshot);
  const shareRole = shareRoles.get(id) ?? null;
  const [shareMemberCount, setShareMemberCount] = useState<number | null>(null);
  useEffect(() => {
    if (shareRole !== "owner") {
      setShareMemberCount(null);
      return;
    }
    let cancelled = false;
    sharesApi
      .members(id)
      .then((m) => {
        if (!cancelled) setShareMemberCount(m.length);
      })
      .catch(() => {
        /* transient — the dialog falls back to generic "this project is shared" copy */
      });
    return () => {
      cancelled = true;
    };
  }, [id, shareRole]);
  // Members list includes the owner themselves; the copy talks about OTHER people.
  const otherShareMembers = shareMemberCount !== null ? Math.max(shareMemberCount - 1, 0) : null;

  // One-time "your access was revoked" banner (sharedSync flags this when a
  // grant this device was tracking disappears from a successful /shares list —
  // see quonStore's revokedSharedProjectIds docstring).
  const revokedSharedProjectIds = useQuonState().revokedSharedProjectIds;
  const accessRevoked = revokedSharedProjectIds.includes(id);

  // Delete-project dialog: controlled (not just AlertDialogTrigger) so an
  // unshare failure can keep it open with an error instead of silently
  // deleting locally and leaking the share server-side.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getModels()
      .then((list) => {
        if (!cancelled && list.length) setModels(list);
      })
      .catch(() => {
        /* keep the bundled CHAT_MODELS */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed the editable fields when the selected project changes (or first loads via
  // sync). Keyed on id + updatedAt so a remote edit refreshes the form.
  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setInstructions(project.instructions ?? "");
    setColor(project.color ?? "indigo");
    setDefModel(project.defaultModelId ?? GLOBAL_DEFAULT);
    setDefProtection(project.defaultProtection ?? GLOBAL_DEFAULT);
    setDefEffort(project.defaultReasoningEffort ?? GLOBAL_DEFAULT);
    setDefDisabledTypes(project.defaultDisabledEntityTypes ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, project?.updatedAt]);

  if (!project) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-5 py-10 text-center">
        <p className="text-sm text-quon-muted">{t("projects.notFound")}</p>
        <Link
          to="/projects"
          search={{}}
          className="rounded-lg border border-quon-border px-3 py-1.5 text-xs text-quon-text hover:border-quon-indigo/50"
        >
          {t("projects.backToProjects")}
        </Link>
      </div>
    );
  }

  const dirty =
    name.trim() !== project.name ||
    instructions !== (project.instructions ?? "") ||
    color !== (project.color ?? "indigo") ||
    defModel !== (project.defaultModelId ?? GLOBAL_DEFAULT) ||
    defProtection !== (project.defaultProtection ?? GLOBAL_DEFAULT) ||
    defEffort !== (project.defaultReasoningEffort ?? GLOBAL_DEFAULT) ||
    JSON.stringify(defDisabledTypes) !== JSON.stringify(project.defaultDisabledEntityTypes ?? null);

  function save() {
    if (!project || !name.trim()) return;
    upsertProject({
      ...project,
      name: name.trim(),
      instructions: instructions.trim() || undefined,
      color,
      defaultModelId: defModel === GLOBAL_DEFAULT ? undefined : defModel,
      defaultProtection:
        defProtection === GLOBAL_DEFAULT ? undefined : (defProtection as ProtectionLevel),
      defaultReasoningEffort:
        defEffort === GLOBAL_DEFAULT ? undefined : (defEffort as ReasoningEffort),
      defaultDisabledEntityTypes: defDisabledTypes ?? undefined,
      updatedAt: Date.now(),
    });
  }

  // Owner deleting a shared project must stop sharing FIRST: `deleteProjectAndOrphanContent`
  // only touches this device's local store, so without this the server-side share
  // (and every member's grant) would leak — orphaned forever, members frozen with
  // no explanation. If unshare fails, abort WITHOUT deleting locally so the two
  // never drift apart.
  async function removeProject(event: { preventDefault: () => void }) {
    event.preventDefault(); // keep the AlertDialog open; we close it manually below
    setDeleteError(null);
    if (shareRole === "owner") {
      setDeleteBusy(true);
      try {
        await sharesApi.unshare(id);
        await refreshSharedSync();
      } catch (err) {
        setDeleteBusy(false);
        setDeleteError(
          t("projects.deleteDialogUnshareFailed", { reason: translateApiError(err, t) }),
        );
        return;
      }
      setDeleteBusy(false);
      // The unshare above makes this device's own next refreshSharedSync() no
      // longer list `id` — indistinguishable, from that helper's point of
      // view, from a member being revoked. That flag is meant for OTHER
      // members, not the owner who just deleted their own project; clear it
      // so no stale "revoked" banner lingers for an id that's about to stop
      // existing locally anyway.
      quon.dismissSharedProjectRevoked(id);
    }
    deleteProjectAndOrphanContent(id);
    setDeleteOpen(false);
    navigate({ to: "/projects", search: {} });
  }

  const chats = history.filter((s) => s.projectId === id);
  const memories = memItems.filter((m) => m.projectId === id);
  const docs = docItems.filter((d) => d.projectId === id);
  // How many chat defaults deviate from the global setting — shown on the
  // (collapsed) disclosure so an active override is never silently hidden.
  const overrideCount =
    (defDisabledTypes !== null ? 1 : 0) +
    [defModel, defProtection, defEffort].filter((v) => v !== GLOBAL_DEFAULT).length;

  // Delete-dialog description: three shared-owner variants (member count unknown,
  // zero, or a known N — each has different trailing copy) plus the plain
  // non-shared case. Kept as one helper so the JSX below stays a single ternary.
  function deleteDialogDescription(): string {
    if (shareRole !== "owner") return t("projects.deleteDialogDescSimple");
    if (otherShareMembers === null) return t("projects.deleteDialogDescOwnerUnknown");
    if (otherShareMembers === 0) {
      return t("projects.deleteDialogDescOwnerZero", { count: otherShareMembers });
    }
    return plural(otherShareMembers, {
      one: "projects.deleteDialogDescOwnerMembersOne",
      other: "projects.deleteDialogDescOwnerMembersOther",
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
      {/* Header: back + name. Editing (incl. delete) lives in the Settings tab. */}
      <div className="flex min-w-0 items-center gap-2">
        <Link
          to="/projects"
          search={{}}
          className="rounded-lg p-1.5 text-quon-muted hover:text-quon-text"
          aria-label={t("projects.backToProjects")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: hex(color) }} />
        <h1 className="truncate text-base font-semibold text-quon-text">{project.name}</h1>
      </div>

      {accessRevoked && (
        <div className="mt-3">
          <Notice variant="warning" onDismiss={() => quon.dismissSharedProjectRevoked(id)}>
            {t("projects.accessRevokedBanner")}
          </Notice>
        </div>
      )}

      {/* Overview = "what is this project / open a chat", Content = the full
          memory+documents apps, Settings = everything configured rarely. The
          editor state lives on ProjectDetail, so unsaved edits survive tab
          switches (only the inactive tab's DOM unmounts). */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)}>
        <TabsList className="mt-3 grid h-9 w-full grid-cols-3 rounded-lg border border-quon-border bg-quon-surface p-1">
          {(
            [
              { value: "overview", labelKey: "projects.tabOverview" },
              { value: "content", labelKey: "projects.tabContent" },
              { value: "settings", labelKey: "projects.tabSettings" },
            ] as const
          ).map((tb) => (
            <TabsTrigger
              key={tb.value}
              value={tb.value}
              className="rounded-md text-xs text-quon-muted data-[state=active]:bg-quon-surface-2 data-[state=active]:text-quon-text data-[state=active]:shadow-none"
            >
              {t(tb.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ---------------------------------------------------------- Overview */}
        <TabsContent value="overview" className="mt-3">
          {/* What this project knows — read client-side from the stores; the
              chips jump to where the items actually live. */}
          <div className="rounded-xl border border-quon-border bg-quon-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-quon-muted">
              {t("projects.whatThisProjectKnows")}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-quon-muted">
                <MessageSquare className="h-3 w-3" />
                {plural(chats.length, {
                  one: "projects.chatCountOne",
                  other: "projects.chatCountOther",
                })}
              </span>
              <button
                onClick={() => setTab("content")}
                className="inline-flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-quon-muted transition hover:border-quon-indigo/50 hover:text-quon-text"
              >
                <Sparkles className="h-3 w-3" />
                {plural(memories.length, {
                  one: "projects.memoryCountOne",
                  other: "projects.memoryCountOther",
                })}
              </button>
              <button
                onClick={() => setTab("content")}
                className="inline-flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-quon-muted transition hover:border-quon-indigo/50 hover:text-quon-text"
              >
                <FileText className="h-3 w-3" />
                {plural(docs.length, {
                  one: "projects.docCountOne",
                  other: "projects.docCountOther",
                })}
              </button>
              <button
                onClick={() => setTab("settings")}
                className="inline-flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-quon-muted transition hover:border-quon-indigo/50 hover:text-quon-text"
              >
                {project.instructions?.trim()
                  ? t("projects.instructionSet")
                  : t("projects.noInstruction")}
              </button>
            </div>
            {/* Auto-Memory v1: manually mine this project's chats and documents
                for facts worth remembering. Fills the review queue in Content →
                Project memory — nothing is saved without approval there. */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <LearnFromChatsButton projectId={id} onShowReview={() => setTab("content")} />
              <LearnFromDocumentsButton projectId={id} onShowReview={() => setTab("content")} />
            </div>
          </div>

          {/* Chats — the core action, visible without scrolling. */}
          <div className="mt-4 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-quon-muted">
              {t("projects.chatsHeading")}
            </h2>
            <Link
              to="/chat"
              search={{ p: id }}
              className="flex items-center gap-1 rounded-lg border border-quon-border px-2 py-1 text-[11px] text-quon-text hover:border-quon-indigo/50"
            >
              <Plus className="h-3 w-3" /> {t("projects.newChat")}
            </Link>
          </div>
          <div className="mt-2 space-y-1.5">
            {chats.length === 0 ? (
              <div className="rounded-xl border border-dashed border-quon-border px-4 py-6 text-center text-xs text-quon-muted">
                {t("projects.noChatsYet")}
              </div>
            ) : (
              chats.map((s) => (
                <Link
                  key={s.id}
                  to="/chat"
                  search={{ c: s.id }}
                  className="flex items-center gap-2 rounded-lg border border-quon-border bg-quon-surface px-3 py-2 text-xs text-quon-text transition hover:border-quon-indigo/50"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-quon-muted" />
                  <span className="truncate">{s.title}</span>
                </Link>
              ))
            )}
          </div>
        </TabsContent>

        {/* ----------------------------------------------------------- Content */}
        <TabsContent value="content" className="mt-3">
          <div className="rounded-xl border border-quon-border">
            <div className="border-b border-quon-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-quon-muted">
              {t("projects.projectMemory")}
            </div>
            <ScreenMemory projectId={id} embedded />
          </div>
          <div className="mt-4 rounded-xl border border-quon-border">
            <div className="border-b border-quon-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-quon-muted">
              {t("projects.projectDocuments")}
            </div>
            <ScreenDocuments projectId={id} embedded />
          </div>
          {FEATURES.agents && (
            <div className="mt-4 rounded-xl border border-quon-border">
              <div className="border-b border-quon-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-quon-muted">
                {t("projects.projectAgents")}
              </div>
              <ProjectAgents projectId={id} />
            </div>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- Settings */}
        <TabsContent value="settings" className="mt-3">
          {/* Name + colour + instruction editor */}
          <div className="space-y-3 rounded-xl border border-quon-border bg-quon-surface p-4">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: hex(color) }} />
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("projects.nameFieldPlaceholder")}
                className="w-full bg-transparent text-base font-semibold text-quon-text outline-none placeholder:text-quon-muted"
              />
            </div>
            <div className="flex items-center gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={t("projects.colourLabel", { color: t(COLOUR_NAME_KEY[c]) })}
                  className={`h-5 w-5 rounded-full ring-2 ring-offset-2 ring-offset-quon-surface transition ${
                    color === c ? "ring-quon-text" : "ring-transparent"
                  }`}
                  style={{ background: hex(c) }}
                />
              ))}
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-quon-muted">
                {t("projects.instructionsLabel")}
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                placeholder={t("projects.instructionsPlaceholder")}
                className="mt-1 w-full resize-none rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-sm text-quon-text outline-none placeholder:text-quon-muted"
              />
              <p className="mt-1 text-[10px] text-quon-muted">{t("projects.instructionsHelp")}</p>
            </div>
            {/* Per-project chat defaults, collapsed by default: rarely touched,
                but an active override stays visible via the badge on the header
                (never a silent override). */}
            <div>
              <button
                type="button"
                onClick={() => setDefaultsOpen((v) => !v)}
                aria-expanded={defaultsOpen}
                className="flex w-full items-center gap-2"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-quon-muted">
                  {t("projects.chatDefaults")}
                </span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[9px] font-medium ${
                    overrideCount > 0
                      ? "border-quon-indigo/40 bg-quon-indigo/10 text-quon-indigo"
                      : "border-quon-border text-quon-muted"
                  }`}
                >
                  {overrideCount > 0
                    ? t("projects.customOverridesCount", { count: overrideCount })
                    : t("projects.usingGlobalDefaults")}
                </span>
                <ChevronDown
                  className={`ml-auto h-3.5 w-3.5 text-quon-muted transition-transform ${
                    defaultsOpen ? "rotate-180" : ""
                  }`}
                />
              </button>
              {defaultsOpen && (
                <>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div>
                      <span className="text-[10px] text-quon-muted">
                        {t("projects.defaultsModelLabel")}
                      </span>
                      <Select value={defModel} onValueChange={setDefModel}>
                        <SelectTrigger className="mt-0.5 h-8 w-full rounded-lg border-quon-border bg-quon-surface-2 px-2.5 text-xs text-quon-text">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-quon-border bg-quon-surface text-quon-text">
                          <SelectItem value={GLOBAL_DEFAULT} className="text-xs">
                            {t("projects.useGlobalDefault")}
                          </SelectItem>
                          {models.map((m) => {
                            const d = chatModelDisplay(m);
                            return (
                              <SelectItem
                                key={m.id}
                                value={m.id}
                                disabled={m.disabled}
                                className="text-xs"
                                title={m.model ?? m.id}
                              >
                                <span className="flex w-full items-center gap-2">
                                  <span className="truncate">{d.name}</span>
                                  {showProviderTag(d) && (
                                    <span className="shrink-0 text-[10px] text-quon-muted">
                                      {d.provider}
                                    </span>
                                  )}
                                </span>
                              </SelectItem>
                            );
                          })}
                          {/* A saved default that's no longer offered (e.g. a removed BYOK
                              provider) still renders instead of blanking the select. */}
                          {defModel !== GLOBAL_DEFAULT &&
                            !models.some((m) => m.id === defModel) && (
                              <SelectItem value={defModel} className="text-xs">
                                {defModel}
                              </SelectItem>
                            )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <span className="text-[10px] text-quon-muted">
                        {t("projects.defaultsProtectionLabel")}
                      </span>
                      <Select value={defProtection} onValueChange={setDefProtection}>
                        <SelectTrigger className="mt-0.5 h-8 w-full rounded-lg border-quon-border bg-quon-surface-2 px-2.5 text-xs text-quon-text">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-quon-border bg-quon-surface text-quon-text">
                          <SelectItem value={GLOBAL_DEFAULT} className="text-xs">
                            {t("projects.useGlobalDefault")}
                          </SelectItem>
                          {PROTECTION_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">
                              {t(o.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <span className="text-[10px] text-quon-muted">
                        {t("projects.defaultsReasoningLabel")}
                      </span>
                      <Select value={defEffort} onValueChange={setDefEffort}>
                        <SelectTrigger className="mt-0.5 h-8 w-full rounded-lg border-quon-border bg-quon-surface-2 px-2.5 text-xs text-quon-text">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-quon-border bg-quon-surface text-quon-text">
                          <SelectItem value={GLOBAL_DEFAULT} className="text-xs">
                            {t("projects.useGlobalDefault")}
                          </SelectItem>
                          {EFFORT_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">
                              {t(o.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Per-project redaction-type override (drop-list) */}
                  <div className="mt-3 border-t border-quon-border pt-3">
                    <label className="flex items-center gap-2 text-xs text-quon-text">
                      <input
                        type="checkbox"
                        checked={defDisabledTypes !== null}
                        onChange={(e) => setDefDisabledTypes(e.target.checked ? [] : null)}
                      />
                      {t("projects.typesOverride")}
                    </label>
                    {defDisabledTypes !== null && (
                      <div className="mt-2">
                        <EntityTypeChecklist
                          disabled={defDisabledTypes}
                          onToggle={(type, enabled) =>
                            setDefDisabledTypes((cur) => {
                              const next = new Set(cur ?? []);
                              if (enabled) next.delete(type);
                              else next.add(type);
                              return [...next];
                            })
                          }
                        />
                      </div>
                    )}
                  </div>

                  <p className="mt-1 text-[10px] text-quon-muted">
                    {t("projects.chatDefaultsHelp")}
                  </p>
                </>
              )}
            </div>
            <div className="flex justify-end">
              <button
                onClick={save}
                disabled={!dirty || !name.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-50"
              >
                <Check className="h-3.5 w-3.5" />{" "}
                {dirty ? t("projects.saveChanges") : t("projects.saved")}
              </button>
            </div>
          </div>

          {/* Sharing (Shared Projects v1): share/invite/members/leave. Compact
              one-liner while unshared (see ProjectSharingCard). */}
          {FEATURES.sharing && <ProjectSharingCard projectId={id} />}

          {/* Danger zone */}
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-quon-surface p-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-quon-text">
                {t("projects.deleteThisProject")}
              </div>
              <p className="mt-0.5 text-[10px] text-quon-muted">
                {shareRole === "owner"
                  ? t("projects.deleteDescOwner")
                  : t("projects.deleteDescMember")}
              </p>
            </div>
            <AlertDialog
              open={deleteOpen}
              onOpenChange={(open) => {
                setDeleteOpen(open);
                if (!open) setDeleteError(null);
              }}
            >
              <AlertDialogTrigger asChild>
                <button className="flex shrink-0 items-center gap-1.5 rounded-lg border border-quon-border px-2.5 py-1.5 text-xs text-red-400 hover:border-red-500/40 hover:bg-red-500/10">
                  <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t("projects.deleteDialogTitle", { name: project.name })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{deleteDialogDescription()}</AlertDialogDescription>
                </AlertDialogHeader>
                {deleteError && (
                  <Notice variant="error" onDismiss={() => setDeleteError(null)}>
                    {deleteError}
                  </Notice>
                )}
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => void removeProject(e)}
                    disabled={deleteBusy}
                    className="bg-red-500 text-white hover:bg-red-600 disabled:opacity-60"
                  >
                    {deleteBusy
                      ? t("projects.deleteDialogDeleting")
                      : t("projects.deleteDialogConfirm")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
