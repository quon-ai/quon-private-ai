import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowUp,
  Brain,
  ChevronDown,
  FileText,
  Fingerprint,
  FolderKanban,
  Lock,
  MessageSquare,
  Shield,
  ShieldCheck,
  ShieldOff,
  X,
} from "lucide-react";

import { disableBiometric, enrollBiometric, useAuth } from "@/lib/authStore";
import {
  bioLooksBroken,
  bioOfferDismissed,
  clearBioFailures,
  dismissBioOffer,
  getBioMarker,
} from "@/lib/bioEnrollment";
import { authApi } from "@/lib/api/authApi";
import { runDailyBriefing } from "@/lib/briefing/dailyBriefing";
import { BriefingCard } from "./BriefingCard";
import { FEATURES } from "@/lib/features";
import { useDocuments } from "@/lib/documentStore";
import { useT } from "@/lib/i18n/i18n";
import { useMemory } from "@/lib/memoryStore";
import { PROJECT_COLOR_HEX, useProjects } from "@/lib/projectStore";
import { setPendingChatMessage } from "@/lib/pendingChatMessage";
import { isProtected, useChatHistory, useQuonState } from "@/lib/quonStore";
import { Notice } from "./Notice";
import { ProtectionSlider, protectionLevelMeta } from "./ProtectionSlider";
import {
  BioCancelledError,
  BioPrfUnavailableError,
  platformAuthenticatorAvailable,
} from "@/lib/webauthnBio";

/**
 * Dashboard = "your private starting point", not a feature tour: ONE primary
 * CTA, a compact protection row (full slider + the live "N items kept
 * private" trust signal behind "Change"), real counts for the private data
 * areas, and recent chats. The former marketing block ("Why QUON") and the
 * sidebar-duplicating feature cards are gone on purpose — onboarding carries
 * the value story, the sidebar/tab bar carries navigation.
 */
export function ScreenDashboard() {
  const { t } = useT();
  const history = useChatHistory();
  const memories = useMemory();
  const docs = useDocuments();
  const projects = useProjects();

  // On-open briefing: generate today's "what's new" once per day (device-local,
  // free, on-device — dailyBriefing.ts). Runs after the stores have hydrated;
  // memories/docs in the deps re-run it once real data has loaded on first open.
  useEffect(() => {
    if (FEATURES.briefing) runDailyBriefing();
  }, [memories.length, docs.length]);

  // Most recent chat by actual recency (history is pinned-first).
  const lastChat = [...history].sort((a, b) => b.updatedAt - a.updatedAt)[0];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5 md:px-8 md:py-8">
      <div className="mx-auto w-full max-w-2xl">
        {/* Primary CTA — the first thing you do here is ASK, not navigate. */}
        <StartComposer />
        {lastChat ? (
          <Link
            to="/chat"
            search={{ c: lastChat.id }}
            className="mt-2 block truncate text-center text-xs text-quon-muted transition hover:text-quon-text"
          >
            {t("nav.continueChat", { title: lastChat.title })}
          </Link>
        ) : (
          <p className="mt-2 text-center text-[11px] text-quon-muted">{t("nav.firstChatHint")}</p>
        )}

        {FEATURES.briefing && <BriefingCard />}

        <BiometricOfferCard />
        <BioRepairCard />

        <ProtectionRow />

        <PrivateDataCluster
          memories={memories.length}
          docs={docs.length}
          projects={projects.length}
        />

        <RecentChats />
      </div>
    </div>
  );
}

/** One-time proactive offer to turn on biometric unlock — the natural place to
 *  "ask every user", since it can't happen at the pending-registration step (no
 *  session/Master Key yet). Shows once per user per device (bioOfferDismissed)
 *  when a platform authenticator exists and the device isn't already enrolled;
 *  "Not now" and a successful enroll both dismiss it for good. Enrolling here is
 *  the exact Settings flow (enrollBiometric — two prompts on iOS, honest PRF
 *  failure), so no logic is duplicated. */
function BiometricOfferCard() {
  const { t } = useT();
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (getBioMarker(user.id) != null || bioOfferDismissed(user.id)) return;
    let cancelled = false;
    void platformAuthenticatorAvailable().then((ok) => {
      if (!cancelled && ok) setShow(true);
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user || !show) return null;

  function dismiss() {
    if (user) dismissBioOffer(user.id);
    setShow(false);
  }

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await enrollBiometric();
      if (user) dismissBioOffer(user.id);
      setDone(true);
    } catch (e) {
      if (e instanceof BioCancelledError) {
        /* dismissed the platform prompt — leave the card so they can retry */
      } else if (e instanceof BioPrfUnavailableError) {
        // Best-effort: an OS passkey may have been created; don't leave a half state.
        void disableBiometric().catch(() => {});
        if (user) dismissBioOffer(user.id);
        setError(t("nav.bioPrfUnavailable"));
      } else {
        setError(t("nav.bioGenericError"));
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-5">
        <Notice variant="success">{t("nav.bioEnabledNotice")}</Notice>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-quon-indigo/30 bg-quon-surface p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo">
          <Fingerprint className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-quon-text">{t("nav.bioOfferTitle")}</div>
          <p className="mt-1 text-[11px] leading-snug text-quon-muted md:text-xs">
            {t("nav.bioOfferBody")}
          </p>
          {error && <p className="mt-2 text-[11px] text-quon-yellow">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={enable}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-2 text-xs font-semibold text-white transition hover:bg-quon-indigo-hover disabled:opacity-40"
            >
              <Fingerprint className="h-3.5 w-3.5" />{" "}
              {busy ? t("nav.bioSettingUp") : t("common.enable")}
            </button>
            <button
              onClick={dismiss}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-xs font-medium text-quon-muted transition hover:text-quon-text disabled:opacity-40"
            >
              {t("nav.notNow")}
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label={t("nav.dismiss")}
          className="shrink-0 rounded-md p-1 text-quon-muted transition hover:bg-quon-surface-2 hover:text-quon-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Shown after the lost-passkey streak (see bioEnrollment.ts): the device is
 *  enrolled, but the last attempts all failed — on the reporting Pixel an
 *  Android update had deleted the OS passkey while our marker and the server
 *  wrap survived, so unlock dead-ended with the OS's "no passkey" sheet. The
 *  user has just unlocked with their password (the MK is present), which is
 *  exactly the moment a fresh enrollment is possible. Enrollment runs FIRST
 *  and the old server row is deleted only after success — so if the passkey
 *  actually still works (the streak was two genuine cancels) and the user
 *  bails out of the prompt, nothing has been destroyed. */
function BioRepairCard() {
  const { t } = useT();
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (user) setShow(bioLooksBroken(user.id));
  }, [user]);

  if (!user || !show) return null;

  function dismiss() {
    // Ends the streak: the card returns only if unlock fails repeatedly again.
    if (user) clearBioFailures(user.id);
    setShow(false);
  }

  async function recreate() {
    if (!user) return;
    setBusy(true);
    setError(null);
    const oldId = getBioMarker(user.id)?.credentialId ?? null;
    try {
      await enrollBiometric(); // new credential + new server wrap + new marker
      const newId = getBioMarker(user.id)?.credentialId;
      if (oldId && oldId !== newId) {
        // Best-effort hygiene: drop the orphaned wrap of the lost credential.
        await authApi.bioDelete(oldId).catch(() => {});
      }
      clearBioFailures(user.id);
      setDone(true);
    } catch (e) {
      if (e instanceof BioCancelledError) {
        /* dismissed the platform prompt — leave the card so they can retry */
      } else if (e instanceof BioPrfUnavailableError) {
        setError(t("nav.bioPrfUnavailable"));
      } else {
        setError(t("nav.bioGenericError"));
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-5">
        <Notice variant="success">{t("nav.bioRepairedNotice")}</Notice>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-xl border border-quon-yellow/30 bg-quon-surface p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-quon-yellow/15 text-quon-yellow">
          <Fingerprint className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-quon-text">{t("nav.bioRepairTitle")}</div>
          <p className="mt-1 text-[11px] leading-snug text-quon-muted md:text-xs">
            {t("nav.bioRepairBody")}
          </p>
          {error && <p className="mt-2 text-[11px] text-quon-yellow">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={recreate}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-2 text-xs font-semibold text-white transition hover:bg-quon-indigo-hover disabled:opacity-40"
            >
              <Fingerprint className="h-3.5 w-3.5" />{" "}
              {busy ? t("nav.bioSettingUp") : t("nav.bioRepairAction")}
            </button>
            <button
              onClick={dismiss}
              disabled={busy}
              className="rounded-lg px-3 py-2 text-xs font-medium text-quon-muted transition hover:text-quon-text disabled:opacity-40"
            >
              {t("nav.notNow")}
            </button>
          </div>
        </div>
        <button
          onClick={dismiss}
          aria-label={t("nav.dismiss")}
          className="shrink-0 rounded-md p-1 text-quon-muted transition hover:bg-quon-surface-2 hover:text-quon-text"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Compact protection row: current level as a pill + one-line description.
 *  "Change" expands the full slider plus the live trust signal (how many
 *  personal items the filter has kept private so far). */
function ProtectionRow() {
  const { t, plural } = useT();
  const { protectionLevel, redactedTotal } = useQuonState();
  const level = protectionLevelMeta(protectionLevel, t);
  const [open, setOpen] = useState(false);

  const protectedNow = isProtected(protectionLevel);
  // Zero is always explained (nothing sent yet ≠ nothing caught), and "off"
  // never reads like success.
  const status = !protectedNow
    ? {
        icon: ShieldOff,
        tone: "text-quon-yellow",
        text: t("nav.protectionOff"),
      }
    : redactedTotal > 0
      ? {
          icon: ShieldCheck,
          tone: "text-quon-green",
          text: plural(redactedTotal, {
            one: "nav.itemsKeptPrivateOne",
            other: "nav.itemsKeptPrivateOther",
          }),
        }
      : {
          icon: ShieldCheck,
          tone: "text-quon-green",
          text: t("nav.nothingFilteredYet"),
        };

  return (
    <div className="mt-5 rounded-xl border border-quon-border bg-quon-surface p-4">
      <div className="flex items-center gap-2">
        <Shield
          className="h-4 w-4 shrink-0"
          style={{ color: level.color, filter: `drop-shadow(0 0 6px ${level.color}80)` }}
        />
        <span className="text-xs font-semibold text-quon-text md:text-sm">
          {t("nav.protectionLevelLabel")}
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: level.color, borderColor: `${level.color}66` }}
        >
          {level.short}
        </span>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-quon-border px-2.5 py-1 text-[11px] font-semibold text-quon-text transition hover:border-quon-indigo/50"
        >
          {t("nav.change")}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {!open && (
        <p className="mt-2 text-[10px] leading-snug text-quon-muted md:text-xs">{level.desc}</p>
      )}
      {open && (
        <>
          <div className="mt-4">
            <ProtectionSlider />
          </div>
          <div className="mt-3 flex items-start gap-1.5 border-t border-quon-border pt-3">
            <status.icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${status.tone}`} />
            <p className="text-[11px] leading-snug text-quon-text">{status.text}</p>
          </div>
        </>
      )}
    </div>
  );
}

/** Real counts for the three private-data areas — same links the sidebar has,
 *  but carrying information instead of duplicating navigation. */
function PrivateDataCluster({
  memories,
  docs,
  projects,
}: {
  memories: number;
  docs: number;
  projects: number;
}) {
  const { t, plural } = useT();
  const tiles = [
    {
      icon: Brain,
      count: memories,
      label: plural(memories, {
        one: "nav.memoryCountLabelOne",
        other: "nav.memoryCountLabelOther",
      }),
      url: "/memory",
    },
    {
      icon: FileText,
      count: docs,
      label: plural(docs, {
        one: "nav.documentCountLabelOne",
        other: "nav.documentCountLabelOther",
      }),
      url: "/documents",
    },
    {
      icon: FolderKanban,
      count: projects,
      label: plural(projects, {
        one: "nav.projectCountLabelOne",
        other: "nav.projectCountLabelOther",
      }),
      url: "/projects",
    },
  ];
  const empty = memories + docs + projects === 0;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-quon-muted">
          {t("nav.yourPrivateData")}
        </h2>
        <span className="flex items-center gap-1 rounded-full border border-quon-border px-2 py-0.5 text-[9px] font-medium text-quon-muted">
          <Lock className="h-2.5 w-2.5" /> {t("nav.endToEndEncrypted")}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 md:gap-3">
        {tiles.map((tile) => (
          <Link
            key={tile.url}
            to={tile.url}
            className="rounded-xl border border-quon-border bg-quon-surface p-3 transition hover:border-quon-indigo/50 md:p-4"
          >
            <tile.icon className="h-4 w-4 text-quon-indigo" />
            <div className="mt-2 text-lg font-semibold leading-none text-quon-text md:text-xl">
              {tile.count}
            </div>
            <div className="mt-1 text-[10px] text-quon-muted md:text-xs">{tile.label}</div>
          </Link>
        ))}
      </div>
      {empty && <p className="mt-2 text-[10px] text-quon-muted">{t("nav.privateDataEmpty")}</p>}
    </div>
  );
}

/** The last few chats — real activity instead of marketing tiles. Hidden
 *  entirely while there are no chats (the CTA above carries the empty state). */
function RecentChats() {
  const { t } = useT();
  const history = useChatHistory();
  const projects = useProjects();
  const recent = [...history].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
  if (recent.length === 0) return null;

  return (
    <div className="mt-5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-quon-muted">
        {t("nav.recentChats")}
      </h2>
      <div className="mt-2 space-y-1.5">
        {recent.map((s) => {
          const project = s.projectId ? projects.find((p) => p.id === s.projectId) : undefined;
          return (
            <Link
              key={s.id}
              to="/chat"
              search={{ c: s.id }}
              className="flex items-center gap-2 rounded-lg border border-quon-border bg-quon-surface px-3 py-2 text-xs text-quon-text transition hover:border-quon-indigo/50"
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-quon-muted" />
              <span className="truncate">{s.title}</span>
              {project && (
                <span
                  className="ml-auto h-2 w-2 shrink-0 rounded-full"
                  title={project.name}
                  style={{ background: PROJECT_COLOR_HEX[project.color ?? "indigo"] }}
                />
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** The dashboard's primary action: type the question here, land in the chat with
 *  it already sent. Replaces the old "Start Chat" button — the button made the
 *  user pay a navigation before they could say anything.
 *
 *  The text is handed over in memory (pendingChatMessage.ts), never as a `?q=`
 *  search param: an auto-sending URL would let a crafted link put words in the
 *  user's chat, spend their AI budget and leave the answer in their history.
 *
 *  Scrubbing is untouched — the message travels the ordinary send() path in
 *  ScreenChat, including fail-closed. Disabled while empty, exactly like the
 *  chat composer's own Send: there is nothing to hand over, and an opening
 *  "blank chat" is one click away in the nav. */
function StartComposer() {
  const { t } = useT();
  const navigate = useNavigate();
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPendingChatMessage(trimmed);
    setText("");
    void navigate({ to: "/chat" });
  }

  return (
    <div className="flex items-end gap-2 rounded-xl border border-quon-border bg-quon-surface p-2 focus-within:border-quon-indigo/60">
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const el = e.target;
          el.style.height = "auto";
          el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={1}
        placeholder={t("nav.askPlaceholder")}
        aria-label={t("nav.askPlaceholder")}
        className="max-h-40 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-quon-text outline-none placeholder:text-quon-muted"
      />
      <button
        onClick={submit}
        disabled={!text.trim()}
        aria-label={t("nav.askSend")}
        className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-quon-indigo text-white transition hover:bg-quon-indigo-hover glow-indigo disabled:opacity-40"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  );
}
