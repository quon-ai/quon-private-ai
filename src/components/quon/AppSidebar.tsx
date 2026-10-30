import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Brain,
  ChevronRight,
  FileText,
  FolderInput,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X,
  ShieldCheck,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Logo, LogoMark } from "./Logo";
import { ProtectionPill } from "./ProtectionPill";
import { FeedbackDialog } from "./FeedbackDialog";
import { FEATURES, OPTIONAL_NAV } from "@/lib/features";
import { markExplicitNewChat } from "@/lib/chatNav";
import {
  deleteChatSession,
  renameChatSession,
  setChatProject,
  togglePinChatSession,
  useChatHistory,
  type ChatSession,
} from "@/lib/quonStore";
import { PROJECT_COLOR_HEX, useProjects, type ProjectColor } from "@/lib/projectStore";
import { groupSessionsByProject } from "@/lib/projectGrouping";
import {
  searchChatSessions,
  segmentByHighlights,
  type ChatSearchHit,
  type HighlightRange,
} from "@/lib/chatSearch";
import { logout, useAuth } from "@/lib/authStore";
import { useT } from "@/lib/i18n/i18n";

const items = [
  { titleKey: "nav.dashboard", url: "/dashboard", icon: LayoutDashboard, disabled: false },
  { titleKey: "nav.chat", url: "/chat", icon: MessageSquare, disabled: false },
  { titleKey: "nav.memory", url: "/memory", icon: Brain, disabled: false },
  { titleKey: "nav.documents", url: "/documents", icon: FileText, disabled: false },
  { titleKey: "nav.projects", url: "/projects", icon: FolderKanban, disabled: false },
] as const;

/** Core entries, then the optional features' entries (features.ts). */
const navItems = [...items, ...OPTIONAL_NAV] as const;

/** Operator-only entry — appended after the main items when me.role==='admin'
 *  (the server enforces the role on every /admin call; this is visibility). */
const adminItem = {
  titleKey: "nav.admin",
  url: "/admin",
  icon: ShieldCheck,
  disabled: false,
} as const;

const colorHex = (c?: ProjectColor) => PROJECT_COLOR_HEX[c ?? "indigo"];

/** Text with search matches marked — same yellow marker as the chat's PII highlight. */
function MarkedText({ text, highlights }: { text: string; highlights: HighlightRange[] }) {
  return (
    <>
      {segmentByHighlights(text, highlights).map((seg, i) =>
        seg.hit ? (
          <span
            key={i}
            className="rounded-[3px] bg-quon-yellow/30 px-0.5 ring-1 ring-inset ring-quon-yellow/40"
          >
            {seg.text}
          </span>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

export function AppSidebar() {
  const { t } = useT();
  const isAdmin = useAuth().user?.role === "admin";
  const { pathname, activeChatId, chatProjectParam, projectsPageId } = useRouterState({
    select: (router) => {
      const s = router.location.search as { c?: string; p?: string; id?: string };
      return {
        pathname: router.location.pathname,
        activeChatId: s.c,
        chatProjectParam: s.p,
        projectsPageId: s.id,
      };
    },
  });
  const navigate = useNavigate();
  const history = useChatHistory();
  const projects = useProjects();
  const { groups, ungrouped } = groupSessionsByProject(history, projects);
  const { isMobile, setOpenMobile } = useSidebar();
  const isActive = (path: string) => pathname === path;

  // Project chat lists are collapsed by default and expandable, so a sidebar
  // full of projects stays scannable. The project you're currently working in
  // (its chat is open, you opened a new chat in it, or you're on its page)
  // auto-expands so the active chat is never hidden.
  const activeProjectId = useMemo(() => {
    if (pathname === "/chat") {
      if (chatProjectParam) return chatProjectParam;
      if (activeChatId) return history.find((s) => s.id === activeChatId)?.projectId ?? null;
    }
    if (pathname === "/projects" && projectsPageId) return projectsPageId;
    return null;
  }, [pathname, chatProjectParam, activeChatId, projectsPageId, history]);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!activeProjectId) return;
    setExpandedProjects((prev) => {
      if (prev.has(activeProjectId)) return prev;
      const next = new Set(prev);
      next.add(activeProjectId);
      return next;
    });
  }, [activeProjectId]);

  function toggleProject(id: string) {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const deletingSession = history.find((s) => s.id === deleteId);

  // Full-text chat search. Runs entirely over the decrypted in-memory history
  // (zero-knowledge — nothing leaves the device). The raw input is debounced
  // into `searchQuery` so we don't re-scan every session on each keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);
  const searching = searchQuery.length > 0;
  const searchHits = useMemo(
    () => (searching ? searchChatSessions(history, searchQuery) : []),
    [history, searchQuery, searching],
  );

  function clearSearch() {
    setSearchInput("");
    setSearchQuery("");
  }

  function closeSidebar() {
    if (isMobile) setOpenMobile(false);
  }

  function newChat() {
    closeSidebar();
    markExplicitNewChat(); // real "+" — must beat a pending self-nav (see chatNav.ts)
    navigate({ to: "/chat", search: {} });
  }

  function newChatInProject(projectId: string) {
    closeSidebar();
    markExplicitNewChat();
    navigate({ to: "/chat", search: { p: projectId } });
  }

  function startRename(id: string, title: string) {
    setRenamingId(id);
    setRenameValue(title);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) renameChatSession(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue("");
  }

  // One chat row (shared by project groups and Recents): rename input, or the link
  // + options menu (rename / pin / move to project / delete).
  function renderSession(session: ChatSession) {
    if (renamingId === session.id) {
      return (
        <SidebarMenuItem key={session.id} className="px-2 py-1">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") {
                setRenamingId(null);
                setRenameValue("");
              }
            }}
            className="w-full rounded border border-quon-indigo/50 bg-quon-surface px-2 py-1 text-[11px] text-quon-text focus:outline-none"
          />
        </SidebarMenuItem>
      );
    }
    return (
      <SidebarMenuItem key={session.id}>
        <SidebarMenuButton
          asChild
          tooltip={session.title}
          isActive={pathname === "/chat" && activeChatId === session.id}
          className="pr-7 text-[11px]"
        >
          <Link to="/chat" search={{ c: session.id }} onClick={closeSidebar}>
            {session.pinned ? (
              <Pin className="h-3.5 w-3.5 shrink-0 fill-quon-indigo text-quon-indigo" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-quon-muted" />
            )}
            <span className="truncate">{session.title}</span>
          </Link>
        </SidebarMenuButton>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuAction aria-label={t("nav.chatOptions")}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </SidebarMenuAction>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" className="w-40">
            <DropdownMenuItem onSelect={() => startRename(session.id, session.title)}>
              <Pencil className="h-3.5 w-3.5" /> {t("nav.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => togglePinChatSession(session.id)}>
              {session.pinned ? (
                <>
                  <PinOff className="h-3.5 w-3.5" /> {t("nav.unpin")}
                </>
              ) : (
                <>
                  <Pin className="h-3.5 w-3.5" /> {t("nav.pin")}
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-3.5 w-3.5" /> {t("nav.moveToProject")}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                {projects.length === 0 ? (
                  <DropdownMenuItem disabled>{t("nav.noProjectsYet")}</DropdownMenuItem>
                ) : (
                  projects.map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      disabled={session.projectId === p.id}
                      onSelect={() => setChatProject(session.id, p.id)}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: colorHex(p.color) }}
                      />
                      <span className="truncate">{p.name}</span>
                    </DropdownMenuItem>
                  ))
                )}
                {session.projectId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setChatProject(session.id, undefined)}>
                      {t("nav.removeFromProject")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => setTimeout(() => setDeleteId(session.id), 0)}
              className="text-red-400 focus:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" /> {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  // One search result: session title (project dot when it belongs to one) plus
  // the matching message snippets, matches marked. Clicking opens the chat via
  // the same `/chat?c=<id>` link the recents use.
  function renderSearchHit(hit: ChatSearchHit) {
    const project = projects.find((p) => p.id === hit.projectId);
    return (
      <SidebarMenuItem key={hit.sessionId}>
        <Link
          to="/chat"
          search={{ c: hit.sessionId }}
          onClick={closeSidebar}
          className="flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-[11px] hover:bg-quon-surface-2"
        >
          <span className="flex items-center gap-1.5 text-quon-text">
            {project ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: colorHex(project.color) }}
              />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-quon-muted" />
            )}
            <span className="truncate font-medium">
              <MarkedText text={hit.title} highlights={hit.titleHighlights} />
            </span>
          </span>
          {hit.snippets.map((snip) => (
            <span key={snip.messageId} className="truncate pl-3.5 text-quon-muted">
              <span className="text-quon-muted/70">{snip.role === "user" ? "You: " : "AI: "}</span>
              <MarkedText text={snip.snippet} highlights={snip.highlights} />
            </span>
          ))}
        </Link>
      </SidebarMenuItem>
    );
  }

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Logo size="md" className="group-data-[collapsible=icon]:hidden" />
            <LogoMark className="hidden group-data-[collapsible=icon]:flex" />
            <span className="group-data-[collapsible=icon]:hidden">
              <ProtectionPill />
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          {/* Main nav */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {[...navItems, ...(isAdmin ? [adminItem] : [])].map((item) => {
                  const title = t(item.titleKey);
                  return item.disabled ? (
                    <SidebarMenuItem key={item.titleKey}>
                      <SidebarMenuButton
                        disabled
                        tooltip={t("nav.comingSoonTooltip", { title })}
                        className="cursor-not-allowed opacity-50"
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{title}</span>
                        <span className="ml-auto rounded-sm bg-quon-surface-2 px-1 text-[8px] font-semibold uppercase tracking-wide text-quon-muted group-data-[collapsible=icon]:hidden">
                          {t("nav.soon")}
                        </span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ) : (
                    <SidebarMenuItem key={item.titleKey}>
                      <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={title}>
                        <Link to={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Chat search — filters titles + message contents, all client-side */}
          <SidebarGroup className="py-0 group-data-[collapsible=icon]:hidden">
            <SidebarGroupContent className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-quon-muted" />
              <SidebarInput
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") clearSearch();
                }}
                placeholder={t("nav.searchChats")}
                aria-label={t("nav.searchChats")}
                className="pr-7 pl-7 text-[11px]"
              />
              {searchInput && (
                <button
                  onClick={clearSearch}
                  aria-label={t("nav.clearSearch")}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5 text-quon-muted hover:bg-quon-surface-2 hover:text-quon-text"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Search results — replace the project groups + Recents while active */}
          {searching && (
            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel>{t("nav.results")}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {searchHits.length === 0 ? (
                    <li className="px-2 py-1 text-[11px] text-quon-muted">{t("nav.noMatches")}</li>
                  ) : (
                    searchHits.map(renderSearchHit)
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}

          {/* Project groups — collapsed by default, expandable; each
              collapsible-icon-hidden, like Recents */}
          {!searching &&
            groups.map(({ project, chats }) => {
              const isExpanded = expandedProjects.has(project.id);
              return (
                <SidebarGroup key={project.id} className="group-data-[collapsible=icon]:hidden">
                  <SidebarGroupLabel className="group/proj flex items-center justify-between gap-1 pr-0">
                    {/* Chevron toggles the chat list; the name still links to the
                        project page. Two distinct targets so collapsing chats and
                        opening the project don't fight over one click. */}
                    <div className="flex min-w-0 flex-1 items-center gap-0.5">
                      <button
                        onClick={() => toggleProject(project.id)}
                        aria-expanded={isExpanded}
                        aria-label={
                          isExpanded
                            ? t("nav.collapseProject", { name: project.name })
                            : t("nav.expandProject", { name: project.name })
                        }
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-quon-muted hover:bg-quon-surface-2 hover:text-quon-text"
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                        />
                      </button>
                      <Link
                        to="/projects"
                        search={{ id: project.id }}
                        onClick={closeSidebar}
                        className="flex min-w-0 flex-1 items-center gap-1.5 hover:text-quon-text"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: colorHex(project.color) }}
                        />
                        <span className="truncate">{project.name}</span>
                        {!isExpanded && chats.length > 0 && (
                          <span className="shrink-0 pl-1 text-[10px] tabular-nums text-quon-muted">
                            {chats.length}
                          </span>
                        )}
                      </Link>
                    </div>
                    {/* Quick "new chat in this project". Always visible (but subtle,
                        opacity-60) so it isn't a hover-only affordance a user could
                        miss — full opacity on hover/focus. Mobile gets the same
                        ≥32px tap target around the tiny icon. */}
                    <button
                      onClick={() => newChatInProject(project.id)}
                      aria-label={t("nav.newChatInProject", { name: project.name })}
                      title={t("nav.newChatInProject", { name: project.name })}
                      className={
                        isMobile
                          ? "flex h-8 w-8 shrink-0 items-center justify-center rounded text-quon-muted hover:bg-quon-surface-2 hover:text-quon-text"
                          : "shrink-0 rounded p-1 text-quon-muted opacity-60 transition-opacity hover:bg-quon-surface-2 hover:text-quon-text hover:opacity-100 focus-visible:opacity-100"
                      }
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </SidebarGroupLabel>
                  {isExpanded && (
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {chats.length === 0 ? (
                          <li className="px-2 py-1 text-[11px] text-quon-muted">
                            {t("nav.noChatsYet")}
                          </li>
                        ) : (
                          chats.map(renderSession)
                        )}
                      </SidebarMenu>
                    </SidebarGroupContent>
                  )}
                </SidebarGroup>
              );
            })}

          {/* Recents (global / ungrouped chats) */}
          {!searching && (
            <SidebarGroup className="group-data-[collapsible=icon]:hidden">
              <SidebarGroupLabel className="flex items-center justify-between pr-1">
                <span>{t("nav.recents")}</span>
                <button
                  onClick={newChat}
                  title={t("nav.newChat")}
                  className="rounded p-0.5 text-quon-muted hover:bg-quon-surface-2 hover:text-quon-text"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {ungrouped.length === 0 ? (
                    <li className="px-2 py-1 text-[11px] text-quon-muted">
                      {t("nav.noRecentChatsYet")}
                    </li>
                  ) : (
                    ungrouped.map(renderSession)
                  )}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive("/settings")}
                tooltip={t("nav.settings")}
              >
                <Link to="/settings">
                  <SettingsIcon className="h-4 w-4" />
                  <span>{t("nav.settings")}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {FEATURES.feedback && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setFeedbackOpen(true)}
                  tooltip={t("feedback.title")}
                >
                  <MessagesSquare className="h-4 w-4" />
                  <span>{t("feedback.navLabel")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => void logout()} tooltip={t("nav.signOut")}>
                <LogOut className="h-4 w-4" />
                <span>{t("nav.signOut")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("nav.deleteChatTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("nav.deleteChatDesc", { title: deletingSession?.title ?? t("nav.thisChat") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId) deleteChatSession(deleteId);
                setDeleteId(null);
              }}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </>
  );
}
