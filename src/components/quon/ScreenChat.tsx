import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isImageFile } from "@/lib/documents/isImageFile";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  AlertTriangle,
  Archive,
  ArrowUp,
  Bot,
  Brain,
  Camera,
  ChevronDown,
  FileText,
  Files,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Lock,
  MessageSquare,
  Paperclip,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  X,
  Globe,
} from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RedactionDetail } from "./EntitySidebar";
import { InfoHint } from "./InfoHint";
import { detectArtifacts, unwrapMarkdownArtifacts } from "@/lib/artifacts/detect";
import { ArtifactCard } from "./ArtifactCard";
import { SourcesStrip } from "./SourcesStrip";
import { DictationButton } from "./DictationButton";
import { Markdown } from "./Markdown";
import { Notice } from "./Notice";
import { buildSentText, ReviewPanel, type ReviewItem } from "./ReviewPanel";
import { useQuonHealth } from "@/hooks/useQuonHealth";
import {
  applyPlaceholders,
  CHAT_MODELS,
  chatStream,
  QuonError,
  resumeChatStream,
  StreamGoneError,
  getModels,
  getUsage,
  isUnauthorizedError,
  QUON_ENABLED,
  scrubText,
  type ChatModel,
  type ChatTurn,
  type Entity,
  type StreamToolCall,
  type WebSource,
} from "@/lib/quonApi";
import { SCRUB_CONCURRENCY, scrubLarge, splitForScrub } from "@/lib/scrubChunked";
import {
  formatElapsed,
  interpolateScrubFraction,
  isStalled,
  scrubWaveTotal,
  shouldRevealProgress,
  estimateSmallScrubFraction,
} from "@/lib/scrubProgressEta";
import {
  findManualSelection,
  resolveDurableRedaction,
  type DurableRedactMatch,
  type ManualRedactError,
} from "@/lib/manualRedact";
import { occursIn } from "@/lib/redactSpans";
import { takePendingChatMessage } from "@/lib/pendingChatMessage";
import {
  getChatToolDefs,
  isAlwaysAllowed,
  mergeScrubbedResult,
  QUON_TOOL_SERVER_ID,
  refreshFirstPartyToolDefs,
  rememberAlwaysAllow,
  warmChatTools,
} from "@/lib/mcp/chatTools";
import { callTool, parseToolName } from "@/lib/mcp/client";
import { callQuonTool, parseQuonToolName, toolProvenance } from "@/lib/tools/firstParty";
import { paperlessConnector } from "@/lib/connectors/paperless";
import { RemoteDocPicker } from "./RemoteDocPicker";
import { getExplicitNewChatTs } from "@/lib/chatNav";
import { withNeverRedacted } from "@/lib/documents/detectionPreview";
import {
  getQuonState,
  createChatSessionId,
  getChatSession,
  isProtected,
  isReviewed,
  quon,
  type ProtectionLevel,
  type ReasoningEffort,
  saveChatSession,
  useChatHistory,
  useQuonState,
} from "@/lib/quonStore";
import {
  addDocumentRedactTerm,
  collectRedactTerms,
  getDocument,
  getDocumentText,
  useDocuments,
  type DocItem,
} from "@/lib/documentStore";
import { combineDocuments } from "@/lib/attachAll";
import { useThrottledValue } from "@/lib/useThrottledValue";
import { diagAppend } from "@/lib/diagLog";
import { DocumentPicker } from "./DocumentPicker";
import { DocumentViewer, type AdhocDocument } from "./DocumentViewer";
import {
  adhocSourceFor,
  keepUploadBytes,
  mergeRedactTerms,
  previewSourceFor,
} from "@/lib/attachmentPreview";
import { PhotoScanDialog } from "./PhotoScanDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/i18n";
import type { I18n } from "@/lib/i18n/i18n";
import type { MessageKey } from "@/lib/i18n/catalog";
import { humanizeToolName, summarizeToolArgs } from "@/lib/toolDisplay";
import { lookupTitle } from "@/lib/tools/titleCache";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useMemory } from "@/lib/memoryStore";
import { warmEmbedder } from "@/lib/embedding/embedder";
import { ensureEmbeddingsCurrent } from "@/lib/reembed";
import {
  hasInjectableContext,
  hasScopedContext,
  inScope,
  pinnedDocContext,
  retrieveContext,
  type RagSource,
} from "@/lib/rag";
import { abortRun, beginRun, endRun, getRun, isGenerating } from "@/lib/chatRunner";
import { toRelayHistory, withTurnContext } from "@/lib/relayHistory";
import { correctedModelId } from "@/lib/modelSelection";
import { chatModelDisplay, showProviderTag } from "@/lib/modelDisplay";
import { storeGeneratedImage, type GeneratedImageRef } from "@/lib/chat/generatedImages";
import { GeneratedImageStrip } from "./GeneratedImageStrip";
import { classifyStreamError } from "@/lib/streamError";
import { isTransportFailure, whenVisible } from "@/lib/streamResume";
import { getProject } from "@/lib/projectStore";
import { applyProjectChatSeed, resolveProjectChatSeed } from "@/lib/projectChatDefaults";
import { rehydrationEntities } from "@/lib/chatPersist";
import { entityStyle } from "@/lib/quonEntityStyles";
import { buildUnfilteredResend } from "@/lib/unfilteredResend";
import {
  advanceOnboardingFromCallout,
  advanceOnboardingFromIntro,
  skipToOnboardingTeaser,
} from "@/lib/onboardingStore";
import { OnboardingCallout } from "./OnboardingCallout";
import { OnboardingTeaserCard } from "./OnboardingTeaserCard";

/** Context block preamble prepended (as a system turn) when RAG context is injected. */
const RAG_PREAMBLE =
  "Use the following context from the user's saved memory to answer when relevant. " +
  "Keep any [PLACEHOLDER] tokens exactly as written.";

/** Preamble for the project instruction system turn (precedes any RAG context). */
const INSTRUCTION_PREAMBLE =
  "Follow these project instructions for this conversation. Keep any [PLACEHOLDER] " +
  "tokens exactly as written.";

/** Preamble for a document attached to a single message. */
const ATTACHMENT_PREAMBLE =
  "The user attached a document to the message that follows — their most recent one. " +
  "It may be a different document from any attached earlier in this conversation; use " +
  "THIS one to answer when relevant. Keep any [PLACEHOLDER] tokens exactly as written.";

/** Cap injected attachment text so prompts stay within the model context window.
 *  200k is safe because scrubLarge always splits >12k into parallel 8k pieces
 *  (each far below the backend's per-request max_text_length), the relay's
 *  ChatTurn has no length cap, the answer is streamed SSE (no Cloudflare 100s
 *  buffer risk), and 200k chars ~ 50-60k tokens - inside every catalog model's
 *  context window. Anything smaller shortens real multi-document attachments. */
const ATTACHMENT_CHAR_BUDGET = 200_000;

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/** Await-safe wrapper for a parallel wave: a rejection becomes a value, so a
 *  source that fails while its siblings are still in flight can't surface as an
 *  unhandled rejection - and the caller still decides per source whether to
 *  degrade silently (context, instruction) or fail closed (attachment, message). */
function settled<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

type RagThread = {
  context: string;
  sources: RagSource[];
  entities?: Entity[];
};

/** What QUON's filter removed from one tool result before it re-entered the
 *  relay. Grouped per call (in call order) rather than summed, because the
 *  question a user actually has is "what did it take out of that document" -
 *  a single total across seven Paperless reads answers nobody. `tool` is the
 *  already-localized friendly name, matching the "..." marker in the answer.*/
type ToolRedaction = { tool: string; entities: Entity[] };

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  /** user: the original text typed; assistant: the reply */
  text: string;
  /** user only: what was actually sent to the provider */
  scrubbed?: string;
  entities?: Entity[];
  fallbackMode?: boolean;
  /** user only: why the AI enrichment was skipped (when fallbackMode) */
  skipReason?: string | null;
  /** user only: input had no case signal - NER names were deferred to the LLM */
  lowCaseSignal?: boolean;
  /** user only: false if the message left the device unprotected */
  protected?: boolean;
  /** user only: sent via "Resend without filter" - /scrub was skipped for this one
   *  turn (see unfilteredResend.ts). Distinct from `protected: false`, which also
   *  covers protection level "None" for the whole chat - this is a one-shot,
   *  per-message bypass and must render its own chip, never the same one. */
  unfiltered?: boolean;
  /** assistant only: true if this bubble is a provider error */
  isError?: boolean;
  /** assistant only: true when the stream was cut off mid-answer (network drop,
   *  backend restart...) - `text`/`rawText` keep the partial answer that had
   *  already arrived rather than being replaced by an error string; the bubble
   *  renders a small trailing note and still offers Retry. Mutually exclusive
   *  with `isError` (a message that got zero tokens still becomes a plain error
   *  bubble). Optional so older persisted chats (before this field existed) load
   *  unchanged. */
  streamInterrupted?: boolean;
  /** assistant only: the raw answer with placeholders, before re-hydration */
  rawText?: string;
  /** assistant only: friendly label of the model that produced this answer
   *  (e.g. "Claude Sonnet"), captured at send time. Shown as a small footer so
   *  the user can tell which model replied - and a restored chat keeps the
   *  label of the model that actually answered, even if the picker has since
   *  changed. Absent on old chats / the intro bubble. */
  model?: string;
  /** assistant only: the model's streamed reasoning ("thinking"), re-hydrated -
   *  shown in a collapsible panel. Absent for non-reasoning models / old chats. */
  reasoning?: string;
  /** assistant only: pictures the model generated - references only; the
   *  bytes live in the sealed local store / the originals sync collection
   *  (chat/generatedImages.ts), never in this synced chat blob. */
  images?: GeneratedImageRef[];
  /** assistant only: indices of detected artifacts the user dismissed ("I don't
   *  want this in my documents"). Artifacts are re-DETECTED from the answer text
   *  on every render, so a dismissal has to be remembered on the message itself
   *  (persists + syncs with the chat) - local component state would resurrect the
   *  card on reload. */
  dismissedArtifacts?: number[];
  /** assistant only: web pages the model cited (web search on). Shown as a
   *  "Sources" strip under the answer. Absent when the model didn't search. */
  sources?: WebSource[];
  /** assistant only: per-tool-call record of what the filter stripped from tool
   *  RESULTS during this turn. Tool results are scrubbed exactly like a typed
   *  message (fail-closed), but until this existed the redaction was invisible:
   *  the user bubble's pill only ever summed the TYPED turn plus its
   *  attachment/RAG/instruction, so a chat that pulled seven Paperless documents
   *  through the filter still reported "no personal data found" - true of the
   *  four words typed, and badly misleading about the exchange.
   *  Persisted (and walked by rebuildRefs) because it is also the only record of
   *  those placeholder->value pairs: without it a restored chat re-sends the
   *  assistant's `rawText` and the follow-up answer comes back with bare
   *  [PERSON_7] tokens nothing can re-hydrate. */
  toolRedactions?: ToolRedaction[];
  /** user only: Memory/Document context retrieved + injected for this turn (RAG). */
  rag?: RagThread;
  /** user only: Context was ON and there was in-scope Memory/Documents, retrieval
   *  ran, but nothing cleared the relevance gate - so no context was injected.
   *  Drives an honest "nothing matched" note (the absence signal that would have
   *  told the income-bug user their memory simply wasn't used). Distinct from the
   *  chip's absence, which also covers "context off" / "no saved data". */
  contextEmpty?: boolean;
  /** user only: project instruction injected for this turn (scrubbed under protection). */
  instruction?: { text: string; entities?: Entity[] };
  /** user only: a document attached to this message (scrubbed under protection). */
  attachment?: {
    name: string;
    text: string;
    entities?: Entity[];
    truncated?: boolean;
    /** True when several documents were combined via "Attach all documents". */
    combined?: boolean;
  };
}

const COMPOSER_MAX_LINES = 5;

/** The opening assistant bubble of a fresh chat. */
function getIntroMessage(t: I18n["t"]): ChatMessage {
  return { id: 0, role: "assistant", text: t("chat.introMessage") };
}

// Onboarding step 0 (guided-doing, see onboardingStore.ts): a second assistant
// turn inviting a real message with a name + email, so the first redaction the
// user sees is their own - not a canned example. Rendered inline below (not a
// module-level ChatMessage, since its text needs the live translator) with a
// synthetic id of -1 - reserved (never issued by nextMessageId, which starts
// at 1) so it never collides with a real message. Purely additive: the
// composer stays fully usable, nothing is required.

// Monotonic, module-level message-id counter. Must be globally unique and never reset
// or go backward: message ids are React keys and the target of streamed setMessages
// updates, so a reused id across chats/navigation makes one bubble's reply overwrite
// another's (the "all answers show the last answer" bug). Restoring a chat only ever
// bumps this forward past the restored max, never reuses.
let nextMessageId = 1;

// Reasoning-effort choices for the composer picker. "off" omits the reasoning param
// (provider default); the rest map to OpenRouter's unified `reasoning.effort`. Non-
// reasoning models ignore it, so the picker is always shown. A function (not a
// module constant) because the labels/hints need the live translator.
function getReasoningOptions(
  t: I18n["t"],
): { value: ReasoningEffort; label: string; hint: string }[] {
  return [
    { value: "off", label: t("chat.reasoningOff"), hint: t("chat.reasoningOffHint") },
    { value: "low", label: t("chat.reasoningLow"), hint: t("chat.reasoningLowHint") },
    { value: "medium", label: t("chat.reasoningMedium"), hint: t("chat.reasoningMediumHint") },
    { value: "high", label: t("chat.reasoningHigh"), hint: t("chat.reasoningHighHint") },
  ];
}

// Included-AI-budget hint: when the account's capped OpenRouter budget is this
// far gone, a dismissible one-liner appears above the composer (checked once per
// chat mount; the backend caches the lookup). Dismissal is per browser session -
// the hint returns next session, not on every render/navigation.
const BUDGET_HINT_THRESHOLD = 0.8;
const BUDGET_HINT_DISMISSED_KEY = "quon-budget-hint-dismissed";

// The pipeline phase behind the "waiting" bubble. "" = not loading / no phase set
// yet. Kept as a stable key (not the translated label text) so the icon/tone
// selection below never has to pattern-match on locale-dependent strings.
type LoadingPhase = "" | "scrubbing" | "searching" | "generating";

// Progress of the send-path scrub WAVE (attachment pieces + rag/instruction/
// message - see scrubWaveTotal in scrubProgressEta.ts). `done`/`total`/
// `updatedAt` describe the whole wave (drives the bar + %, so it moves as
// soon as any unit finishes); `attachDone`/`attachTotal`/`attachUpdatedAt`
// describe the attachment pieces alone (drives the ETA - attachment pieces
// are the dominant, representative cost of a long wait; the fast rag/
// instruction/message units would otherwise skew an early rate estimate
// wildly optimistic). `startedAt` anchors both to the same clock origin.
// All timestamps use performance.now().
interface ScrubWaveState {
  done: number;
  total: number;
  updatedAt: number;
  attachDone: number;
  attachTotal: number;
  attachUpdatedAt: number;
  startedAt: number;
  /** Already-localized attachment label ("10 documents" / "All documents (12
   *  files)") - names the scale of what's being protected in the shimmer line. */
  attachmentLabel: string;
  /** Total attachment characters - drives the small-scrub time estimate. */
  attachChars: number;
  /** Set once a piece has failed and is being retried. A stalled piece was
   *  otherwise invisible: the per-request timeout is 180s and there are 3
   *  attempts, so one bad piece stalls a send ~9 minutes behind nothing but a
   *  ticking clock - reported as "hangs with no error". */
  retry?: { attempt: number; attempts: number };
}

// The "waiting" bubble. QUON already sets a meaningful phase for each pipeline
// step (scrubbing PII, searching memory, generating the reply), so we map the
// phase to a matching icon instead of a generic spinner - the wait narrates
// what's happening (and highlights the privacy step). The label text shimmers
// (.quon-shimmer in styles.css) so it reads as working, not stalled.
//
// When a multi-part attachment scrub is in flight (feedback: a 200k-char / 10
// document attachment takes 50-60s - a bare "(7/25)" fraction read as "no
// indicator"), this also renders a live percentage + ETA that keep moving
// between the sparse real onProgress ticks (scrubProgressEta.ts), so the bar
// never looks stalled during a burst gap.
function LoadingIndicator({
  phase,
  progress,
  t,
}: {
  phase: LoadingPhase;
  progress: ScrubWaveState | null;
  t: I18n["t"];
}) {
  // Ticks while a wave is tracked so the interpolated fraction/ETA visibly
  // advance between real onProgress events, not just when React re-renders
  // for some other reason. Cleared whenever there's nothing to animate.
  const [now, setNow] = useState(() => performance.now());
  const trackingWave = phase === "scrubbing" && progress !== null;
  useEffect(() => {
    if (!trackingWave) return;
    setNow(performance.now());
    const id = window.setInterval(() => setNow(performance.now()), 200);
    return () => window.clearInterval(id);
  }, [trackingWave]);

  // Belt and braces on monotonicity. The maths is designed not to reverse, but
  // the wave mixes attachment pieces with the fast message/rag/instruction units,
  // and those land unevenly - so a computed dip is conceivable. A bar that goes
  // backward is the single worst thing this indicator can do (it reads as a bug
  // and destroys trust in the number), so clamp to the high-water mark.
  const maxPercent = useRef(0);
  useEffect(() => {
    maxPercent.current = 0; // a new wave starts fresh
  }, [progress?.startedAt]);

  let Icon = MessageSquare; // generating the reply (default / final phase)
  let tone = "text-quon-indigo";
  let label = t("chat.loadingGenerating");
  let fraction: number | null = null;
  if (phase === "scrubbing") {
    Icon = ShieldCheck; // scrubbing PII - the trust moment
    tone = "text-quon-green";
    if (progress) {
      label = t("chat.loadingScrubbingAttachment", { name: progress.attachmentLabel });
      // Small scrubs (<=SCRUB_CONCURRENCY pieces) land in one burst - there is
      // no intermediate truth to interpolate, and the interpolator's percent
      // here would be fabrication (a bar that sits at "97%" for half a minute
      // with nothing behind it). The size-based estimate is honest about being
      // an estimate: driven by the real char count and a measured throughput
      // floor, ~95% at the expected duration, capped at 97, and never below
      // the real piece ticks. Big scrubs keep the tick-driven interpolation -
      // there the ticks are the truth.
      fraction =
        progress.attachTotal > SCRUB_CONCURRENCY
          ? interpolateScrubFraction(
              progress.startedAt,
              { done: progress.done, total: progress.total, updatedAt: progress.updatedAt },
              now,
              SCRUB_CONCURRENCY,
            )
          : estimateSmallScrubFraction(
              progress.startedAt,
              now,
              progress.attachChars,
              progress.attachDone,
              progress.attachTotal,
            );
    } else {
      label = t("chat.loadingScrubbing");
    }
  } else if (phase === "searching") {
    Icon = Sparkles; // retrieving RAG context
    label = t("chat.loadingSearching");
  }
  // Cap at 99 until the scrub genuinely finishes: the bar's ceiling is
  // total-0.02, which rounds to 100% and claimed completion while a piece was
  // still outstanding.
  let percent =
    fraction === null ? null : fraction >= 1 ? 100 : Math.min(99, Math.round(fraction * 100));
  if (percent !== null) {
    percent = Math.max(percent, maxPercent.current);
    maxPercent.current = percent;
  }
  // A bar that flashes up and vanishes is worse than no bar - and this is what
  // keeps the indicator correct at any scrubber speed: point /scrub at a faster
  // endpoint and a quick scrub simply never renders one.
  const revealed = progress !== null && shouldRevealProgress(progress.startedAt, now);
  // "Hangs with no error" was the report. A retry is the strongest signal; a long
  // gap with no confirmed unit is the earlier one (the first failure is not even
  // reported for 180s, the per-request timeout).
  const stallNote = !progress
    ? null
    : progress.retry
      ? t("chat.loadingScrubbingRetry", {
          attempt: progress.retry.attempt,
          attempts: progress.retry.attempts,
        })
      : isStalled(progress.updatedAt, now)
        ? t("chat.loadingScrubbingSlow")
        : null;

  return (
    <div className="flex justify-start">
      <div className="flex flex-col gap-1.5 rounded-2xl rounded-bl-sm border border-quon-border bg-quon-surface px-3.5 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 shrink-0 animate-pulse ${tone}`} />
          <span className="quon-shimmer">{label}</span>
        </div>
        {phase === "scrubbing" && progress && percent !== null && revealed && (
          <div
            className="flex flex-col gap-1"
            title={t("chat.loadingScrubbingCount", { done: progress.done, total: progress.total })}
          >
            {/* A percentage is only shown when there is real granularity to
                back it - more than one WAVE of pieces, not merely more than one
                piece. Pieces land SCRUB_CONCURRENCY at a time, so a <=6-piece
                scrub is a single burst with no intermediate truth, and the
                interpolated percent is fabrication: a real 2-piece send sat at
                "97%" from second 10 to second 36 ((1 + 0.95 creep) / 2), which
                discredits every number this bar ever shows. Indeterminate pulse
                + the elapsed clock is what we actually know there.*/}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-quon-surface-2">
              <div
                className="h-full rounded-full bg-quon-green transition-[width] duration-200 ease-linear"
                style={{ width: `${Math.max(2, percent)}%` }}
              />
            </div>
            {stallNote && (
              <div className="flex items-start gap-1.5 text-[11px] leading-snug text-quon-yellow">
                <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                <span>{stallNote}</span>
              </div>
            )}
            <div className="flex items-center justify-between text-xs tabular-nums text-quon-muted">
              <span>{`${percent}%`}</span>
              <span>
                {/* Elapsed, not remaining. A predicted duration wandered in both
                    directions on every tuning we tried - see formatElapsed. */}
                {t("chat.loadingScrubbingElapsed", {
                  time: formatElapsed(now - progress.startedAt),
                })}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Friendly display name for a tool: a proper label for the known first-party
 *  tools, else the humanized id (`import_dropbox_document` -> "Import dropbox
 *  document") so the consent card never shows raw function-name plumbing. */
const KNOWN_TOOL_NAME_KEY: Record<string, MessageKey> = {
  create_agent: "chat.tool.create_agent",
  import_dropbox_document: "chat.tool.import_dropbox_document",
  search_dropbox: "chat.tool.search_dropbox",
  search_documents: "chat.tool.search_documents",
  save_memory: "chat.tool.save_memory",
  save_document: "chat.tool.save_document",
  search_paperless: "chat.tool.search_paperless",
  read_paperless_document: "chat.tool.read_paperless_document",
  import_paperless_document: "chat.tool.import_paperless_document",
  read_url: "chat.tool.read_url",
  pick_folder: "chat.tool.pick_folder",
  list_folder_files: "chat.tool.list_folder_files",
  read_folder_file: "chat.tool.read_folder_file",
  import_folder_file: "chat.tool.import_folder_file",
  create_folders: "chat.tool.create_folders",
  move_folder_items: "chat.tool.move_folder_items",
  write_folder_file: "chat.tool.write_folder_file",
  search_mail: "chat.tool.search_mail",
  read_mail: "chat.tool.read_mail",
  import_mail: "chat.tool.import_mail",
};
function friendlyToolName(tool: string, t: I18n["t"]): string {
  const key = KNOWN_TOOL_NAME_KEY[tool];
  return key ? t(key) : humanizeToolName(tool);
}

/** One tool call awaiting user consent (arguments shown re-hydrated). */
interface ToolConsentItem {
  id: string;
  serverId: string;
  tool: string;
  argsDisplay: string;
  /** First-party write tool (save_memory/save_document/...): per-action consent
   *  only - the dialog hides "always allow" and shows the content prominently. */
  write?: boolean;
}

export function ScreenChat() {
  const { t } = useT();
  const navigate = useNavigate();
  const { c: sessionParam, p: projectParam } = useSearch({ from: "/chat" });
  const {
    protectionLevel,
    activeModelId,
    reasoningEffort,
    useMemoryContext,
    alwaysRedact,
    neverRedact,
    disabledEntityTypes,
    webSearchEnabled,
    onboardingStep,
    paperlessConnection,
  } = useQuonState();
  // Subscribe to the history store: it hydrates asynchronously (the at-rest
  // encrypted cache opens only once the unlock key exists), so session lookups
  // below must re-run when it lands.
  const chatHistory = useChatHistory();
  // Retrieval scope for the chat currently shown: an existing chat uses its own
  // project; a fresh chat uses the ?p= param. undefined = the global pool. RAG,
  // the Context pill and the instruction all read this so a project chat only ever
  // sees its own knowledge (and a global chat only global knowledge).
  const shownSession = sessionParam ? getChatSession(sessionParam) : undefined;
  const scope: string | undefined = sessionParam
    ? (shownSession?.projectId ?? undefined)
    : (projectParam ?? undefined);
  // Reactive presence of in-scope Memory/Documents (drives the Context toggle).
  const memItems = useMemory();
  const inCurrentScope = inScope(scope);
  // Ready documents visible to this chat (same scoping as the DocumentPicker):
  // a project chat sees its project's docs, a global chat the whole pool. Drives
  // the "Attach all" option for compare-everything prompts.
  const readyDocs = useDocuments().filter(
    (d) => d.status === "ready" && (scope ? d.projectId === scope : true),
  );
  // Context toggle appears when there's any injectable context: in-scope memory,
  // OR a pinned document (pinned docs are auto-context; unpinned docs are attached
  // explicitly via the paperclip, so they don't drive the toggle).
  const hasContextData = memItems.some(inCurrentScope) || readyDocs.some((d) => d.pinned);
  const [models, setModels] = useState<ChatModel[]>(CHAT_MODELS);
  // Whether the real catalog (getModels) has loaded. Until then `models` is the
  // bundled CHAT_MODELS placeholder, whose ids ("openai/gpt-4o") differ from the
  // catalog's connection-scoped ids ("openrouter::openai/gpt-4o"). The
  // invalid-model reset below must not run against the placeholder, or it would
  // clobber a restored/valid selection with the default on every reload.
  const [modelsLoaded, setModelsLoaded] = useState(false);
  // The catalog fetch has FINISHED (either way). Distinct from modelsLoaded so the
  // dashboard handoff below knows the difference between "still loading" and
  // "offline, the real catalog will never arrive".
  const [modelsSettled, setModelsSettled] = useState(false);
  // Composer draft survives a reload/crash: the native webview restarts and
  // wipes in-progress text otherwise. sessionStorage: per-tab, cleared when
  // the tab truly closes, no sync, no cross-account bleed (cleared on logout
  // with the rest of sessionStorage). Written on change (a crash never fires
  // unload handlers, so write-on-change is the only reliable timing); cleared
  // by the ordinary send/reset paths via setInput("").
  const [input, setInputRaw] = useState<string>(() => {
    try {
      return sessionStorage.getItem("quon_draft_v1") ?? "";
    } catch {
      return "";
    }
  });
  const setInput = useCallback((v: string | ((prev: string) => string)) => {
    setInputRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      try {
        if (next) sessionStorage.setItem("quon_draft_v1", next);
        else sessionStorage.removeItem("quon_draft_v1");
      } catch {
        /* private mode / quota - draft just doesn't survive, as before */
      }
      return next;
    });
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [getIntroMessage(t)]);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>("");
  // Progress of the send-path scrub wave. A 50-60 s attachment scrub needs a
  // visible signal, and a fraction alone is too weak. null while there's no
  // multi-piece attachment scrub (total > 1) - small scrubs finish before a
  // bar helps.
  const [scrubProgress, setScrubProgress] = useState<ScrubWaveState | null>(null);
  // Default to the re-hydrated / original view so answers read naturally.
  const [showOriginal, setShowOriginal] = useState(true);
  const [sendError, setSendError] = useState<string | null>(null);
  // Info-tone counterpart to sendError: something the user must know before
  // an action can work (e.g. the mic in the installed iPhone app). Cleared
  // exactly like the error line.
  const [sendHint, setSendHint] = useState<string | null>(null);
  // "~N% of your included AI budget is used" hint above the composer (null = hidden).
  const [budgetHintPct, setBudgetHintPct] = useState<number | null>(null);
  // Id of the assistant bubble currently streaming. While set, that bubble renders
  // plain text (no per-token Markdown re-parse); it switches to Markdown when done.
  const [streamingId, setStreamingId] = useState<number | null>(null);
  // A document attached to the next message (extracted text, before scrubbing).
  // `source: "paperless"` marks an EPHEMERAL live-source attachment (fetched on
  // demand, never stored in QUON) - drives the honesty label on the chip.
  const [attachment, setAttachment] = useState<{
    name: string;
    text: string;
    truncated?: boolean;
    combined?: boolean;
    source?: "paperless";
    /** Library DocItem ids behind this attachment. Absent for ad-hoc uploads
     *  and Paperless - durable per-document redactions only exist for library
     *  documents, and the ids are what lets the send merge their saved terms. */
    docIds?: string[];
    /** Fresh upload only: mime + the file's bytes, kept so "Prüfen & schwärzen"
     *  can render the real PDF/DOCX pages before the send - a fresh upload
     *  has no DocItem and no cached original to fall back on. Only formats
     *  the viewer renders from bytes are kept (keepUploadBytes). */
    mime?: string;
    bytes?: Uint8Array;
    /** Per-send hand-redactions made in the preview of an AD-HOC attachment
     *  (fresh upload / Paperless / combined). Merged into this send's enforced
     *  `always_redact` - verified by scrubText - and remembered nowhere. */
    redactTerms?: string[];
  } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // The staged attachment opened in the real viewer ("Prüfen & schwärzen" on
  // the chip, "Original ansehen & schwärzen" in Review): a library document
  // opens as itself, anything else as an ad-hoc source (attachmentPreview.ts).
  const [reviewViewerDoc, setReviewViewerDoc] = useState<DocItem | null>(null);
  const [previewAdhoc, setPreviewAdhoc] = useState<AdhocDocument | null>(null);
  const [paperlessPickerOpen, setPaperlessPickerOpen] = useState(false);
  // Whether Paperless is configured (gates the paperclip entry). Reactive via
  // the store, not read-once: the connection lives in the synced prefs blob,
  // which hydrates asynchronously after a full page load - a read-once at
  // mount races that hydration and hides the entry until the next remount.
  // It is a plain store field, and useQuonState is already subscribed above.
  const paperlessConfigured = Boolean(paperlessConnection?.baseUrl && paperlessConnection.token);
  // Photo waiting in the scan-review dialog (paperclip -> "Scan a photo").
  // Photos waiting for the OCR review dialog. Several screenshots are the
  // normal case ("hier sind drei Belege"), so they are reviewed one after the
  // other and staged as one attachment at the end. `total` drives the "Foto 2
  // von 5" chip; it resets once the queue drains.
  const [scanQueue, setScanQueue] = useState<{ files: File[]; total: number }>({
    files: [],
    total: 0,
  });
  /** Reviewed transcripts of the current batch, combined when the queue empties. */
  const scanned = useRef<{ name: string; text: string }[]>([]);
  /** "Take all": the rest of the batch is accepted without a review stop. */
  const [autoAcceptScans, setAutoAcceptScans] = useState(false);
  // Per-chat reasoning override: null = use the global default (quon.reasoningEffort).
  // Ephemeral (never persisted) and reset when the shown chat changes - a deliberate
  // per-message knob, not a stored setting. Effective effort = override ?? default.
  const [chatEffortOverride, setChatEffortOverride] = useState<ReasoningEffort | null>(null);
  // Per-chat protection/model overrides, seeded from a project's chat defaults
  // (see projectChatDefaults.ts). null = use the global default (quonStore's
  // protectionLevel/activeModelId, same as Settings/dashboard). An override,
  // not a write to quon.setProtectionLevel/setActiveModel: that would silently
  // flip the Global protection level (and model) for every other chat,
  // Settings and the dashboard. Same ephemeral/reset-on-chat-switch treatment
  // as chatEffortOverride above. Effective value = override ?? global (see
  // effectiveProtectionLevel / effectiveModelId below); a non-project chat
  // never gets an override, so it keeps writing the global store (see
  // setProtection/setModel).
  const [chatProtectionOverride, setChatProtectionOverride] = useState<ProtectionLevel | null>(
    null,
  );
  const [chatModelOverride, setChatModelOverride] = useState<string | null>(null);
  const [chatDisabledTypesOverride, setChatDisabledTypesOverride] = useState<string[] | null>(null);
  // What this chat actually behaves as - the per-chat override, if any, else the
  // global default. Every read of "the protection level" / "the model" below
  // must go through these, never the raw `protectionLevel`/`activeModelId` from
  // the global store, so a project chat's seed is visible without ever having
  // been written into that global store.
  const effectiveProtectionLevel = chatProtectionOverride ?? protectionLevel;
  const effectiveModelId = chatModelOverride ?? activeModelId;
  const effectiveDisabledTypes = chatDisabledTypesOverride ?? disabledEntityTypes;
  const reviewBeforeSend = isReviewed(effectiveProtectionLevel);
  const filterActive = isProtected(effectiveProtectionLevel);
  // Change the protection level / model for this chat: while an override is
  // active (a project chat past its seed), edits stay local to the override;
  // otherwise (no override - the pre-existing behavior for a non-project chat)
  // they write the global store exactly as before.
  function setProtection(level: ProtectionLevel) {
    if (chatProtectionOverride != null) setChatProtectionOverride(level);
    else quon.setProtectionLevel(level);
  }
  function setModel(id: string) {
    if (chatModelOverride != null) setChatModelOverride(id);
    else quon.setActiveModel(id);
  }
  const attachInputRef = useRef<HTMLInputElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  // Separate input with `capture` so mobile opens the camera straight away
  // (scanInputRef stays capture-free for picking an existing gallery photo).
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Cancel an in-flight send: a flag so the scrub->send chain bails before committing
  // (the stream abort goes through the chatRunner registry, keyed by session, so it
  // survives navigation). inFlightOriginal restores the prompt to the box on stop.
  const cancelledRef = useRef(false);
  const inFlightOriginal = useRef("");
  // Conversation-wide state for placeholder re-hydration.
  const globalCounts = useRef<Record<string, number>>({});
  const rehydration = useRef<Record<string, string>>({});
  const { status, health } = useQuonHealth();
  // EU routing (strict): OpenRouter refuses the web-search plugin on the EU
  // domain, so the toggle is hidden and a send never asks for it. Read from
  // the health poll the app already runs (retried every 30 s) - a separate
  // timed fetch left the toggle in place on a slow runner.
  const webSearchAvailable = health?.web_search_available !== false;
  const [pendingReview, setPendingReview] = useState<{
    original: string;
    base: string;
    items: ReviewItem[];
    fallbackMode: boolean;
    skipReason?: string | null;
    lowCaseSignal?: boolean;
    // Reviewable context sources: the scrubbed base text plus per-hit items the
    // user can un-redact, mirroring the typed-message `items` above.
    rag?: { base: string; sources: RagSource[]; items: ReviewItem[] };
    /** Retrieval ran but matched nothing (mirrors ChatMessage.contextEmpty) -
     *  carried through review so the sent message keeps the honest signal. */
    contextEmpty?: boolean;
    attachment?: {
      name: string;
      base: string;
      truncated?: boolean;
      combined?: boolean;
      items: ReviewItem[];
      /** Library doc ids - durable redaction saves to these; absent (ad-hoc
       *  upload / Paperless) hides the "Immer schwärzen" action entirely. */
      docIds?: string[];
    };
    instruction?: ChatMessage["instruction"];
  } | null>(null);

  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  // Onboarding step 0: only on a genuinely fresh, never-sent chat (a session is
  // only ever persisted once it has more than the intro bubble - see the save
  // effect below - so a restored chat always has length >= 2 here).
  const showOnboardingIntro = onboardingStep === 0 && messages.length === 1;
  // Step 1's callout points at the badge for the message that just taught the
  // lesson - the first one with something actually redacted, not necessarily
  // literally the latest message (a quick empty/whitespace send wouldn't count
  // since send() no-ops on blank input).
  const showOnboardingCallout =
    onboardingStep === 1 &&
    !!lastUserMsg &&
    (lastUserMsg.entities?.length ?? 0) +
      (lastUserMsg.attachment?.entities?.length ?? 0) +
      (lastUserMsg.rag?.entities?.length ?? 0) +
      (lastUserMsg.instruction?.entities?.length ?? 0) >
      0;
  // Stable so memoized UserBubbles don't all re-render on every streamed token
  // (the redaction detail's original<->anonymized toggle is global, as before).
  const toggleShowOriginal = useCallback(() => setShowOriginal((v) => !v), []);
  // Whether the review panel is showing at all - flips only on open/close, not on
  // every in-panel edit (toggle / manual redaction), so those edits don't retrigger
  // the auto-scroll effect and yank the view.
  const reviewOpen = pendingReview != null;
  const selectedModel = models.find((m) => m.id === effectiveModelId);
  const modelLabel = selectedModel ? chatModelDisplay(selectedModel).name : effectiveModelId;
  // The session currently shown. `null` = a fresh chat not yet persisted.
  const activeIdRef = useRef<string | null>(null);
  // Session id from the URL we could not find in the (possibly still-decrypting)
  // history - remembered so the fallback "new chat" reset runs only once per id.
  const missingIdRef = useRef<string | null>(null);
  // Auto-scroll: keep the latest message in view as the conversation grows and
  // while an answer streams in - unless the user has scrolled up to read history.
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  function onConversationScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // "Near the bottom" tolerates a small gap so streaming jitter still sticks.
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  // Re-number a message's placeholders to be unique across the whole conversation
  // and record placeholder -> original value, so the answer can be re-hydrated.
  /** The one /scrub option set every send-path call shares (on-device redaction
   *  lists + the effective per-scope type policy). */
  function scrubOptions() {
    return {
      placeholder_style: "indexed" as const,
      always_redact: alwaysRedact,
      never_redact: neverRedact,
      disabled_types: effectiveDisabledTypes,
    };
  }

  function reindex(scrubbed: string, entities: Entity[]) {
    const localToGlobal: Record<string, string> = {};
    const reindexed = entities.map((entity) => {
      const label = entity.placeholder.match(/^\[([A-Z]+)_\d+\]$/)?.[1] ?? "PII";
      globalCounts.current[label] = (globalCounts.current[label] ?? 0) + 1;
      const global = `[${label}_${globalCounts.current[label]}]`;
      localToGlobal[entity.placeholder] = global;
      return { ...entity, placeholder: global };
    });
    return { scrubbed: applyPlaceholders(scrubbed, localToGlobal), entities: reindexed };
  }

  // Record placeholder -> original for re-hydration (only items kept redacted).
  function commitRehydration(items: ReviewItem[]) {
    for (const it of items) if (it.active) rehydration.current[it.placeholder] = it.value;
  }

  // Present a context source's scrubbed entities (attachment / RAG) as reviewable
  // items - kept redacted by default, so Review mode can un-redact individual hits
  // exactly like it does for the typed message.
  function entitiesToItems(entities: Entity[] = []): ReviewItem[] {
    return entities.map((e) => ({
      placeholder: e.placeholder,
      value: e.value,
      type: e.type,
      confidence: e.confidence,
      active: true,
      isManual: false,
    }));
  }

  // The still-redacted items of a reviewed context source, back as Entity[] for
  // storage + re-hydration. Un-redacted (active:false) hits are dropped: their
  // placeholder is gone from the sent text, so it must never re-hydrate.
  function activeEntities(items: ReviewItem[] = []): Entity[] {
    return items
      .filter((i) => i.active)
      .map((i) => ({
        type: i.type,
        value: i.value,
        placeholder: i.placeholder,
        confidence: i.confidence ?? 1,
      }));
  }

  // Retrieve relevant Memory/Document context for a query and (when protection is
  // on) scrub it so only placeholders leave the device. Best-effort: any failure
  // returns no context rather than blocking the message.
  /** Retrieval only - everything this does is on-device, so it decides what the
   *  context scrub will send without spending a round trip. */
  async function prepareRag(
    query: string,
  ): Promise<{ combined: string; sources: RagThread["sources"] } | undefined> {
    // Context = pinned documents (always) + relevance-retrieved memory. Gated by
    // the Context toggle; runs if either source has something in scope.
    if (!useMemoryContext || !hasInjectableContext(scope)) return undefined;
    // Pinned docs first (the user's explicit "always use this"), then memory.
    const pinned = pinnedDocContext(scope);
    let memText = "";
    let sources = [...pinned.sources];
    if (hasScopedContext(scope)) {
      try {
        const retrieved = await retrieveContext(query, scope);
        memText = retrieved.text;
        sources = [...pinned.sources, ...retrieved.sources];
      } catch {
        /* memory retrieval failed - pinned docs may still carry context */
      }
    }
    const combined = [pinned.text, memText].filter(Boolean).join("\n\n");
    return combined ? { combined, sources } : undefined;
  }

  async function buildRag(query: string, protect: boolean): Promise<RagThread | undefined> {
    const prep = await prepareRag(query);
    if (!prep) return undefined;
    if (!protect) return { context: prep.combined, sources: prep.sources };
    let ctx;
    try {
      ctx = await scrubText(prep.combined, scrubOptions());
    } catch {
      return undefined; // can't scrub the context -> don't send it
    }
    const ri = reindex(ctx.scrubbed, ctx.entities);
    return { context: ri.scrubbed, sources: prep.sources, entities: ri.entities };
  }

  // Resolve the active project's instruction and (when protection is on) scrub it
  // through the same path as RAG context, so only placeholders leave the device.
  // Fail closed: if it can't be scrubbed, inject nothing. Empty/no project -> none.
  function projectInstruction(): string | undefined {
    return scope ? getProject(scope)?.instructions?.trim() || undefined : undefined;
  }

  async function buildInstruction(protect: boolean): Promise<ChatMessage["instruction"]> {
    const raw = projectInstruction();
    if (!raw) return undefined;
    if (!protect) return { text: raw };
    let ctx;
    try {
      ctx = await scrubText(raw, scrubOptions());
    } catch {
      return undefined;
    }
    const ri = reindex(ctx.scrubbed, ctx.entities);
    return { text: ri.scrubbed, entities: ri.entities };
  }

  // Extract a picked file's text on-device (lazy-loads the heavy extractor) and
  // stage it as the next message's attachment. Truncated to a char budget.
  async function handleAttach(file: File) {
    setSendError(null);
    setAttaching(true);
    try {
      const { extractText } = await import("@/lib/documents/extract");
      const { text } = await extractText(file);
      const clean = text.trim();
      if (!clean) throw new Error(t("chat.errorNoReadableText"));
      const truncated = clean.length > ATTACHMENT_CHAR_BUDGET;
      const bytes = keepUploadBytes(file.type, file.name, file.size)
        ? new Uint8Array(await file.arrayBuffer())
        : undefined;
      setAttachment({
        name: file.name,
        text: clean.slice(0, ATTACHMENT_CHAR_BUDGET),
        truncated,
        mime: file.type,
        bytes,
      });
    } catch (err) {
      setAttachment(null);
      setSendError(err instanceof Error ? err.message : t("chat.errorCouldntReadFile"));
    } finally {
      setAttaching(false);
    }
  }

  /** Queue the picked photos for the OCR review dialog (camera or gallery). */
  function enqueueScans(files: FileList | null) {
    const picked = Array.from(files ?? []);
    if (!picked.length) return;
    setSendError(null);
    setAutoAcceptScans(false); // a fresh pick always starts with review
    setScanQueue((q) => ({ files: [...q.files, ...picked], total: q.total + picked.length }));
  }

  /** Move to the next photo; the batch is staged once the queue drains. */
  function advanceScan() {
    setScanQueue((q) => {
      const files = q.files.slice(1);
      return { files, total: files.length ? q.total : 0 };
    });
  }

  // The batch is finished: turn whatever survived review into one attachment.
  // Several screenshots share the budget through the same water-filling as a
  // multi-document pick, so the message stays one turn - and walks the
  // identical scrub-before-send path.
  useEffect(() => {
    if (scanQueue.files.length > 0) return;
    setAutoAcceptScans(false);
    const parts = scanned.current;
    if (!parts.length) return;
    scanned.current = [];
    if (parts.length === 1) {
      const clean = parts[0].text;
      setAttachment({
        name: parts[0].name,
        text: clean.slice(0, ATTACHMENT_CHAR_BUDGET),
        truncated: clean.length > ATTACHMENT_CHAR_BUDGET,
      });
      return;
    }
    const { text, truncated } = combineDocuments(parts, ATTACHMENT_CHAR_BUDGET);
    setAttachment({
      name: t("chat.selectedDocumentsCombined", { count: parts.length }),
      text,
      truncated,
      combined: true,
    });
    // `t` excluded on purpose: a language switch mid-batch is not worth
    // re-running this for, and including it would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanQueue.files.length]);

  // Stage already-indexed documents (from the Documents store) as the next
  // message's attachment - same path as a fresh upload, just no extraction needed.
  // Several picked at once are combined under one shared budget, exactly like
  // "attach all documents"; from here on a single doc and a batch are the same thing.
  function stageDocuments(
    picked: DocItem[],
    emptyError: string,
    combinedLabel: (count: number) => string,
  ) {
    setSendError(null);
    const docs = picked
      .map((d) => ({ id: d.id, name: d.filename, text: getDocumentText(d).trim() }))
      .filter((d) => d.text.length > 0);
    if (docs.length === 0) {
      setSendError(emptyError);
      return;
    }
    // A single document keeps its plain text (no "=== Document: ... ===" header) -
    // combining is only meaningful once there is more than one file to separate.
    if (docs.length === 1) {
      const clean = docs[0].text;
      setAttachment({
        name: docs[0].name,
        text: clean.slice(0, ATTACHMENT_CHAR_BUDGET),
        truncated: clean.length > ATTACHMENT_CHAR_BUDGET,
        docIds: [docs[0].id],
      });
      return;
    }
    const { text, truncated } = combineDocuments(docs, ATTACHMENT_CHAR_BUDGET);
    setAttachment({
      name: combinedLabel(docs.length),
      text,
      truncated,
      combined: true,
      docIds: docs.map((d) => d.id),
    });
  }

  function handleAttachFromDocs(docs: DocItem[]) {
    stageDocuments(docs, t("chat.errorNoReadableTextInDoc"), (count) =>
      t("chat.selectedDocumentsCombined", { count }),
    );
  }

  // Stage all in-scope ready documents as one combined attachment (e.g. "compare
  // these offers").
  function handleAttachAllDocs() {
    stageDocuments(readyDocs, t("chat.errorNoReadableDocs"), (count) =>
      t("chat.allDocumentsCombined", { count }),
    );
  }

  // Resolve the staged attachment and (when protection is on) scrub it through the
  // same path as RAG/instruction, so only placeholders leave the device. THROWS on
  // scrub failure so send() fails closed (the user explicitly attached it).
  async function buildAttachment(protect: boolean): Promise<ChatMessage["attachment"]> {
    if (!attachment) return undefined;
    const { name, text, truncated, combined } = attachment;
    if (!protect) return { name, text, truncated, combined };
    // Large attachments (esp. "attach all documents" / comparing several
    // contracts) are split and scrubbed as PARALLEL, short /scrub requests, then
    // merged value-aware - a single long /scrub over the whole blob would run the
    // backend's cloud-LLM chunks in one request and tip over Cloudflare's ~100s
    // edge timeout -> the send failing closed. See scrubChunked.ts. Fail-closed is
    // preserved (any piece failing throws -> send() aborts).
    const ctx = await scrubLarge(text, scrubOptions());
    const ri = reindex(ctx.scrubbed, ctx.entities);
    return { name, text: ri.scrubbed, entities: ri.entities, truncated, combined };
  }

  // Load the configured model list from the backend; fall back to the bundled list.
  useEffect(() => {
    let cancelled = false;
    getModels()
      .then((list) => {
        if (!cancelled && list.length) {
          setModels(list);
          setModelsLoaded(true);
        }
        if (!cancelled) setModelsSettled(true);
      })
      .catch(() => {
        /* keep the bundled CHAT_MODELS; leave modelsLoaded false so the
           invalid-model reset below never runs against the placeholder list */
        if (!cancelled) setModelsSettled(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One budget check per chat mount (no polling; the backend caches ~5 min):
  // surface the hint when the included AI budget is >=80% used. Silently shows
  // nothing when the account isn't provisioned (self-host / BYOK), the fetch
  // fails, or the hint was dismissed this session.
  useEffect(() => {
    if (sessionStorage.getItem(BUDGET_HINT_DISMISSED_KEY)) return;
    let cancelled = false;
    getUsage()
      .then((u) => {
        if (cancelled || !u.provisioned || !u.limit_usd) return;
        const frac = (u.usage_usd ?? 0) / u.limit_usd;
        if (frac >= BUDGET_HINT_THRESHOLD) setBudgetHintPct(Math.round(frac * 100));
      })
      .catch(() => {
        /* no hint on failure - never block or clutter the chat */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep a valid model selected: if this chat's effective id isn't an enabled
  // option (e.g. a legacy pre-connection id, or its provider key was removed),
  // pick the first enabled model so the picker is never stuck on an unusable
  // choice. Goes through setModel so it corrects the override (a project's
  // default model disabled after the fact) rather than the global default.
  useEffect(() => {
    // Only judge validity against the real catalog - never the bundled
    // placeholder (see modelsLoaded), else a reload clobbers the saved model.
    // Pure decision extracted to lib/modelSelection for direct unit testing.
    const next = correctedModelId(modelsLoaded, models, effectiveModelId);
    if (!next) return;
    // This is a CORRECTION (invalid id -> first valid), not a user choice: use the
    // non-bumping path so it doesn't out-timestamp the real choice arriving from
    // the server's E2E prefs blob on a fresh device.
    if (chatModelOverride != null) setChatModelOverride(next);
    else quon.correctActiveModel(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, effectiveModelId, modelsLoaded]);

  // Warm the on-device embedder when context injection is usable, so the first
  // retrieval on send doesn't pay the model-load cost; re-embed any items left
  // over from a previous embedding model so they become retrievable.
  useEffect(() => {
    if (useMemoryContext && hasContextData) {
      warmEmbedder();
      void ensureEmbeddingsCurrent();
    }
  }, [useMemoryContext, hasContextData]);

  // Prime the MCP tool cache off the send path, so a send is a synchronous
  // cache hit (no /mcp/servers round-trip between the outgoing scrub and relay).
  // Also pre-warm the on-device embedder when in-scope memory exists: retrieval
  // Will need it on the first send, and paying the WASM init inside sendMessage
  // (esp. WebKit, single-threaded) added seconds between Send and the bubble.
  useEffect(() => {
    if (QUON_ENABLED) warmChatTools();
    if (useMemoryContext && hasScopedContext(scope)) warmEmbedder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resizeComposer() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const maxHeight = lineHeight * COMPOSER_MAX_LINES;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  useEffect(() => {
    resizeComposer();
  }, [input]);

  // Follow the conversation: scroll to the newest content whenever messages
  // change (new turn, streamed token) or the review panel first appears - but
  // only while the user is anchored to the bottom (see onConversationScroll).
  // Keyed on `reviewOpen` (not the pendingReview object) so redacting/toggling
  // inside the panel doesn't scroll the view.
  useEffect(() => {
    if (stickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, loading, loadingPhase, reviewOpen]);

  // Rebuild the conversation-wide re-hydration map and placeholder counters from
  // a restored set of messages so old chats render correctly and new turns keep
  // unique placeholder numbers.
  function rebuildRefs(msgs: ChatMessage[]) {
    globalCounts.current = {};
    rehydration.current = {};
    let maxId = 0;
    const register = (e: Entity) => {
      rehydration.current[e.placeholder] = e.value;
      const match = e.placeholder.match(/^\[([A-Z]+)_(\d+)\]$/);
      if (match) {
        const [, label, num] = match;
        globalCounts.current[label] = Math.max(globalCounts.current[label] ?? 0, Number(num));
      }
    };
    for (const m of msgs) if (m.id > maxId) maxId = m.id;
    // Which fields carry placeholders lives in chatPersist.ts, next to the
    // projection that has to keep them - see rehydrationEntities.
    for (const e of rehydrationEntities(msgs)) register(e);
    nextMessageId = Math.max(nextMessageId, maxId + 1);
  }

  function startNewChat() {
    rebuildRefs([]);
    setMessages([getIntroMessage(t)]);
    setPendingReview(null);
    setSendError(null);
    setLoading(false);
    setLoadingPhase("");
  }

  // React to the active session in the URL: load an existing chat, or reset to a
  // fresh one. The ref guard skips the self-navigation we trigger after creating
  // a session on the first message (so a live stream is never clobbered).
  // `chatHistory` is a dependency because the store hydrates asynchronously (the
  // encrypted cache opens only after unlock): a session that isn't found yet may
  // simply not have decrypted - don't latch, retry when the history lands.
  // finalizeSend's self-navigation (?c=<new id>) races the chatHistory emit from
  // saveChatSession: the store emit re-renders before the router propagates the new
  // URL, so the session effect fires once more with the STALE pre-send URL (no ?c=).
  // Treating that tick as "New chat" nulls activeIdRef and resets the messages - the
  // freshly appended assistant bubble is wiped, the restore that follows loads the
  // pre-reply snapshot, and the streamed answer maps onto an array that no longer
  // contains it: it silently disappears (the vanishing-answer bug). finalizeSend
  // marks the in-flight self-navigation here; the effect skips exactly that stale
  // tick. The marker expires fast so a genuine "+" press can never be suppressed.
  const pendingSelfNavRef = useRef<{ id: string; ts: number } | null>(null);

  useEffect(() => {
    const target = sessionParam ?? null;
    const pending = pendingSelfNavRef.current;
    if (pending) {
      // The user pressed "+" after this send's self-navigation was issued: the
      // no-?c= tick is then a real new chat, not the stale pre-send tick - and
      // if the self-nav's ?c= commit still lands afterwards (the router can
      // commit it seconds late under load), it must be treated as stale and
      // healed back to /chat instead of restoring the old session under the
      // user's feet (the "second message lands in the first chat" entanglement,
      // proven via trace in chat-runner.spec.ts:53).
      const explicitNewChat = getExplicitNewChatTs() > pending.ts;
      if (target === pending.id && explicitNewChat) {
        pendingSelfNavRef.current = null;
        navigate({ to: "/chat", search: {}, replace: true });
        return;
      }
      if (target === pending.id || Date.now() - pending.ts > 2000) {
        pendingSelfNavRef.current = null; // landed (or expired) - normal handling below
      } else if (!target && activeIdRef.current === pending.id && !explicitNewChat) {
        return; // stale pre-send tick - the ?c= navigation lands on the next run
      } else if (!target && explicitNewChat) {
        // Keep the marker ARMED (the late ?c= commit may still arrive and must
        // be recognized above) and fall through to the new-chat reset below.
      } else {
        pendingSelfNavRef.current = null; // navigated somewhere else - marker is moot
      }
    }
    if (target === activeIdRef.current) return;
    if (target) {
      const session = getChatSession(target);
      if (session && session.messages.length) {
        activeIdRef.current = target;
        // Per-chat knobs are ephemeral - reset on chat switch (the seeding effect
        // below re-applies them for the newly-shown chat, if it's a project chat).
        setChatEffortOverride(null);
        setChatProtectionOverride(null);
        setChatModelOverride(null);
        const restored = session.messages as ChatMessage[];
        rebuildRefs(restored);
        setMessages(restored);
        setPendingReview(null);
        setSendError(null);
        setInput("");
        // If this chat is still generating in the background, reflect that (the running
        // closure resumes live updates now that it's the active session); otherwise
        // clear any loading state left over from the chat we came from.
        const run = getRun(target);
        setLoading(!!run);
        setStreamingId(run?.assistantId ?? null);
        setLoadingPhase(run ? "generating" : "");
        return;
      }
      // Unknown (or not-yet-decrypted) session: show a fresh chat once, but keep
      // the effect armed - if the session appears on a later history emit, the
      // restore above runs then. Un-latch so a send meanwhile starts a new
      // session instead of overwriting the one we couldn't load.
      if (missingIdRef.current !== target) {
        missingIdRef.current = target;
        activeIdRef.current = null;
        setChatEffortOverride(null);
        setChatProtectionOverride(null);
        setChatModelOverride(null);
        startNewChat();
      }
      return;
    }
    activeIdRef.current = null;
    setChatEffortOverride(null);
    setChatProtectionOverride(null);
    setChatModelOverride(null);
    startNewChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionParam, chatHistory]);

  // Seed per-project chat defaults (model / protection / reasoning effort) once per
  // chat opened/created in a project scope. Keyed on the *logical* chat - the session
  // id, or the ?p= target for a fresh chat - so the seed never fights later manual
  // per-chat changes, and the self-navigation after the first send (?p=... -> ?c=...,
  // pre-marked in finalizeSend) doesn't re-seed. Runs after the session effect above,
  // so the effort seed wins over its reset-to-null on chat switch. An existing chat
  // whose history hasn't decrypted yet stays unseeded and retries on the next emit.
  // Applied via `applyProjectChatSeed`, which only ever writes the local override
  // state below (setChatProtectionOverride/setChatModelOverride/setChatEffortOverride)
  // - see projectChatDefaults.ts for why that function can never reach the global
  // quon.setProtectionLevel/setActiveModel setters.
  const seededChatKeyRef = useRef<string | null>(null);
  // A default model that wasn't an enabled option yet (the /models fetch is async):
  // applied when the list lands - unless the user picked a model in the meantime.
  const pendingModelSeedRef = useRef<{ modelId: string; modelAtSeed: string } | null>(null);
  useEffect(() => {
    const chatKey = sessionParam ?? `new:${projectParam ?? ""}`;
    if (seededChatKeyRef.current === chatKey) return;
    const session = sessionParam ? getChatSession(sessionParam) : undefined;
    if (sessionParam && !session) return; // not decrypted yet - retry on history emit
    seededChatKeyRef.current = chatKey;
    pendingModelSeedRef.current = null;
    const projId = sessionParam ? session?.projectId : projectParam;
    if (!projId) return;
    const seed = resolveProjectChatSeed(getProject(projId), models);
    applyProjectChatSeed(seed, {
      setProtectionOverride: setChatProtectionOverride,
      setModelOverride: setChatModelOverride,
      setReasoningOverride: setChatEffortOverride,
      setDisabledEntityTypesOverride: setChatDisabledTypesOverride,
    });
    if (seed.pendingModelId)
      pendingModelSeedRef.current = {
        modelId: seed.pendingModelId,
        modelAtSeed: effectiveModelId,
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionParam, projectParam, chatHistory, models]);

  // Apply a deferred project-default model once it becomes an enabled option. A
  // manual pick since the seed (effectiveModelId moved) cancels it - defaults only
  // seed, they never override the user. Sets the OVERRIDE, same as an immediate
  // seed above - never the global default.
  useEffect(() => {
    const pending = pendingModelSeedRef.current;
    if (!pending) return;
    if (effectiveModelId !== pending.modelAtSeed) {
      pendingModelSeedRef.current = null;
      return;
    }
    if (models.some((m) => m.id === pending.modelId && !m.disabled)) {
      pendingModelSeedRef.current = null;
      setChatModelOverride(pending.modelId);
    }
  }, [models, effectiveModelId]);

  // Persist the conversation on every change (covers streamed assistant tokens),
  // but only once a session exists and there is more than the intro bubble.
  // `bump: false` keeps the recents order stable - opening a chat or watching it
  // stream must not reshuffle the list; only sending a prompt (finalizeSend) does.
  useEffect(() => {
    const id = activeIdRef.current;
    if (!id || messages.length <= 1) return;
    saveChatSession(id, messages, { bump: false });
  }, [messages]);

  // --- MCP tool consent (the gate before any tool executes) -----------------
  // runChat awaits this promise; the dialog resolves it. If the user navigated
  // away (dialog can't render), the request auto-declines - fail-closed.
  const [toolConsent, setToolConsent] = useState<{
    items: ToolConsentItem[];
    /** Untrusted content (an MCP tool result) entered this run before a write
     *  was proposed - the dialog shows a provenance warning (injection guard). */
    untrusted: boolean;
    resolve: (r: { approved: boolean; always: boolean }) => void;
  } | null>(null);
  function requestToolConsent(items: ToolConsentItem[], untrusted: boolean) {
    return new Promise<{ approved: boolean; always: boolean }>((resolve) => {
      setToolConsent({
        items,
        untrusted,
        resolve: (r) => {
          setToolConsent(null);
          resolve(r);
        },
      });
    });
  }

  // Relay the (already scrubbed) conversation to the provider and append the reply.
  // The run is registered (chatRunner) and persists straight to its session, so it
  // SURVIVES navigating to another chat: the closure keeps streaming + saving, and only
  // touches the on-screen view while its session is the one being shown (`isActive`).
  async function runChat(convo: ChatMessage[]) {
    const sessionId = activeIdRef.current;
    // Snapshot the placeholder map: it's rebuilt when the user switches chats, but a
    // backgrounded run must keep re-hydrating with the map it started with.
    const rehydrationMap = { ...rehydration.current };
    const isActive = () => activeIdRef.current === sessionId;
    if (isActive()) setLoadingPhase("generating");
    const baseHistory: ChatTurn[] = toRelayHistory(convo);
    // Leading system turns for the latest user turn: the project instruction first
    // (persona / standing rules), then retrieved Memory context. Both are already
    // scrubbed when protection is on, so the provider only sees placeholders.
    const lastUser = [...convo].reverse().find((m) => m.role === "user");
    // The project instruction is STANDING context - persona and rules for the
    // whole chat - so it belongs at the head.
    const head: ChatTurn[] = [];
    if (lastUser?.instruction?.text)
      head.push({
        role: "system",
        content: `${INSTRUCTION_PREAMBLE}\n\n${lastUser.instruction.text}`,
      });
    // The attachment and the retrieved context belong to this turn, and say so
    // in their preambles - so they are spliced next to that turn, not at the
    // head where the model reads them as belonging to the first message.
    const turnContext: ChatTurn[] = [];
    if (lastUser?.attachment?.text)
      turnContext.push({
        role: "system",
        content: `${ATTACHMENT_PREAMBLE}\n\nDocument "${lastUser.attachment.name}":\n${lastUser.attachment.text}`,
      });
    if (lastUser?.rag?.context)
      turnContext.push({ role: "system", content: `${RAG_PREAMBLE}\n\n${lastUser.rag.context}` });
    const history: ChatTurn[] = withTurnContext(baseHistory, head, turnContext);
    // Only claim "protected" to the provider when the conversation actually
    // contains QUON placeholders. Otherwise the model is told to expect/keep
    // placeholders that don't exist and ends up inventing them in its reply.
    const hasPlaceholders = Object.keys(rehydrationMap).length > 0;
    const id = nextMessageId++;
    // The model that answers this turn - captured now so the footer + a restored
    // chat keep it even if the picker changes later (runChat closes over this
    // render's modelLabel).
    const answeringModel = modelLabel;
    setMessages((c) => [
      ...c,
      { id, role: "assistant", text: "", rawText: "", model: answeringModel },
    ]);
    setStreamingId(id);
    const selected = models.find((m) => m.id === effectiveModelId);
    const modelSlug = selected?.model || effectiveModelId;
    const connectionId = selected?.connection_id;
    // Image generation: only image-capable models get `image_output`;
    // they also get no tools - the image models reject function calling.
    const imageOutput = !!selected?.image_output;
    // Effective reasoning budget for this send: the per-chat override wins, else the
    // global default. "off" is sent as-is and dropped in the API layer.
    const effort = chatEffortOverride ?? reasoningEffort;
    const controller = new AbortController();
    if (sessionId) beginRun(sessionId, { controller, assistantId: id });

    // What the filter stripped out of tool RESULTS this turn, one entry per call.
    // Declared out here (not in the stream's try block) because `persist` below
    // closes over it: every save of this assistant message, including the
    // partial-answer and error paths, must carry the redactions collected so far
    // - they are the only record of those placeholder->value pairs.
    const toolRedactions: ToolRedaction[] = [];
    /** Spread into every setMessages patch for this bubble, so the live message
     *  carries exactly what `persist` writes - otherwise the redaction footer
     *  would only appear after a reload. */
    const redactionsPatch = () =>
      toolRedactions.length ? { toolRedactions: [...toolRedactions] } : {};

    // Persist the reply to its session as it streams (throttled) so navigating away
    // never loses it - saveChatSession is module-level and runs regardless of mount.
    let lastSave = 0;
    const persist = (
      text: string,
      rawText: string | undefined,
      isError: boolean,
      streamInterrupted?: boolean,
    ) => {
      if (!sessionId) return;
      const assistant: ChatMessage = {
        id,
        role: "assistant",
        text,
        rawText,
        model: answeringModel,
        isError: isError || undefined,
        streamInterrupted: streamInterrupted || undefined,
        images: images.length ? [...images] : undefined,
        // Copied: this array keeps growing as later tool calls finish, and a
        // saved snapshot must not mutate under the store after it was handed over.
        toolRedactions: toolRedactions.length ? [...toolRedactions] : undefined,
      };
      saveChatSession(sessionId, [...convo, assistant], { bump: false });
    };

    let raw = "";
    // Generated images: references collected as they arrive; the bytes
    // go to the sealed store first, then upload in the background - when the
    // upload lands, the persisted reference learns its chunkCount so other
    // devices can fetch it.
    const images: GeneratedImageRef[] = [];
    const patchImages = () => {
      if (isActive())
        setMessages((c) => c.map((m) => (m.id === id ? { ...m, images: [...images] } : m)));
    };
    const onImage = (dataUrl: string) => {
      void storeGeneratedImage(dataUrl, (synced) => {
        const i = images.findIndex((r) => r.id === synced.id);
        if (i >= 0) images[i] = synced;
        patchImages();
        persist(applyPlaceholders(raw, rehydrationMap), raw || undefined, false);
      }).then((ref) => {
        if (!ref) return;
        images.push(ref);
        patchImages();
        persist(applyPlaceholders(raw, rehydrationMap), raw || undefined, false);
      });
    };
    try {
      // MCP tools ([] when none configured - chat behaves exactly as before).
      const toolDefs = QUON_ENABLED && !imageOutput ? await getChatToolDefs() : [];
      let turns: ChatTurn[] = history;
      const MAX_TOOL_ROUNDS = 4;

      const onDelta = (delta: string) => {
        const first = raw === "";
        raw += delta;
        const rehydrated = applyPlaceholders(raw, rehydrationMap);
        if (isActive()) {
          if (first) setLoadingPhase(""); // first token arrived - drop the spinner
          setMessages((c) =>
            c.map((m) => (m.id === id ? { ...m, text: rehydrated, rawText: raw } : m)),
          );
        }
        const now = Date.now();
        if (now - lastSave > 700) {
          lastSave = now;
          persist(rehydrated, raw, false);
        }
      };

      // Reasoning ("thinking") tokens stream separately (reasoning models). We
      // re-hydrate them like the answer (they reference placeholders, not real
      // values) and show them in a collapsible panel - never mixed into the
      // answer. Live-only for v1 (not persisted): the thinking matters most
      // during the wait, and it can be long.
      let reasoningRaw = "";
      const onReasoning = (delta: string) => {
        reasoningRaw += delta;
        const rehydrated = applyPlaceholders(reasoningRaw, rehydrationMap);
        if (isActive()) {
          setMessages((c) => c.map((m) => (m.id === id ? { ...m, reasoning: rehydrated } : m)));
        }
      };

      // Web-search citations, accumulated across the stream (the provider sends
      // them in batches, already deduped by URL server-side). Persisted with the
      // message so a restored chat still shows where the answer came from.
      const collectedSources: WebSource[] = [];
      const onSources = (incoming: WebSource[]) => {
        collectedSources.push(...incoming);
        if (isActive()) {
          setMessages((c) =>
            c.map((m) => (m.id === id ? { ...m, sources: [...collectedSources] } : m)),
          );
        }
      };

      // Injection guard: flips true once content from an UNTRUSTED source (an
      // MCP tool result, or a first-party tool with provenance "external" -
      // Paperless) has entered this run's context. A write proposed afterwards
      // gets a provenance warning on its consent card. First-party reads over
      // the user's own store are trusted and don't flip it.
      let untrustedThisRun = false;

      for (let round = 0; ; round++) {
        const roundStart = raw.length;
        // Re-evaluated every round after the first: the previous round's tool
        // call can open a gate (pick_folder -> list/read/import_folder_file).
        // First-party only, no I/O - see refreshFirstPartyToolDefs.
        const roundDefs =
          round > 0 && toolDefs.length ? refreshFirstPartyToolDefs(toolDefs) : toolDefs;
        let pendingCalls: StreamToolCall[] = [];
        const onToolCalls = (calls: StreamToolCall[]) => {
          pendingCalls = calls;
        };

        // --- one streaming leg, resumable -----------------------------------
        // Mobile backgrounding freezes the page and drops the SSE socket. The
        // server keeps generating into a job buffer (stream_jobs.py), so when
        // this leg's socket dies we RE-ATTACH at the exact event offset we had
        // applied instead of losing the answer. Only a transport failure is
        // retried: an aborted run (user pressed stop) and a job the server no
        // longer knows (restart/TTL) both fall through to the normal handling.
        let jobId: string | null = null;
        let applied = 0; // buffered events already applied = the resume offset
        let finished = false;
        try {
          const leg = await chatStream(
            turns,
            modelSlug,
            Object.keys(rehydrationMap).length > 0,
            onDelta,
            controller.signal,
            connectionId,
            effort,
            roundDefs.length ? roundDefs : undefined,
            onToolCalls,
            webSearchEnabled && webSearchAvailable,
            onReasoning,
            onSources,
            {
              onJob: (j) => {
                jobId = j;
              },
              onEvent: (n) => {
                applied = n;
              },
            },
            { output: imageOutput, onImage },
          );
          finished = leg.terminal;
        } catch (streamErr) {
          // A payload error (provider refused, budget gone) is a real answer and
          // is marked terminal - only a broken pipe is worth reconnecting.
          const ownAbort = controller.signal.aborted;
          diagAppend(
            `stream leg ended: job=${jobId ? "yes" : "NONE"} applied=${applied} ` +
              `err=${streamErr instanceof Error ? `${streamErr.name}: ${streamErr.message}` : String(streamErr)} ` +
              `ownAbort=${ownAbort}`,
          );
          if (!jobId || ownAbort || !isTransportFailure(streamErr, ownAbort)) throw streamErr;
        }

        // Not finished => the socket died mid-answer (mobile backgrounding). The
        // server kept generating into its job buffer, so re-attach at exactly
        // the events we applied. Note a cut SSE usually just STOPS - no
        // exception - which is why `terminal` drives this, not the catch above.
        for (let attempt = 0; !finished && jobId; attempt++) {
          await whenVisible(controller.signal); // frozen tab -> wait for the return
          if (controller.signal.aborted) break;
          // Coming back from the background, the radio is often still
          // re-associating: an immediate retry fails and burns the budget in
          // milliseconds. Back off a little from the second attempt on.
          if (attempt > 0) await new Promise((r) => setTimeout(r, 400 * attempt));
          if (controller.signal.aborted) break;
          const base = applied;
          try {
            const leg = await resumeChatStream(
              jobId,
              base,
              {
                onDelta,
                onToolCalls,
                onReasoning,
                onSources,
                onImage,
                onEvent: (n) => {
                  applied = base + n;
                },
              },
              controller.signal,
            );
            finished = leg.terminal;
            if (!finished && attempt >= 4) break; // stop reconnect-looping
          } catch (resumeErr) {
            // Job gone (server restart / TTL) or repeated failure: fall through
            // with the partial answer + Retry, exactly as before this feature.
            diagAppend(
              `resume attempt ${attempt} failed: ` +
                `${resumeErr instanceof Error ? `${resumeErr.name}: ${resumeErr.message}` : String(resumeErr)}`,
            );
            if (resumeErr instanceof StreamGoneError || attempt >= 4) break;
            if (!isTransportFailure(resumeErr, controller.signal.aborted)) throw resumeErr;
          }
        }
        // Still unfinished after the reconnect budget -> surface the honest
        // "connection lost" bubble (classifyStreamError's keepPartial path).
        if (!finished && !controller.signal.aborted && !pendingCalls.length) {
          throw new QuonError(t("chat.connectionLost"));
        }
        if (!pendingCalls.length || round >= MAX_TOOL_ROUNDS) break;

        // --- consent gate (always-allow list can pre-approve; first-party
        //     Write tools are structurally excluded from it - see chatTools) --
        const items: ToolConsentItem[] = pendingCalls.map((c) => {
          const quon = parseQuonToolName(c.name);
          const parsed = quon ? null : parseToolName(c.name);
          return {
            id: c.id,
            serverId: quon ? QUON_TOOL_SERVER_ID : (parsed?.serverId ?? "?"),
            tool: quon?.tool ?? parsed?.tool ?? c.name,
            // Arguments are shown REHYDRATED - the user must see what would
            // actually be sent/written, not placeholder soup. For writes the
            // arguments are the payload, so this doubles as the content preview.
            argsDisplay: applyPlaceholders(c.arguments || "{}", rehydrationMap),
            write: quon?.trust === "write",
          };
        });
        const preApproved = items.every((i) => isAlwaysAllowed(i.serverId, i.tool));
        const decision = preApproved
          ? { approved: true, always: false }
          : isActive()
            ? await requestToolConsent(items, untrustedThisRun)
            : { approved: false, always: false }; // backgrounded -> fail-closed
        if (decision.approved && decision.always)
          for (const i of items) rememberAlwaysAllow(i.serverId, i.tool);

        // --- execute (args re-hydrated locally; results scrubbed) -----------
        const assistantTurn: ChatTurn = {
          role: "assistant",
          content: raw.slice(roundStart),
          tool_calls: pendingCalls.map((c) => ({
            id: c.id,
            type: "function" as const,
            function: { name: c.name, arguments: c.arguments },
          })),
        };
        const toolTurns: ChatTurn[] = [];
        for (const call of pendingCalls) {
          const quon = parseQuonToolName(call.name);
          const parsed = quon ? null : parseToolName(call.name);
          let resultForModel: string;
          if (!decision.approved || (!parsed && !quon)) {
            resultForModel = "The user declined this tool call.";
          } else {
            if (isActive()) setLoadingPhase("generating");
            const toolLabel = friendlyToolName(quon?.tool ?? parsed?.tool ?? "", t);
            // The marker is written before the call so an erroring tool still
            // gets one, then rewritten below once the redaction count is known.
            // Safe because nothing else appends to `raw` in between: this round's
            // stream leg has already finished (`finished`/`pendingCalls` above),
            // so `onDelta` cannot fire, and calls are executed one at a time.
            // The length check makes that an assertion rather than an assumption
            // - if it ever stops holding, the count is dropped, not misattached.
            const markerAt = raw.length;
            const marker = (n: number) =>
              `\n\n> ⚙ ${toolLabel}${n > 0 ? ` · ${t("chat.toolRedactedInline", { count: n })}` : ""}\n\n`;
            raw += marker(0);
            let redactedHere = 0;
            try {
              const argsObj = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
              const rehydratedArgs = JSON.parse(
                applyPlaceholders(JSON.stringify(argsObj), rehydrationMap),
              ) as Record<string, unknown>;
              // First-party tools run in-browser over the user's own decrypted
              // data; MCP tools go to the user's external server. An MCP
              // result is UNTRUSTED content entering this run (injection
              // guard) - and so is a first-party tool whose content comes from
              // a live external source (provenance "external", e.g. Paperless).
              let resultText: string;
              if (quon) {
                resultText = await callQuonTool(quon.tool, rehydratedArgs, { scope });
                if (toolProvenance(call.name) === "external") untrustedThisRun = true;
              } else {
                resultText = await callTool(parsed!.serverId, parsed!.tool, rehydratedArgs);
                untrustedThisRun = true;
              }
              if (QUON_ENABLED && filterActive) {
                // ZK: the result may contain fresh PII - scrub before it
                // re-enters the relay. Fail-CLOSED: unreachable filter => the
                // result is withheld from the provider, never sent raw.
                // scrubLarge (not scrubText): a full-document tool result
                // (read_paperless_document, up to 50k) in one /scrub request
                // would tip over Cloudflare's ~100s edge timeout and fail the
                // whole result closed - same reason attachments chunk.
                try {
                  // scrubOptions(), not a hand-rolled copy: the redaction
                  // policy is the enforcement channel, and two sources of truth
                  // for it is how a send path quietly stops honouring the user's
                  // lists (which is exactly what happened in agents/runner.ts).
                  const sr = await scrubLarge(resultText, scrubOptions());
                  const merged = mergeScrubbedResult(sr, rehydrationMap);
                  Object.assign(rehydrationMap, merged.additions);
                  resultForModel = merged.text;
                  // merged.entities, not merged.additions: additions is only what
                  // the map still lacked, so a value the user had already
                  // mentioned would go unreported even though it was redacted
                  // out of this document too.
                  if (merged.entities.length) {
                    redactedHere = merged.entities.length;
                    toolRedactions.push({ tool: toolLabel, entities: merged.entities });
                  }
                } catch {
                  resultForModel = "[tool result withheld — QUON's privacy filter is unreachable]";
                }
              } else {
                resultForModel = resultText;
              }
            } catch (toolErr) {
              resultForModel = `Tool error: ${
                toolErr instanceof Error ? toolErr.message : String(toolErr)
              }`;
            }
            if (redactedHere > 0 && raw.length === markerAt + marker(0).length) {
              raw = raw.slice(0, markerAt) + marker(redactedHere);
            }
          }
          toolTurns.push({ role: "tool", content: resultForModel, tool_call_id: call.id });
        }
        turns = [...turns, assistantTurn, ...toolTurns];
      }
      const finalText = raw === "" ? t("chat.noResponse") : applyPlaceholders(raw, rehydrationMap);
      if (isActive())
        setMessages((c) =>
          c.map((m) =>
            m.id === id
              ? { ...m, text: finalText, rawText: raw || undefined, ...redactionsPatch() }
              : m,
          ),
        );
      persist(finalText, raw || undefined, false);
    } catch (err) {
      if (controller.signal.aborted) return; // user stopped - stopGeneration cleaned up
      // A 401 here means the app's session is gone, not that the model
      // provider errored - the global 401 hook (authStore, via quonApi.ts) is
      // already sending the app to the sign-in screen; this is just the label
      // for a bubble rendered in that instant. A genuine mid-stream failure
      // with tokens already on screen must keep them - see classifyStreamError.
      // Localize the provider detail before it's baked into the wrapped
      // "Model provider error - {detail}" string (classifyStreamError itself
      // is not localized).
      diagAppend(
        `stream FAILED — ${err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : String(err).slice(0, 120)} ` +
          `partial=${raw.length} unauthorized=${isUnauthorizedError(err)} online=${navigator.onLine} visibility=${document.visibilityState}`,
      );
      const decision = classifyStreamError({
        partialLen: raw.length,
        unauthorized: isUnauthorizedError(err),
        detail: err instanceof Error ? translateApiError(err, t) : t("errors.generic"),
      });
      if (decision.keepPartial) {
        const rehydrated = applyPlaceholders(raw, rehydrationMap);
        if (isActive())
          setMessages((c) =>
            c.map((m) =>
              m.id === id
                ? {
                    ...m,
                    text: rehydrated,
                    rawText: raw,
                    streamInterrupted: true,
                    ...redactionsPatch(),
                  }
                : m,
            ),
          );
        persist(rehydrated, raw, false, true);
      } else {
        // classifyStreamError's own "Session expired - sign in to continue." literal
        // is outside this pass's file scope (streamError.ts) - use the shared,
        // already-localized catalog string for that case instead; the provider-error
        // wrapper already carries the translated detail from above.
        const errText = isUnauthorizedError(err) ? t("errors.sessionExpired") : decision.errorText!;
        if (isActive())
          setMessages((c) =>
            c.map((m) =>
              m.id === id
                ? { ...m, text: errText, rawText: undefined, isError: true, ...redactionsPatch() }
                : m,
            ),
          );
        persist(errText, undefined, true);
      }
    } finally {
      if (sessionId) endRun(sessionId);
      if (isActive()) {
        setStreamingId(null);
        setLoading(false);
        setLoadingPhase("");
      }
    }
  }

  // Stop the shown chat's in-flight generation and pull the prompt back for editing.
  function stopGeneration() {
    cancelledRef.current = true; // bail the scrub/retrieve phase if the stream hasn't started
    abortRun(activeIdRef.current);
    if (streamingId != null) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const trimmed = messages.filter((m) => m.id !== streamingId && m.id !== lastUser?.id);
      setMessages(trimmed);
      if (activeIdRef.current) saveChatSession(activeIdRef.current, trimmed, { bump: false });
    }
    if (inFlightOriginal.current) setInput(inFlightOriginal.current);
    setStreamingId(null);
    setLoading(false);
    setLoadingPhase("");
  }

  // Commit the (possibly edited) redactions and hand the message to the model.
  function finalizeSend(
    original: string,
    finalText: string,
    items: ReviewItem[],
    fallbackMode: boolean,
    protectedFlag: boolean,
    rag?: RagThread,
    meta?: { skipReason?: string | null; lowCaseSignal?: boolean; contextEmpty?: boolean },
    instruction?: ChatMessage["instruction"],
    attachment?: ChatMessage["attachment"],
    unfiltered?: boolean,
  ) {
    // Cancelled during the scrub/retrieve phase -> don't commit the turn.
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    // Sending always re-anchors the view to the bottom, even if the user had
    // scrolled up while composing.
    stickToBottom.current = true;
    commitRehydration(items);
    // Commit the kept-redacted context placeholders here (deferred from build time),
    // so a cancelled review leaves no stale mappings and an un-redacted document/RAG
    // hit - already gone from the sent text - is never re-hydrated.
    for (const e of rag?.entities ?? []) rehydration.current[e.placeholder] = e.value;
    for (const e of instruction?.entities ?? []) rehydration.current[e.placeholder] = e.value;
    for (const e of attachment?.entities ?? []) rehydration.current[e.placeholder] = e.value;
    const entities: Entity[] = items
      .filter((i) => i.active)
      .map((i) => ({
        type: i.isManual ? "MANUAL" : i.type,
        value: i.value,
        placeholder: i.placeholder,
        confidence: i.confidence ?? 1,
      }));
    const totalRedacted =
      entities.length +
      (attachment?.entities?.length ?? 0) +
      (rag?.entities?.length ?? 0) +
      (instruction?.entities?.length ?? 0);
    // Count everything redacted before sending - the typed message AND the
    // attachment, RAG context and project instruction (else a PDF with 24 redacted
    // values shows "0 redacted").
    quon.addRedacted(totalRedacted);
    // Onboarding step 0: any message sent from the fresh empty-chat intro
    // advances the flow - content doesn't matter, only that the user tried it.
    // But step 1's callout needs something to point at: if this particular send
    // had nothing redacted (e.g. the user typed something with no PII), there is
    // nothing for it to show and it would never render - skip straight to the
    // step-2 teaser instead of leaving the flow stuck at an invisible step 1.
    if (showOnboardingIntro) {
      if (totalRedacted > 0) advanceOnboardingFromIntro();
      else skipToOnboardingTeaser();
    }
    const userMsg: ChatMessage = {
      id: nextMessageId++,
      role: "user",
      text: original,
      scrubbed: finalText,
      entities,
      fallbackMode,
      skipReason: meta?.skipReason,
      lowCaseSignal: meta?.lowCaseSignal,
      protected: protectedFlag,
      rag,
      contextEmpty: meta?.contextEmpty,
      instruction,
      attachment,
      unfiltered,
    };
    // Are we truly continuing the chat shown in the URL? activeIdRef can lag the URL
    // during the async "New chat" navigation; if it no longer matches sessionParam,
    // treat this as a FRESH chat (base = just the intro) so a send right after pressing
    // "+" never inherits the previous chat's messages (the entanglement bug).
    const continuing =
      activeIdRef.current != null && activeIdRef.current === (sessionParam ?? null);
    const convo = [...(continuing ? messages : [getIntroMessage(t)]), userMsg];
    setMessages(convo);
    setAttachment(null); // consumed by this message
    // Sending a prompt is the only action that reorders recents: bump this session to
    // the top. A fresh chat also mints its id and reflects it in the URL.
    let id = continuing ? activeIdRef.current : null;
    if (!id) {
      id = createChatSessionId();
      activeIdRef.current = id;
      // Mark the self-navigation before navigate(): see pendingSelfNavRef above.
      pendingSelfNavRef.current = { id, ts: Date.now() };
      // Same logical chat, new URL: pre-mark it as seeded so the project-defaults
      // effect doesn't re-apply over changes the user made before the first send.
      seededChatKeyRef.current = id;
      navigate({ to: "/chat", search: { c: id }, replace: true });
    }
    saveChatSession(id, convo, { bump: true, projectId: scope });
    setLoading(true);
    setLoadingPhase("generating");
    runChat(convo);
  }

  // Dismiss a detected artifact card ("I don't want this in my documents").
  // Recorded on the MESSAGE (not component state) because artifacts are
  // re-detected from the answer text on every render - the card would otherwise
  // reappear on reload. The `messages` effect persists + syncs it.
  const dismissArtifact = useCallback((messageId: number, index: number) => {
    setMessages((c) =>
      c.map((m) =>
        m.id === messageId
          ? { ...m, dismissedArtifacts: [...(m.dismissedArtifacts ?? []), index] }
          : m,
      ),
    );
  }, []);

  // Re-send the conversation after a provider error (or an interrupted stream):
  // drop the broken bubble(s) and replay the relay with the already-scrubbed
  // history. No re-scrub, no new user turn - the failed request is simply
  // attempted again (e.g. after a rate limit passed, a key was fixed in
  // Settings, or the connection came back). Also drops any `streamInterrupted`
  // bubble - that message kept its partial (now-superseded) text on screen and
  // persisted, but a retry regenerates the answer from scratch, not from where
  // it was cut off.
  function retryAfterError() {
    if (loading) return;
    const convo = messages.filter((m) => !m.isError && !m.streamInterrupted);
    if (!convo.some((m) => m.role === "user")) return;
    setSendError(null);
    setMessages(convo);
    const id = activeIdRef.current;
    if (id) saveChatSession(id, convo, { bump: false });
    setLoading(true);
    setLoadingPhase("generating");
    void runChat(convo);
  }

  // "Resend without filter" (see unfilteredResend.ts): append `original` - the
  // AFFECTED message's pre-scrub text - as a brand-new user turn that skips /scrub
  // entirely. Reuses finalizeSend so this gets the same session bookkeeping as any
  // other send (new message id, recents bump, persistence); the only difference is
  // the payload shape (no entities, protected: false, unfiltered: true) and that no
  // attachment/RAG/instruction is re-attached - a bare-text resend by design, to
  // keep the exposure of this bypass minimal. Always appends at the END of the
  // conversation; it never edits the original (garbled) turn or its answer.
  function resendWithoutFilter(original: string) {
    if (loading || pendingReview || isGenerating(activeIdRef.current)) return;
    const payload = buildUnfilteredResend(original);
    finalizeSend(
      original,
      payload.scrubbed,
      [],
      false,
      payload.protected,
      undefined,
      undefined,
      undefined,
      undefined,
      payload.unfiltered,
    );
  }

  /** `overrideText` is the dashboard handoff (lib/pendingChatMessage.ts): the
   *  message was typed on the start screen, so it isn't in `input` state here. */
  async function send(overrideText?: string) {
    const original = (overrideText ?? input).trim();
    if (!original || loading || pendingReview) return;
    cancelledRef.current = false;
    inFlightOriginal.current = original;
    setSendHint(null);

    // Scrub only when QUON is enabled AND the protection slider is Filter or Review.
    const protect = QUON_ENABLED && filterActive;
    const willRetrieve = useMemoryContext && hasInjectableContext(scope);
    // Diagnostics breadcrumb - shape of the send, never its content.
    diagAppend(
      `send: protect=${protect} chars=${original.length} attach=${attachment?.text.length ?? 0} ` +
        `online=${navigator.onLine} visibility=${document.visibilityState}`,
    );

    if (!protect) {
      // Protection off (slider "None" or QUON disabled): send without scrubbing.
      // Context (if any) is injected raw, consistent with the unprotected message.
      setSendError(null);
      setInput("");
      setLoading(true);
      if (willRetrieve) setLoadingPhase("searching");
      const rag = await buildRag(original, false);
      const instruction = await buildInstruction(false);
      const attach = await buildAttachment(false);
      finalizeSend(
        original,
        original,
        [],
        false,
        false,
        rag,
        { contextEmpty: willRetrieve && !rag },
        instruction,
        attach,
      );
      return;
    }

    setLoading(true);
    setLoadingPhase(willRetrieve ? "searching" : "scrubbing");
    setSendError(null);

    // On-device prep first: retrieval and the project instruction decide what has
    // to be scrubbed without spending a round trip.
    const ragPrep = await prepareRag(original);
    const instructionRaw = projectInstruction();

    setLoadingPhase("scrubbing");
    // One parallel wave. Context, project instruction, attachment and the typed
    // message are independent inputs, so their /scrub round trips overlap instead
    // of queueing - each costs a network hop plus the backend's cloud-LLM pass
    // (~0.3–1.2 s measured), and doing four in sequence was most of the delay
    // before the model even started answering.
    // The user's global policy PLUS every saved per-document redaction that
    // could flow into this send: the attached documents' terms, and - when
    // context retrieval is on - the terms of every in-scope ready document
    // (retrieved snippets carry no doc ids, so the union over the scope is the
    // fail-SAFE direction: worst case a term is redacted in a send that didn't
    // quote its document, which is over-redaction, never a leak). scrubText
    // verifies `always_redact` afterwards, so these are enforced, not hoped.
    // ...plus the hand-redactions made in the staged attachment's preview:
    // per-send, so they live on the attachment, not in any store.
    const docTerms = mergeRedactTerms(
      collectRedactTerms([
        ...(attachment?.docIds ?? []),
        ...(willRetrieve ? readyDocs.map((d) => d.id) : []),
      ]),
      attachment?.redactTerms ?? [],
    );
    const baseOpts = scrubOptions();
    const opts = docTerms.length
      ? { ...baseOpts, always_redact: [...baseOpts.always_redact, ...docTerms] }
      : baseOpts;

    // Progress tracking for the whole wave (feedback: a 200k-char / 10-doc
    // attachment takes 50-60s, and a bare attachment-only "(7/25)" fraction
    // missed the rag/instruction/message units running concurrently in the
    // same wave). Gate stays exactly the old intent: only bother when the
    // attachment itself needs splitting - a sub-threshold scrub finishes
    // before any bar could inform anyone. splitForScrub is the same pure
    // split scrubLarge uses internally, computed up front (cheap, no network)
    // so the total is known at t=0 instead of only after the first piece lands.
    const attachPieceCount = attachment ? splitForScrub(attachment.text).length : 0;
    // Any attachment tracks - not just a multi-piece one. The old `> 1` gate
    // meant a single document at or under the 12k split threshold got no
    // progress at all, though its one /scrub call can still take 10s+ (and up
    // to the 180s timeout when a piece stalls). The gate predates the 2s reveal
    // delay, which now covers the "finished before a bar could inform anyone"
    // case the `> 1` was there for.
    const trackWave = attachPieceCount >= 1;
    const waveStart = performance.now();
    let waveDone = 0;
    let waveUpdatedAt = waveStart;
    let attachDone = 0;
    let attachUpdatedAt = waveStart;
    let waveRetry: { attempt: number; attempts: number } | undefined;
    const waveTotal = scrubWaveTotal({
      attachmentPieces: attachPieceCount,
      hasRag: Boolean(ragPrep),
      hasInstruction: Boolean(instructionRaw),
    });
    const pushWaveProgress = () => {
      if (!trackWave || !attachment) return;
      setScrubProgress({
        done: waveDone,
        total: waveTotal,
        updatedAt: waveUpdatedAt,
        attachDone,
        attachTotal: attachPieceCount,
        attachUpdatedAt,
        startedAt: waveStart,
        attachmentLabel: attachment.name,
        attachChars: attachment.text.length,
        retry: waveRetry,
      });
    };
    // Marks one non-attachment unit (rag/instruction/message) as finished,
    // success or failure alike - the wave's fail-closed handling happens
    // later from the awaited results, this is presentation-only bookkeeping.
    const markFastUnitDone = () => {
      waveDone += 1;
      waveUpdatedAt = performance.now();
      pushWaveProgress();
    };
    setScrubProgress(null); // reset any stale progress from a prior send
    pushWaveProgress(); // no-op unless trackWave - seeds the bar at (0, waveTotal)

    const pRag = ragPrep
      ? settled(scrubText(ragPrep.combined, opts).finally(trackWave ? markFastUnitDone : undefined))
      : undefined;
    const pInstruction = instructionRaw
      ? settled(scrubText(instructionRaw, opts).finally(trackWave ? markFastUnitDone : undefined))
      : undefined;
    const pAttach = attachment
      ? settled(
          // `total` here always equals attachPieceCount (same pure split, same
          // input) - attachPieceCount is used directly below so the reported
          // total is stable from t=0 rather than only appearing once the
          // first piece resolves.
          scrubLarge(
            attachment.text,
            opts,
            (done) => {
              attachDone = done;
              attachUpdatedAt = performance.now();
              waveDone += 1;
              waveUpdatedAt = attachUpdatedAt;
              pushWaveProgress();
            },
            (info) => {
              // A piece timed out and is being retried - say so instead of
              // letting the bar sit there looking dead.
              waveRetry = { attempt: info.attempt, attempts: info.attempts };
              pushWaveProgress();
            },
          ),
        )
      : undefined;
    const pMessage = settled(
      scrubText(original, opts).finally(trackWave ? markFastUnitDone : undefined),
    );

    // ...consumed in a FIXED order, so the global placeholder numbering stays
    // deterministic regardless of which response happens to land first.
    let rag: RagThread | undefined;
    const ragRes = await pRag;
    if (ragPrep && ragRes?.ok) {
      const ri = reindex(ragRes.value.scrubbed, ragRes.value.entities);
      rag = { context: ri.scrubbed, sources: ragPrep.sources, entities: ri.entities };
    } // scrub failed -> context is simply not sent (same silent degrade as before)

    let instruction: ChatMessage["instruction"];
    const instructionRes = await pInstruction;
    if (instructionRes?.ok) {
      const ri = reindex(instructionRes.value.scrubbed, instructionRes.value.entities);
      instruction = { text: ri.scrubbed, entities: ri.entities };
    }

    let attach: ChatMessage["attachment"];
    const attachRes = await pAttach;
    if (attachRes && attachment) {
      if (!attachRes.ok) {
        // Fail closed: couldn't scrub the attachment -> send nothing, keep it staged.
        setLoading(false);
        setLoadingPhase("");
        setSendError(t("chat.errorAttachmentScrubFailed"));
        return;
      }
      const ri = reindex(attachRes.value.scrubbed, attachRes.value.entities);
      attach = {
        name: attachment.name,
        text: ri.scrubbed,
        entities: ri.entities,
        truncated: attachment.truncated,
        combined: attachment.combined,
      };
    }

    let result;
    const messageRes = await pMessage;
    try {
      if (!messageRes.ok) throw messageRes.error;
      result = messageRes.value;
    } catch (err) {
      // Fail closed: never send unscrubbed text. Keep the input and surface an error.
      diagAppend(
        `send: scrub FAILED — ${err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : String(err).slice(0, 120)} ` +
          `unauthorized=${isUnauthorizedError(err)} online=${navigator.onLine}`,
      );
      setLoading(false);
      setLoadingPhase("");
      // A 401 here means the session is gone, not that the scrubber is
      // unreachable - the global 401 hook (authStore, via quonApi.ts) already
      // transitions the app to the sign-in screen; don't tell a hosted user to
      // "start the scrubber" (developer jargon they have no way to act on) for
      // what is actually an auth issue.
      setSendError(isUnauthorizedError(err) ? t("errors.sessionExpired") : t("errors.offline"));
      return;
    }

    const reindexed = reindex(result.scrubbed, result.entities);
    const items: ReviewItem[] = reindexed.entities.map((e) => ({
      placeholder: e.placeholder,
      value: e.value,
      type: e.type,
      confidence: e.confidence,
      active: true,
      isManual: false,
    }));

    if (reviewBeforeSend) {
      // Pause: let the user review before anything leaves the device.
      setInput("");
      setLoading(false);
      setLoadingPhase("");
      setPendingReview({
        original,
        base: reindexed.scrubbed,
        items,
        fallbackMode: result.metadata.fallback_mode,
        skipReason: result.metadata.skip_reason,
        lowCaseSignal: result.metadata.low_case_signal,
        rag: rag
          ? { base: rag.context, sources: rag.sources, items: entitiesToItems(rag.entities) }
          : undefined,
        contextEmpty: willRetrieve && !rag,
        instruction,
        attachment: attach
          ? {
              name: attach.name,
              base: attach.text,
              truncated: attach.truncated,
              combined: attach.combined,
              items: entitiesToItems(attach.entities),
              docIds: attachment?.docIds,
            }
          : undefined,
      });
      return;
    }

    setInput("");
    finalizeSend(
      original,
      reindexed.scrubbed,
      items,
      result.metadata.fallback_mode,
      true,
      rag,
      {
        skipReason: result.metadata.skip_reason,
        lowCaseSignal: result.metadata.low_case_signal,
        contextEmpty: willRetrieve && !rag,
      },
      instruction,
      attach,
    );
  }

  function confirmSend() {
    if (!pendingReview) return;
    const pr = pendingReview;
    setPendingReview(null);
    // Re-apply the user's per-hit toggles to each context source: keep-redacted hits
    // stay as placeholders; un-redacted hits are substituted back to their real value
    // and dropped from `entities` (so they never re-hydrate).
    const rag: RagThread | undefined = pr.rag
      ? {
          context: buildSentText(pr.rag.base, pr.rag.items),
          sources: pr.rag.sources,
          entities: activeEntities(pr.rag.items),
        }
      : undefined;
    const attachment: ChatMessage["attachment"] = pr.attachment
      ? {
          name: pr.attachment.name,
          text: buildSentText(pr.attachment.base, pr.attachment.items),
          truncated: pr.attachment.truncated,
          combined: pr.attachment.combined,
          entities: activeEntities(pr.attachment.items),
        }
      : undefined;
    finalizeSend(
      pr.original,
      buildSentText(pr.base, pr.items),
      pr.items,
      pr.fallbackMode,
      true,
      rag,
      {
        skipReason: pr.skipReason,
        lowCaseSignal: pr.lowCaseSignal,
        contextEmpty: pr.contextEmpty,
      },
      pr.instruction,
      attachment,
    );
  }

  function cancelReview() {
    if (!pendingReview) return;
    setInput(pendingReview.original);
    setPendingReview(null);
  }

  // The dashboard composer's handoff: a message typed on the start screen is sent
  // here, exactly once. Memory-only handoff, never a URL param, so no crafted
  // link can send on the user's behalf (lib/pendingChatMessage.ts).
  //
  // Waits for the model catalog: until it lands, `models` is the bundled
  // placeholder whose ids differ from the real connection-scoped ones, so sending
  // now would pick the wrong model. If the catalog never arrives (offline), the
  // text lands in the composer instead of being thrown at a request that fails -
  // the user's words are never lost either way.
  const handoffConsumed = useRef(false);
  useEffect(() => {
    if (handoffConsumed.current || !modelsSettled || loading) return;
    const pending = takePendingChatMessage();
    if (!pending) return;
    handoffConsumed.current = true;
    if (modelsLoaded) void send(pending);
    else setInput(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsSettled, modelsLoaded, loading]);

  function toggleReviewItem(placeholder: string) {
    setPendingReview((pr) =>
      pr
        ? {
            ...pr,
            items: pr.items.map((it) =>
              it.placeholder === placeholder ? { ...it, active: !it.active } : it,
            ),
          }
        : pr,
    );
  }

  // Same toggle for a hit detected inside the attached document.
  function toggleAttachmentItem(placeholder: string) {
    setPendingReview((pr) =>
      pr && pr.attachment
        ? {
            ...pr,
            attachment: {
              ...pr.attachment,
              items: pr.attachment.items.map((it) =>
                it.placeholder === placeholder ? { ...it, active: !it.active } : it,
              ),
            },
          }
        : pr,
    );
  }

  // Same toggle for a hit detected inside the retrieved Memory/Documents context.
  function toggleContextItem(placeholder: string) {
    setPendingReview((pr) =>
      pr && pr.rag
        ? {
            ...pr,
            rag: {
              ...pr.rag,
              items: pr.rag.items.map((it) =>
                it.placeholder === placeholder ? { ...it, active: !it.active } : it,
              ),
            },
          }
        : pr,
    );
  }

  // Turn the current text selection into a manual [REDACTED_n] item. The
  // matching (incl. the cross-line-break tolerance) lives in lib/manualRedact -
  // and every failure is named, because a silent null here reads as "the
  // button doesn't work".
  function manualItemForValue(value: string, sentText: string): ReviewItem | ManualRedactError {
    const match = findManualSelection(value, sentText);
    if ("error" in match) return match.error;
    globalCounts.current["REDACTED"] = (globalCounts.current["REDACTED"] ?? 0) + 1;
    return {
      placeholder: `[REDACTED_${globalCounts.current["REDACTED"]}]`,
      value: match.value,
      type: "MANUAL",
      confidence: 1,
      active: true,
      isManual: true,
    };
  }

  function manualRedactionFor(sentText: string): ReviewItem | ManualRedactError {
    const item = manualItemForValue(window.getSelection()?.toString() ?? "", sentText);
    if (typeof item !== "string") window.getSelection()?.removeAllRanges();
    return item;
  }

  // Manually redact a selection in the typed-message preview.
  function redactSelection(): ManualRedactError | null {
    if (!pendingReview) return null;
    const item = manualRedactionFor(buildSentText(pendingReview.base, pendingReview.items));
    if (typeof item === "string") return item;
    setPendingReview((pr) => (pr ? { ...pr, items: [...pr.items, item] } : pr));
    return null;
  }

  // Manually redact a selection in the attached document's scrubbed full text.
  function redactAttachmentSelection(): ManualRedactError | null {
    if (!pendingReview?.attachment) return null;
    const a = pendingReview.attachment;
    const item = manualRedactionFor(buildSentText(a.base, a.items));
    if (typeof item === "string") return item;
    setPendingReview((pr) =>
      pr && pr.attachment
        ? { ...pr, attachment: { ...pr.attachment, items: [...pr.attachment.items, item] } }
        : pr,
    );
    return null;
  }

  // Durable ("Immer schwärzen") counterpart of redactAttachmentSelection, for
  // the attachment only (feedback -> the Review panel's own selection-to-redact
  // power should also be able to remember a term, not just cover this send).
  //
  // Resolves against the attachment's scrubbed BASE text (occurrence count =
  // the blast radius across this document, not just what's left unredacted in
  // the panel right now) - same gate the document viewer's Text view uses.
  // Then applies to this send via the exact same per-send path
  // redactAttachmentSelection uses: adding the term to alwaysRedact alone would
  // not touch text the scrub already ran over, so both must happen together.
  // "Prüfen & schwärzen" / "Original ansehen & schwärzen" (Review):
  // opens the real DocumentViewer (rendered PDF pages, detection preview,
  // TextLayer selection) for the STAGED attachment - a library document as
  // itself, anything else (fresh upload, Paperless, combined) as an ad-hoc
  // source whose redactions are per-send. The staged state outlives the
  // Review panel (it is consumed by finalizeSend), so one opener serves both.
  function openAttachmentPreview() {
    if (!attachment) return;
    const src = previewSourceFor(attachment);
    if (src.kind === "library") {
      const d = getDocument(src.docId);
      if (d) {
        setReviewViewerDoc(d);
        return;
      }
      // The library item vanished under the staged chip - preview the staged
      // text instead of showing nothing.
    }
    setPreviewAdhoc(adhocSourceFor(attachment));
  }

  // A per-send redaction chosen in the ad-hoc preview: onto the staged
  // attachment (-> this send's always_redact), never into a store.
  function redactForSend(value: string) {
    setAttachment((a) =>
      a ? { ...a, redactTerms: mergeRedactTerms(a.redactTerms ?? [], [value]) } : a,
    );
  }

  // On close, terms chosen in the viewer must also cover this send when Review
  // is open: the scrub already ran, so a doc term alone would only bind future
  // sends - the user just redacted something and rightly expects the message
  // in front of them to honour it. Deterministic reconcile, not a hope: every
  // term (saved on the document, or per-send on the staged attachment) still
  // present in the outgoing text becomes a per-send manual item.
  function closeAttachmentPreview() {
    setReviewViewerDoc(null);
    setPreviewAdhoc(null);
    const sendTerms = attachment?.redactTerms ?? [];
    setPendingReview((pr) => {
      if (!pr?.attachment) return pr;
      const a = pr.attachment;
      let items = a.items;
      for (const term of mergeRedactTerms(collectRedactTerms(a.docIds ?? []), sendTerms)) {
        const item = manualItemForValue(term, buildSentText(a.base, items));
        if (typeof item !== "string") items = [...items, item];
      }
      return items === a.items ? pr : { ...pr, attachment: { ...a, items } };
    });
  }

  function redactAttachmentAlways(): DurableRedactMatch | null {
    if (!pendingReview?.attachment) return null;
    const a = pendingReview.attachment;
    const docIds = a.docIds ?? [];
    if (docIds.length === 0) return null; // ad-hoc upload - nothing to save to
    const resolved = resolveDurableRedaction(
      window.getSelection()?.toString(),
      a.base,
      neverRedact,
    );
    if ("error" in resolved) return resolved;
    const item = manualRedactionFor(buildSentText(a.base, a.items));
    if (typeof item === "string") return { error: item };
    setPendingReview((pr) =>
      pr && pr.attachment
        ? { ...pr, attachment: { ...pr.attachment, items: [...pr.attachment.items, item] } }
        : pr,
    );
    // Save ON the document(s) whose text actually contains the value - with a
    // combined attachment ("Attach all"), blanket-saving to every doc would pin
    // terms onto documents that never mention them. `occursIn` uses the same
    // boundary rule the backend enforces. Fallback: a value that occurs in the
    // combined text but in none of the fullTexts individually (it straddles the
    // "=== Document ===" separator) saves to all - over-redaction is the safe
    // direction, silently saving nowhere is not.
    const owners = docIds.filter((id) => {
      const d = getDocument(id);
      return d ? occursIn(getDocumentText(d), resolved.value) : false;
    });
    for (const id of owners.length ? owners : docIds) {
      addDocumentRedactTerm(id, resolved.value);
    }
    return resolved;
  }

  // Manually redact a selection in the retrieved Memory/Documents context.
  function redactContextSelection(): ManualRedactError | null {
    if (!pendingReview?.rag) return null;
    const r = pendingReview.rag;
    const item = manualRedactionFor(buildSentText(r.base, r.items));
    if (typeof item === "string") return item;
    setPendingReview((pr) =>
      pr && pr.rag ? { ...pr, rag: { ...pr.rag, items: [...pr.rag.items, item] } } : pr,
    );
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Conversation */}
      <div
        ref={scrollRef}
        onScroll={onConversationScroll}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.map((m, i) =>
          m.role === "user" ? (
            <UserBubble
              key={m.id}
              msg={m}
              showOriginal={showOriginal}
              onToggleShowOriginal={toggleShowOriginal}
              onboardingCallout={
                showOnboardingCallout && m.id === lastUserMsg?.id
                  ? { onDismiss: advanceOnboardingFromCallout }
                  : undefined
              }
              onResendWithoutFilter={resendWithoutFilter}
              resendDisabled={loading || pendingReview != null || isGenerating(activeIdRef.current)}
            />
          ) : (
            <AssistantBubble
              key={m.id}
              messageId={m.id}
              text={m.text}
              rawText={m.rawText}
              reasoning={m.reasoning}
              model={m.model}
              showOriginal={showOriginal}
              isError={m.isError}
              streamInterrupted={m.streamInterrupted}
              streaming={m.id === streamingId}
              dismissedArtifacts={m.dismissedArtifacts}
              images={m.images}
              sources={m.sources}
              toolRedactions={m.toolRedactions}
              artifactProjectId={scope}
              onDismissArtifact={dismissArtifact}
              onRetry={
                (m.isError || m.streamInterrupted) && i === messages.length - 1 && !loading
                  ? retryAfterError
                  : undefined
              }
            />
          ),
        )}
        {showOnboardingIntro && (
          <AssistantBubble
            messageId={-1}
            text={t("chat.onboardingIntroMessage")}
            showOriginal={showOriginal}
          />
        )}
        {loading && loadingPhase && (
          <LoadingIndicator phase={loadingPhase} progress={scrubProgress} t={t} />
        )}
        {/* Scroll anchor: kept in view by the auto-scroll effect. */}
        <div ref={bottomRef} />
      </div>

      {onboardingStep === 2 && (
        <OnboardingTeaserCard
          onShowReview={() => setProtection(reviewBeforeSend ? "local" : "review")}
          onDismiss={() => {
            /* dismissOnboardingTeaser() already ran the store update; nothing else to do */
          }}
        />
      )}

      {/* Controls + composer in one bordered block (a single divider from the
          conversation, no double padding). Redaction feedback moved onto each
          message bubble (see UserBubble), so this bottom chrome stays compact. */}
      <div className="border-t border-quon-border px-4 pt-2 pb-3">
        {/* Nothing in this row shrinks; when the pills don't fit, the row
            scrolls horizontally instead. A shrinkable model trigger gets
            crushed by every pill added later (label collapsed to a black
            circle, Bot icon rendered outside the pill border). mx-auto on the
            inner flex keeps it centered while it fits and left-aligned (fully
            reachable) once it overflows. */}
        <div
          data-testid="chat-controls-row"
          className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="mx-auto flex w-max flex-nowrap items-center gap-1.5">
            <Select value={effectiveModelId} onValueChange={setModel}>
              {/* max-w keeps a long model label from eating the whole row on a
                phone - the base trigger's [&>span]:line-clamp-1 truncates it;
                the shrink-0 Bot icon keeps the chip legible as "the model
                button" even at max truncation. */}
              <SelectTrigger className="h-7 w-auto max-w-40 shrink-0 justify-center gap-1 rounded-full border-quon-border bg-quon-surface px-2.5 text-xs font-semibold text-quon-text [&_svg]:shrink-0">
                <Bot className="h-3.5 w-3.5 shrink-0 text-quon-indigo" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-quon-border bg-quon-surface text-quon-text">
                {models.map((m) => {
                  const d = chatModelDisplay(m);
                  return (
                    <SelectItem
                      key={m.id}
                      value={m.id}
                      disabled={m.disabled}
                      className="py-2 text-sm"
                      title={m.model ?? m.id}
                    >
                      <span className="flex w-full items-center gap-2">
                        <span className="truncate">{d.name}</span>
                        {m.image_output && (
                          <span
                            className="shrink-0 rounded-full bg-quon-indigo/15 px-1.5 text-[10px] font-semibold text-quon-indigo"
                            data-testid="image-model-badge"
                          >
                            {t("chat.imageModelBadge")}
                          </span>
                        )}
                        {showProviderTag(d) && (
                          <span className="shrink-0 text-[10px] text-quon-muted">{d.provider}</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {/* divider between model picker and protection pills */}
            <span className="mx-0.5 h-4 w-px shrink-0 bg-quon-border" />
            {/* Filter toggle pill (green = on, red = off) */}
            <button
              onClick={() =>
                setProtection(filterActive ? "none" : reviewBeforeSend ? "review" : "local")
              }
              aria-pressed={filterActive}
              title={filterActive ? t("chat.filterOnTitle") : t("chat.filterOffTitle")}
              className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                filterActive
                  ? "border-quon-green/30 bg-quon-green/10 text-quon-green"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
              {filterActive ? t("chat.filterOnLabel") : t("chat.filterOffLabel")}
            </button>
            {/* Review pill - only visible when filter is on */}
            {filterActive && (
              <button
                onClick={() => setProtection(reviewBeforeSend ? "local" : "review")}
                aria-pressed={reviewBeforeSend}
                title={reviewBeforeSend ? t("chat.reviewOnTitle") : t("chat.reviewOffTitle")}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                  reviewBeforeSend
                    ? "border-quon-indigo/40 bg-quon-indigo/10 text-quon-indigo"
                    : "border-quon-border bg-quon-surface text-quon-muted hover:text-quon-text"
                }`}
              >
                <Lock className="h-3.5 w-3.5 shrink-0" /> {t("chat.reviewLabel")}
              </button>
            )}
            {/* Context (RAG) pill - only when there is saved Memory/Documents. When
              it's off while saved data exists, a small amber dot signals that the
              user has memory/documents that WON'T be used (the honest "why didn't
              it use my saved info?" affordance) - passive, not a per-send nag. */}
            {hasContextData && (
              <button
                onClick={() => quon.setUseMemoryContext(!useMemoryContext)}
                aria-pressed={useMemoryContext}
                title={useMemoryContext ? t("chat.contextOnTitle") : t("chat.contextOffTitle")}
                className={`relative inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                  useMemoryContext
                    ? "border-quon-indigo/40 bg-quon-indigo/10 text-quon-indigo"
                    : "border-quon-border bg-quon-surface text-quon-muted hover:text-quon-text"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" /> {t("chat.contextLabel")}
                {!useMemoryContext && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-quon-yellow ring-2 ring-quon-bg"
                  />
                )}
              </button>
            )}
            {/* Explainer for the Kontext pill above - a sibling, not nested inside
              its button (InfoHint is its own tap target with its own Popover; two
              interactive elements can't nest). Same text as the Settings row
              (ContextDefaultCard), so "what does Kontext mean?" answers the same
              way wherever it's asked. */}
            {hasContextData && <InfoHint text={t("chat.contextInfoHint")} />}
            {/* Web-search pill - OpenRouter's agentic server tool: the MODEL
              decides when to search (queries derive from the scrubbed prompt
              only). Global synced pref, default on. Absent in EU routing. */}
            {webSearchAvailable && (
              <button
                onClick={() => quon.setWebSearchEnabled(!webSearchEnabled)}
                aria-pressed={webSearchEnabled}
                title={webSearchEnabled ? t("chat.webOnTitle") : t("chat.webOffTitle")}
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                  webSearchEnabled
                    ? "border-quon-indigo/40 bg-quon-indigo/10 text-quon-indigo"
                    : "border-quon-border bg-quon-surface text-quon-muted hover:text-quon-text"
                }`}
              >
                <Globe className="h-3.5 w-3.5 shrink-0" /> {t("chat.webLabel")}
              </button>
            )}
            {/* Overflow menu - currently just the reasoning-effort picker, kept out of
              the always-visible row so Filter/Review/Context/model stay the
              compact, primary controls. Effective = per-chat override ?? global
              default. The trigger carries a small indicator (the effort's first
              letter) whenever a non-default budget is active, so the state isn't
              hidden behind the "...". */}
            {(() => {
              const reasoningOptions = getReasoningOptions(t);
              const effective = chatEffortOverride ?? reasoningEffort;
              const active = effective !== "off";
              const activeLabel = reasoningOptions.find((o) => o.value === effective)?.label;
              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={t("chat.moreChatOptionsAria")}
                      title={
                        chatEffortOverride
                          ? t("chat.reasoningEffortTitleThisChat", {
                              level: activeLabel ?? t("chat.reasoningOff"),
                            })
                          : t("chat.reasoningEffortTitle", {
                              level: activeLabel ?? t("chat.reasoningOff"),
                            })
                      }
                      className={`inline-flex h-6 shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full border px-1.5 text-[11px] font-medium transition ${
                        active
                          ? "border-quon-indigo/40 bg-quon-indigo/10 text-quon-indigo"
                          : "border-quon-border bg-quon-surface text-quon-muted hover:text-quon-text"
                      }`}
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
                      {active && <span className="font-semibold">{activeLabel!.charAt(0)}</span>}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="end" className="w-56">
                    {/* Plain div instead of DropdownMenuLabel so the explainer
                      ("kostet das auch mehr Token?") can sit beside the heading;
                      same text as the Settings row (ReasoningDefaultCard). */}
                    <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-quon-muted">
                        {t("chat.reasoningEffortHeading")}
                      </span>
                      <InfoHint text={t("chat.reasoningInfoHint")} />
                    </div>
                    {reasoningOptions.map((o) => (
                      <DropdownMenuItem
                        key={o.value}
                        onSelect={() => setChatEffortOverride(o.value)}
                        className={effective === o.value ? "text-quon-indigo" : ""}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{o.label}</span>
                          <span className="text-[10px] text-quon-muted">{o.hint}</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            })()}
          </div>
        </div>
        <ProtectionLine status={status} protectionLevel={effectiveProtectionLevel} />

        {/* Composer (same block - no second border/padding) */}
        <div className="mt-2">
          {budgetHintPct !== null && (
            <Notice
              variant="warning"
              className="mb-2"
              onDismiss={() => {
                setBudgetHintPct(null);
                sessionStorage.setItem(BUDGET_HINT_DISMISSED_KEY, "1");
              }}
            >
              {t("chat.budgetHint", { pct: budgetHintPct ?? 0 })}
            </Notice>
          )}
          {sendError && (
            <Notice variant="error" className="mb-2">
              {sendError}
            </Notice>
          )}
          {sendHint && (
            <div data-testid="send-hint">
              <Notice variant="info" className="mb-2">
                {sendHint}
              </Notice>
            </div>
          )}
          {pendingReview ? (
            <ReviewPanel
              modelLabel={modelLabel}
              base={pendingReview.base}
              items={pendingReview.items}
              // Pass the object through - a field-by-field rebuild here is how
              // docIds silently went missing and the durable button vanished.
              attachment={pendingReview.attachment}
              contextItems={pendingReview.rag?.items}
              contextBase={pendingReview.rag?.base}
              contextSourceCount={pendingReview.rag?.sources.length}
              fallbackMode={pendingReview.fallbackMode}
              skipReason={pendingReview.skipReason}
              lowCaseSignal={pendingReview.lowCaseSignal}
              onToggle={toggleReviewItem}
              onToggleAttachment={toggleAttachmentItem}
              onToggleContext={toggleContextItem}
              onRedactSelection={redactSelection}
              onRedactAttachmentSelection={redactAttachmentSelection}
              onRedactAttachmentAlways={redactAttachmentAlways}
              onRedactContextSelection={redactContextSelection}
              onOpenOriginal={
                pendingReview.attachment && attachment ? openAttachmentPreview : undefined
              }
              onEdit={cancelReview}
              onSend={confirmSend}
            />
          ) : (
            <>
              {(attachment || attaching) && (
                <div
                  data-testid="staged-attachment"
                  className="mb-2 flex w-fit max-w-full items-center gap-1.5 rounded-lg border border-quon-border bg-quon-surface-2 px-2 py-1 text-[11px] text-quon-muted"
                >
                  <FileText className="h-3 w-3 shrink-0 text-quon-indigo" />
                  {attaching ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" /> {t("chat.reading")}
                    </span>
                  ) : (
                    <>
                      <span className="max-w-[200px] truncate">{attachment?.name}</span>
                      {attachment?.source === "paperless" && (
                        <span
                          className="whitespace-nowrap text-quon-indigo"
                          title={t("chat.attachmentFromPaperlessTooltip")}
                        >
                          {t("chat.attachmentFromPaperless")}
                        </span>
                      )}
                      {attachment?.truncated && (
                        <span
                          className="text-quon-yellow"
                          title={
                            attachment.combined
                              ? t("chat.attachmentTruncatedCombinedTooltip", {
                                  n: ATTACHMENT_CHAR_BUDGET.toLocaleString(),
                                })
                              : t("chat.attachmentTruncatedTooltip", {
                                  n: ATTACHMENT_CHAR_BUDGET.toLocaleString(),
                                })
                          }
                        >
                          {attachment.combined
                            ? t("chat.shortenedToFitBadge")
                            : t("chat.truncatedBadge")}
                        </span>
                      )}
                      {/* Check what the filter finds and redact by hand
                          before the send - Filter mode included, not just
                          Review. A visible label, not an icon alone. */}
                      <button
                        onClick={openAttachmentPreview}
                        title={t("chat.previewAttachmentTitle")}
                        data-testid="attachment-preview"
                        className="ml-1 flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 font-semibold text-quon-indigo transition hover:bg-quon-indigo/10"
                      >
                        <ScanSearch className="h-3 w-3" />
                        {t("chat.previewAttachment")}
                      </button>
                      <button
                        onClick={() => setAttachment(null)}
                        className="ml-0.5 text-quon-muted hover:text-quon-text"
                        aria-label={t("chat.removeAttachmentAria")}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </>
                  )}
                </div>
              )}
              <div className="flex items-end gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      disabled={loading || attaching}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-quon-muted transition hover:bg-quon-surface-2 hover:text-quon-text disabled:opacity-40"
                      aria-label={t("chat.attachDocumentAria")}
                    >
                      <Paperclip className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent side="top" align="start" className="w-52">
                    <DropdownMenuItem
                      onSelect={() => setTimeout(() => attachInputRef.current?.click(), 0)}
                    >
                      <Upload className="h-3.5 w-3.5" /> {t("chat.uploadFromDevice")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setTimeout(() => cameraInputRef.current?.click(), 0)}
                    >
                      <Camera className="h-3.5 w-3.5" /> {t("chat.takeAPhoto")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => setTimeout(() => scanInputRef.current?.click(), 0)}
                    >
                      <ImageIcon className="h-3.5 w-3.5" /> {t("chat.scanFromGallery")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setTimeout(() => setPickerOpen(true), 0)}>
                      <FolderOpen className="h-3.5 w-3.5" /> {t("chat.chooseFromDocuments")}
                    </DropdownMenuItem>
                    {paperlessConfigured && (
                      <DropdownMenuItem
                        onSelect={() => setTimeout(() => setPaperlessPickerOpen(true), 0)}
                      >
                        <Archive className="h-3.5 w-3.5" /> {t("chat.fromPaperless")}
                      </DropdownMenuItem>
                    )}
                    {readyDocs.length > 1 && (
                      <DropdownMenuItem onSelect={() => setTimeout(handleAttachAllDocs, 0)}>
                        <Files className="h-3.5 w-3.5" />{" "}
                        {t("chat.attachAllDocuments", { count: readyDocs.length })}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Photos are accepted here too: an Android picker greys out
                    every JPG when `accept` has no image type, which reads as
                    "images can't be uploaded". They take the same OCR review
                    path as the camera/gallery entries - never extract.ts. */}
                <input
                  ref={attachInputRef}
                  type="file"
                  accept=".txt,.md,.csv,.json,.html,.pdf,.docx,text/*,application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && isImageFile(f)) enqueueScans(e.target.files);
                    else if (f) void handleAttach(f);
                    e.target.value = "";
                  }}
                />
                {/* Two image inputs feeding the same on-device OCR review dialog:
                    "Take a photo" carries `capture="environment"` so mobile opens
                    the rear camera directly; "Scan from gallery" stays capture-free
                    to pick an existing photo. (On desktop `capture` is ignored, so
                    both just open a file dialog.) */}
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    enqueueScans(e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={scanInputRef}
                  type="file"
                  accept="image/*"
                  // `multiple`: the gallery lets you tick several screenshots
                  // either way - without it the browser hands over only the
                  // first and the rest vanish silently (reported).
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    enqueueScans(e.target.files);
                    e.target.value = "";
                  }}
                />
                <DocumentPicker
                  open={pickerOpen}
                  onClose={() => setPickerOpen(false)}
                  onPick={handleAttachFromDocs}
                  projectId={scope}
                />
                {paperlessConfigured && paperlessConnector.browse && (
                  <RemoteDocPicker
                    open={paperlessPickerOpen}
                    onClose={() => setPaperlessPickerOpen(false)}
                    browse={paperlessConnector.browse}
                    sourceName={paperlessConnector.name}
                    onPick={(picked) => {
                      // Same staging path as handleAttach - the text then goes
                      // through the identical scrub-before-send pipeline. The
                      // source marker only drives the honesty label on the chip.
                      const docs = picked
                        .map((d) => ({ name: d.name, text: d.text.trim() }))
                        .filter((d) => d.text.length > 0);
                      if (!docs.length) {
                        setSendError(t("chat.errorNoReadableText"));
                        return;
                      }
                      setSendError(null);
                      if (docs.length === 1) {
                        const clean = docs[0].text;
                        setAttachment({
                          name: docs[0].name,
                          text: clean.slice(0, ATTACHMENT_CHAR_BUDGET),
                          truncated: clean.length > ATTACHMENT_CHAR_BUDGET,
                          source: "paperless",
                        });
                        return;
                      }
                      // Several live documents share one budget, exactly like a
                      // multi-pick from the local store.
                      const { text, truncated } = combineDocuments(docs, ATTACHMENT_CHAR_BUDGET);
                      setAttachment({
                        name: t("chat.selectedDocumentsCombined", { count: docs.length }),
                        text,
                        truncated,
                        combined: true,
                        source: "paperless",
                      });
                    }}
                  />
                )}
                <PhotoScanDialog
                  file={scanQueue.files[0] ?? null}
                  queue={{
                    index: scanQueue.total - scanQueue.files.length + 1,
                    total: scanQueue.total,
                  }}
                  // Cancel skips this photo and moves on - the ones already
                  // reviewed are still staged when the batch ends.
                  onClose={advanceScan}
                  autoAccept={autoAcceptScans}
                  onAcceptAll={() => setAutoAcceptScans(true)}
                  attachMode={{
                    // Collect only - the dialog calls onClose() right after
                    // onAttach, and that is what advances. Advancing here too
                    // would silently skip the next photo of the batch.
                    onAttach: ({ filename, text }) => {
                      const clean = text.trim();
                      if (clean) scanned.current.push({ name: filename, text: clean });
                    },
                  }}
                />
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (sendError) setSendError(null);
                    if (sendHint) setSendHint(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  placeholder={
                    showOnboardingIntro ? t("chat.onboardingPlaceholder") : t("chat.placeholder")
                  }
                  className="max-h-[6.25rem] min-h-[1.25rem] flex-1 resize-none bg-transparent text-sm leading-5 text-quon-text placeholder:text-quon-muted focus:outline-none"
                />
                {/* The keyboard's dictation types straight into the field, so
                    this button never returns text and never errors - it only
                    explains where that key is on this device. */}
                <DictationButton
                  disabled={loading}
                  onHint={(message) => {
                    setSendError(null);
                    setSendHint(message);
                  }}
                />
                {loading ? (
                  <button
                    onClick={stopGeneration}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-quon-indigo text-white transition hover:bg-quon-indigo-hover"
                    aria-label={t("chat.stopGeneratingAria")}
                    title={t("chat.stopAndEditTitle")}
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    onClick={() => void send()}
                    disabled={!input.trim()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-quon-indigo text-white transition hover:bg-quon-indigo-hover disabled:opacity-40"
                    aria-label={t("chat.sendAria")}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* "Original ansehen & schwärzen" from Review: the real viewer (rendered
          PDF pages, TextLayer selection) for the attached library document.
          TOP level on purpose - it must render while the Review panel is open,
          and the composer branch it first landed in is the ternary's other arm,
          so it mounted only when review was closed: a visibly dead button. */}
      <DocumentViewer
        doc={reviewViewerDoc}
        adhoc={previewAdhoc}
        onClose={closeAttachmentPreview}
        onRedactForSend={redactForSend}
      />

      {/* MCP tool consent - nothing executes without an explicit yes. */}
      {toolConsent && (
        <ToolConsentDialog
          items={toolConsent.items}
          untrusted={toolConsent.untrusted}
          onDecide={(approved, always) => toolConsent.resolve({ approved, always })}
        />
      )}
    </div>
  );
}

/** Consent gate for tool calls (MCP + first-party): shows the tool + its
 *  REHYDRATED arguments (the user must see what actually leaves/gets written),
 *  with an optional per-tool "always allow" - hidden entirely when a write
 *  tool is present (writes are per-action only; see chat-agentic-tools.md).
 *  Deny is the safe default action. */
function ToolConsentDialog({
  items,
  untrusted,
  onDecide,
}: {
  items: ToolConsentItem[];
  untrusted: boolean;
  onDecide: (approved: boolean, always: boolean) => void;
}) {
  const { t } = useT();
  const [always, setAlways] = useState(false);
  const hasWrite = items.some((i) => i.write);
  return (
    <Dialog open onOpenChange={(o) => !o && onDecide(false, false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">{t("chat.toolConsentTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-quon-muted">{t("chat.toolConsentIntro")}</p>
        {/* Injection guard: a write following untrusted content this turn gets
            an explicit provenance warning - never silent (lethal trifecta). */}
        {hasWrite && untrusted && (
          <div className="rounded-lg border border-quon-yellow/40 bg-quon-yellow/10 px-2.5 py-2 text-[11px] text-quon-yellow">
            {t("chat.toolConsentUntrusted")}
          </div>
        )}
        <div className="max-h-60 space-y-2 overflow-y-auto">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-quon-border bg-quon-surface-2 p-2.5"
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-quon-text">
                {friendlyToolName(item.tool, t)}{" "}
                <span className="font-normal text-quon-muted">
                  · {item.serverId === "quon" ? "QUON" : item.serverId}
                </span>
                {item.write && (
                  <span className="ml-auto rounded-full border border-quon-yellow/40 bg-quon-yellow/10 px-1.5 py-0.5 text-[9px] font-semibold text-quon-yellow">
                    {t("chat.toolConsentWriteBadge")}
                  </span>
                )}
              </div>
              {(() => {
                // A friendly one-value summary for the known first-party tools
                // (still the real value - the write-consent guarantee); raw JSON
                // only for tools we can't summarize (MCP / complex args).
                const summary = summarizeToolArgs(item.tool, item.argsDisplay, lookupTitle);
                return summary ? (
                  // pre-wrap: multi-line summaries (one move per line, a file's
                  // full content) must read as written, not as one run-on line.
                  <p className="mt-1 break-words whitespace-pre-wrap text-xs text-quon-text">
                    {summary}
                  </p>
                ) : (
                  <pre
                    className={`mt-1 overflow-auto whitespace-pre-wrap break-all text-[10px] text-quon-muted ${
                      item.write ? "max-h-48" : "max-h-24"
                    }`}
                  >
                    {item.argsDisplay}
                  </pre>
                );
              })()}
            </div>
          ))}
        </div>
        {!hasWrite && (
          <label className="flex items-center gap-2 text-[11px] text-quon-muted">
            <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
            {t("chat.toolConsentAlways")}
          </label>
        )}
        <p className="text-[10px] text-quon-muted">{t("chat.toolConsentPrivacy")}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => onDecide(false, false)}
            className="rounded-lg border border-quon-border px-3 py-1.5 text-xs text-quon-muted hover:text-quon-text"
          >
            {t("chat.toolConsentDeny")}
          </button>
          <button
            onClick={() => onDecide(true, always)}
            className="rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white hover:bg-quon-indigo-hover"
          >
            {t("chat.toolConsentAllow")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProtectionLine({
  status,
  protectionLevel,
}: {
  status: ReturnType<typeof useQuonHealth>["status"];
  protectionLevel: "none" | "local" | "review" | "full";
}) {
  const { t } = useT();
  // When filter is off, show nothing here - the toggle pill above already signals it.
  if (protectionLevel === "none") return null;

  if (status === "offline") {
    return (
      <div className="mt-1 text-[10px] text-red-400">
        <AlertTriangle className="mr-0.5 inline h-3 w-3" /> {t("chat.scrubberOffline")}
      </div>
    );
  }
  if (status === "fallback") {
    return (
      <div className="mt-1 text-[10px] text-quon-yellow">{t("chat.reducedDetectionActive")}</div>
    );
  }
  return null; // filter active and scrubber healthy - the toggle pill is enough
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type HighlightSegment = string | { match: string; type: string };

/**
 * Split `text` into plain strings and highlighted PII segments. In the original
 * view the detected values are matched; in the anonymized view their placeholders
 * are. Longer needles are tried first so a full name wins over its first name.
 */
function highlightSegments(
  text: string,
  entities: Entity[],
  showOriginal: boolean,
): HighlightSegment[] {
  const seen = new Set<string>();
  const needles: { needle: string; type: string }[] = [];
  for (const e of entities) {
    const needle = showOriginal ? e.value : e.placeholder;
    if (!needle || seen.has(needle)) continue;
    seen.add(needle);
    needles.push({ needle, type: e.type });
  }
  if (needles.length === 0) return [text];
  needles.sort((a, b) => b.needle.length - a.needle.length);
  const typeByNeedle = new Map(needles.map((n) => [n.needle, n.type]));
  const re = new RegExp(`(${needles.map((n) => escapeRegExp(n.needle)).join("|")})`, "g");

  const out: HighlightSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ match: m[0], type: typeByNeedle.get(m[0]) ?? "" });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders message text with detected PII marked (works on the indigo bubble). */
function HighlightedText({
  text,
  entities,
  showOriginal,
}: {
  text: string;
  entities: Entity[];
  showOriginal: boolean;
}) {
  const { t } = useT();
  const segments = highlightSegments(text, entities, showOriginal);
  return (
    <>
      {segments.map((seg, i) =>
        typeof seg === "string" ? (
          seg
        ) : (
          <span
            key={i}
            title={`${entityStyle(seg.type).label} — ${
              showOriginal ? t("chat.removedBeforeSending") : t("chat.anonymizedTooltip")
            }`}
            className="rounded-[3px] bg-quon-yellow/30 px-0.5 text-white ring-1 ring-inset ring-quon-yellow/40"
          >
            {seg.match}
          </span>
        ),
      )}
    </>
  );
}

const UserBubble = memo(function UserBubble({
  msg,
  showOriginal,
  onToggleShowOriginal,
  onboardingCallout,
  onResendWithoutFilter,
  resendDisabled,
}: {
  msg: ChatMessage;
  showOriginal: boolean;
  onToggleShowOriginal: () => void;
  /** Only set on the last user bubble during onboarding step 1 - pulses the
   *  status line and floats the callout that points at it. */
  onboardingCallout?: { onDismiss: () => void };
  /** Resends this message's original (pre-scrub) text as a new, unfiltered turn.
   *  Omitted on a message that is itself already unfiltered - there is no
   *  "un-scrubbed original" left to fall back to that would differ from it. */
  onResendWithoutFilter?: (original: string) => void;
  /** True while a generation is already running for this chat - the action is
   *  disabled rather than hidden, same rule the composer's send button follows. */
  resendDisabled?: boolean;
}) {
  const { t, plural } = useT();
  const [open, setOpen] = useState(false);
  // Text highlighting marks only the TYPED message's PII (attachment/RAG/
  // instruction entities aren't in the bubble text). The redaction SUMMARY and
  // the detail list cover everything redacted before sending.
  const typed = msg.entities ?? [];
  const allEntities = [
    ...typed,
    ...(msg.attachment?.entities ?? []),
    ...(msg.rag?.entities ?? []),
    ...(msg.instruction?.entities ?? []),
  ];
  const total = allEntities.length;
  const shownText = showOriginal ? msg.text : (msg.scrubbed ?? msg.text);
  // The status line opens the per-message detail when there's something to show
  // (redactions, the fallback-mode explanation, or the resend action). N=0
  // protected sends stay a plain, unclickable line - no chevron suggesting
  // hidden content. An unfiltered send never has entities/fallbackMode, so it
  // never opens - it's a one-line fact, not a panel.
  const hasDetail = total > 0 || !!msg.fallbackMode;
  // Degraded detection: AI enrichment was skipped for this send, so only names
  // + patterns were caught - items a context-dependent LLM pass would have
  // caught can be missed. Saying "N redacted" in the same success tone as a
  // fully-protected send reads as reassurance exactly when it should read as a
  // warning. Only applies when the send was otherwise protected - an
  // already-flagged unfiltered/unprotected send keeps its own (already
  // explicit) wording.
  const degraded = !!msg.fallbackMode && !msg.unfiltered && msg.protected !== false;

  const itemsRedactedText = plural(total, {
    one: "chat.itemsRedactedOne",
    other: "chat.itemsRedactedOther",
  });
  const statusInner = msg.unfiltered ? (
    <>
      <ShieldOff className="h-2.5 w-2.5" /> {t("chat.sentWithoutFilter")}
    </>
  ) : msg.protected === false ? (
    <>
      <AlertTriangle className="h-2.5 w-2.5" /> {t("chat.sentUnprotected")}
    </>
  ) : degraded ? (
    <>
      <ShieldAlert className="h-2.5 w-2.5" />
      {total > 0
        ? t("chat.itemsRedactedDegraded", { items: itemsRedactedText })
        : t("chat.noPersonalDataFoundDegraded")}
    </>
  ) : total > 0 ? (
    <>
      <Lock className="h-2.5 w-2.5" /> {itemsRedactedText}
    </>
  ) : (
    <>
      <ShieldCheck className="h-2.5 w-2.5" /> {t("chat.noPersonalDataFound")}
    </>
  );
  const statusToneClass = degraded ? "text-quon-yellow" : "text-white/70";

  return (
    <div className={`flex flex-col items-end gap-1 ${onboardingCallout ? "relative" : ""}`}>
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-quon-indigo px-3.5 py-2.5 text-left text-sm leading-relaxed whitespace-pre-line text-white">
        {typed.length > 0 ? (
          <HighlightedText text={shownText} entities={typed} showOriginal={showOriginal} />
        ) : (
          shownText
        )}
        <motion.div
          className="mt-1.5"
          animate={onboardingCallout ? { scale: [1, 1.04, 1] } : undefined}
          transition={{ duration: 0.8, times: [0, 0.5, 1] }}
        >
          {hasDetail ? (
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={`flex items-center gap-1 text-[10px] transition hover:text-white ${statusToneClass}`}
            >
              {statusInner}
              <ChevronDown
                className={`h-2.5 w-2.5 transition-transform ${open ? "" : "-rotate-90"}`}
              />
            </button>
          ) : (
            <div className={`flex items-center gap-1 text-[10px] ${statusToneClass}`}>
              {statusInner}
            </div>
          )}
        </motion.div>
      </div>
      {onboardingCallout && (
        <OnboardingCallout
          count={total}
          fallbackMode={degraded}
          onDismiss={onboardingCallout.onDismiss}
        />
      )}
      {open && hasDetail && (
        <RedactionDetail
          className="max-w-[85%]"
          entities={allEntities}
          fallbackMode={msg.fallbackMode}
          skipReason={msg.skipReason}
          lowCaseSignal={msg.lowCaseSignal}
          showOriginal={showOriginal}
          onToggleShowOriginal={onToggleShowOriginal}
          // Only offered on a message that actually had something redacted, and
          // never on one that is itself already an unfiltered resend (nothing
          // left to fall back to that would send anything different).
          onResendWithoutFilter={
            total > 0 && !msg.unfiltered && onResendWithoutFilter
              ? () => onResendWithoutFilter(msg.text)
              : undefined
          }
          resendDisabled={resendDisabled}
          onNeverRedact={(value: string) =>
            quon.setNeverRedact(withNeverRedacted(getQuonState().neverRedact, value))
          }
        />
      )}
      {msg.attachment ? (
        <AttachmentChip attachment={msg.attachment} protectedSend={msg.protected !== false} />
      ) : null}
      {msg.rag?.sources?.length ? (
        <RagChip sources={msg.rag.sources} />
      ) : msg.contextEmpty ? (
        <span className="flex items-center gap-1 text-[10px] text-quon-muted">
          <Sparkles className="h-2.5 w-2.5" /> {t("chat.contextNoneMatched")}
        </span>
      ) : null}
    </div>
  );
});

function RagChip({ sources }: { sources: NonNullable<ChatMessage["rag"]>["sources"] }) {
  const { t, plural } = useT();
  const [open, setOpen] = useState(false);
  const memCount = sources.filter((s) => s.kind === "memory").length;
  const docCount = sources.filter((s) => s.kind === "document").length;
  const parts: string[] = [];
  if (memCount)
    parts.push(plural(memCount, { one: "chat.memoriesOne", other: "chat.memoriesOther" }));
  if (docCount)
    parts.push(plural(docCount, { one: "chat.docSnippetsOne", other: "chat.docSnippetsOther" }));

  return (
    <div className="max-w-[85%]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full border border-quon-indigo/30 bg-quon-indigo/10 px-2 py-0.5 text-[10px] text-quon-indigo transition hover:bg-quon-indigo/20"
      >
        <Sparkles className="h-2.5 w-2.5" /> {t("chat.contextUsed", { parts: parts.join(" · ") })}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5 rounded-lg border border-quon-border bg-quon-surface p-2">
          {sources.map((s, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[10px] text-quon-muted">
              {s.kind === "memory" ? (
                <Brain className="mt-0.5 h-3 w-3 shrink-0 text-quon-indigo" />
              ) : (
                <FileText className="mt-0.5 h-3 w-3 shrink-0 text-quon-indigo" />
              )}
              <div className="min-w-0">
                <span className="font-semibold text-quon-text">{s.title}</span>
                <span className="ml-1 rounded bg-quon-surface-2 px-1 text-[9px] tabular-nums text-quon-muted">
                  {s.score.toFixed(2)}
                </span>{" "}
                <span>{s.snippet.length > 140 ? `${s.snippet.slice(0, 140)}…` : s.snippet}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Attachment chip on the user bubble. Expands to show exactly what personal data
 *  was removed from the document before it was sent (or warns if it went raw). */
function AttachmentChip({
  attachment,
  protectedSend,
}: {
  attachment: NonNullable<ChatMessage["attachment"]>;
  protectedSend: boolean;
}) {
  const { t, plural } = useT();
  const [open, setOpen] = useState(false);
  const entities = attachment.entities ?? [];
  const count = entities.length;

  return (
    <div className="max-w-[85%]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-full border border-quon-indigo/30 bg-quon-indigo/10 px-2 py-0.5 text-[10px] text-quon-indigo transition hover:bg-quon-indigo/20"
      >
        <FileText className="h-2.5 w-2.5 shrink-0" />
        <span className="max-w-[150px] truncate">{attachment.name}</span>
        {attachment.truncated ? (
          <span
            className="text-quon-yellow"
            title={
              attachment.combined
                ? t("chat.attachmentTruncatedCombinedTooltip", {
                    n: ATTACHMENT_CHAR_BUDGET.toLocaleString(),
                  })
                : t("chat.attachmentTruncatedTooltip", {
                    n: ATTACHMENT_CHAR_BUDGET.toLocaleString(),
                  })
            }
          >
            {attachment.combined ? t("chat.shortenedToFitBadge") : t("chat.truncatedBadge")}
          </span>
        ) : null}
        <span className="text-quon-indigo/50">·</span>
        {!protectedSend ? (
          <span className="flex items-center gap-0.5 text-quon-yellow">
            <AlertTriangle className="h-2.5 w-2.5" /> {t("chat.attachmentUnprotected")}
          </span>
        ) : count > 0 ? (
          <span className="flex items-center gap-0.5">
            <Lock className="h-2.5 w-2.5" />{" "}
            {plural(count, { one: "chat.itemsRemovedOne", other: "chat.itemsRemovedOther" })}
          </span>
        ) : (
          <span className="flex items-center gap-0.5">
            <ShieldCheck className="h-2.5 w-2.5" /> {t("chat.attachmentClean")}
          </span>
        )}
      </button>
      {open ? (
        <div className="mt-1 rounded-lg border border-quon-border bg-quon-surface p-2 text-[10px]">
          {!protectedSend ? (
            <div className="text-quon-yellow">{t("chat.attachmentSentUnfiltered")}</div>
          ) : count === 0 ? (
            <div className="text-quon-muted">{t("chat.attachmentNoPersonalData")}</div>
          ) : (
            <>
              <div className="mb-1 text-quon-muted">{t("chat.attachmentReplacedHeader")}</div>
              <ul className="space-y-1">
                {entities.map((e, i) => {
                  const st = entityStyle(e.type);
                  return (
                    <li key={i} className="flex items-center gap-1.5">
                      <span
                        className={`shrink-0 rounded border px-1 text-[9px] font-medium ${st.chip}`}
                      >
                        {st.label}
                      </span>
                      <span className="truncate text-quon-text" title={e.value}>
                        {e.value}
                      </span>
                      <span className="shrink-0 text-quon-muted">→</span>
                      <span className="shrink-0 font-mono text-quon-indigo">{e.placeholder}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What the filter removed from TOOL RESULTS, under the answer they produced.
 *
 * Tool results have always been scrubbed (fail-closed) before re-entering the
 * relay, but the redaction was invisible: the only privacy readout in the chat
 * sits on the USER bubble and sums the typed turn plus its attachment / RAG /
 * instruction. So an exchange that pulled seven Paperless documents through the
 * filter still displayed "no personal data found" - literally true of the four
 * words typed, and exactly the wrong impression about the exchange.
 *
 * Grouped per call, in call order, so each group lines up with its "..." marker
 * in the answer above. The list mirrors AttachmentChip's `value -> [PLACEHOLDER]`
 * rows deliberately: a redaction should read the same wherever it is shown.
 */
function ToolRedactionFooter({ groups }: { groups: ToolRedaction[] }) {
  const { t, plural } = useT();
  const [open, setOpen] = useState(false);
  const total = groups.reduce((n, g) => n + g.entities.length, 0);
  return (
    <div className="mt-2 border-t border-quon-border pt-2">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[10px] text-quon-muted transition hover:text-quon-text"
      >
        <Lock className="h-2.5 w-2.5 shrink-0" />
        {t("chat.toolRedactedSummary", {
          items: plural(total, { one: "chat.itemsRedactedOne", other: "chat.itemsRedactedOther" }),
          sources: plural(groups.length, {
            one: "chat.toolSourcesOne",
            other: "chat.toolSourcesOther",
          }),
        })}
        <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-2 rounded-lg border border-quon-border bg-quon-surface-2 p-2 text-[10px]">
          {groups.map((g, gi) => (
            <div key={gi}>
              <div className="mb-1 text-quon-muted">
                ⚙ {g.tool} ·{" "}
                {plural(g.entities.length, {
                  one: "chat.itemsRemovedOne",
                  other: "chat.itemsRemovedOther",
                })}
              </div>
              <ul className="space-y-1">
                {g.entities.map((e, i) => {
                  const st = entityStyle(e.type);
                  return (
                    <li key={i} className="flex items-center gap-1.5">
                      <span
                        className={`shrink-0 rounded border px-1 text-[9px] font-medium ${st.chip}`}
                      >
                        {st.label}
                      </span>
                      <span className="truncate text-quon-text" title={e.value}>
                        {e.value}
                      </span>
                      <span className="shrink-0 text-quon-muted">→</span>
                      <span className="shrink-0 font-mono text-quon-indigo">{e.placeholder}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const AssistantBubble = memo(function AssistantBubble({
  messageId,
  text,
  rawText,
  reasoning,
  model,
  showOriginal,
  isError,
  streamInterrupted,
  streaming,
  dismissedArtifacts,
  sources,
  images,
  toolRedactions,
  artifactProjectId,
  onDismissArtifact,
  onRetry,
}: {
  /** Pictures the model generated for this answer. */
  images?: GeneratedImageRef[];
  /** Scope of the chat, so a saved artifact stays in its project. */
  artifactProjectId?: string;
  /** Friendly label of the model that produced this answer (small footer). */
  model?: string;
  /** Web pages the model cited (web search on) - rendered as a Sources strip. */
  sources?: WebSource[];
  /** Per-tool-call record of what the filter stripped out of tool RESULTS during
   *  this turn - rendered as the redaction footer. */
  toolRedactions?: ToolRedaction[];
  messageId: number;
  text: string;
  rawText?: string;
  /** Indices of artifacts the user dismissed - filtered out of the render. */
  dismissedArtifacts?: number[];
  onDismissArtifact?: (messageId: number, index: number) => void;
  /** The model's streamed reasoning ("thinking"), shown in a collapsible panel. */
  reasoning?: string;
  showOriginal?: boolean;
  isError?: boolean;
  /** True when the stream was cut off mid-answer - `text`/`rawText` are the
   *  partial (rehydrated) answer that had already arrived, kept on screen
   *  instead of replaced by an error string. Renders a small trailing note
   *  instead of the full red error treatment, since there is a real (if
   *  incomplete) answer here. */
  streamInterrupted?: boolean;
  /** True while this bubble is still streaming. Markdown renders live, but the
   *  text handed to the parser is throttled (useThrottledValue) so the render
   *  cost stays independent of the token rate. */
  streaming?: boolean;
  /** Set on the last error (or stream-interrupted) bubble: re-sends the
   *  conversation to the provider. */
  onRetry?: () => void;
}) {
  const { t } = useT();
  // "Original" view shows the re-hydrated answer; "anonymized" shows what the
  // provider actually returned (placeholders).
  const shown = showOriginal ? text : (rawText ?? text);
  // Markdown renders live while streaming, but at a bounded rate - see
  // useThrottledValue. ~10 fps is far below a fast model's token rate and
  // indistinguishable from it on screen.
  const throttled = useThrottledValue(shown, 100, !!streaming && !isError);
  // A whole-document ```markdown fence is shown as the document, not as its
  // source - otherwise a reply that is a document reads as raw markup, and
  // stays that way once the save card is dismissed (reported).
  const body = useMemo(() => unwrapMarkdownArtifacts(throttled), [throttled]);
  // Saveable artifacts always come from the re-hydrated `text` (the real
  // content), never the placeholder view - only on a settled (non-streaming,
  // non-error) message.
  const artifacts = useMemo(
    () => (isError || streaming ? [] : detectArtifacts(text)),
    [isError, streaming, text],
  );
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[90%] rounded-2xl rounded-bl-sm border px-3.5 py-2.5 text-sm leading-relaxed ${
          isError
            ? "border-red-500/30 bg-red-500/10 whitespace-pre-line text-red-400"
            : "border-quon-border bg-quon-surface text-quon-text"
        }`}
      >
        {reasoning && !isError && (
          <details
            open={streaming || undefined}
            className="mb-2 rounded-lg border border-quon-border bg-quon-surface-2 px-2.5 py-1.5"
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-quon-muted">
              <Sparkles className="h-3 w-3 text-quon-indigo" />{" "}
              {/* Present tense only while tokens are still arriving - a settled
                  answer with a "Thinking" chip above it reads as if the model is
                  still working (reported). Past tense keeps the panel (and its
                  content) without the false live signal. */}
              {t(streaming ? "chat.thinkingLabel" : "chat.thoughtLabel")}
            </summary>
            <div className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-quon-muted">
              {reasoning}
            </div>
          </details>
        )}
        {isError ? (
          <>
            {shown}
            {onRetry && (
              <button
                onClick={onRetry}
                className="mt-2 flex items-center gap-1.5 rounded-lg border border-red-500/40 px-2.5 py-1 text-xs font-semibold text-red-300 transition hover:bg-red-500/20"
              >
                <RotateCcw className="h-3 w-3" /> {t("common.retry")}
              </button>
            )}
          </>
        ) : (
          <>
            <Markdown streaming={streaming}>{body}</Markdown>
            {images && images.length > 0 && <GeneratedImageStrip images={images} />}
            {sources && sources.length > 0 && <SourcesStrip sources={sources} />}
            {artifacts.map((a, i) =>
              dismissedArtifacts?.includes(i) ? null : (
                <ArtifactCard
                  key={i}
                  artifact={a}
                  messageId={messageId}
                  index={i}
                  defaultProjectId={artifactProjectId}
                  onDismiss={onDismissArtifact ? () => onDismissArtifact(messageId, i) : undefined}
                />
              ),
            )}
            {streamInterrupted && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-quon-border pt-2 text-xs text-quon-yellow">
                <AlertTriangle className="h-3 w-3 shrink-0" /> {t("chat.connectionLost")}
                {onRetry && (
                  <button
                    onClick={onRetry}
                    className="ml-1 inline-flex items-center gap-1 font-semibold text-quon-yellow underline-offset-2 hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" /> {t("common.retry")}
                  </button>
                )}
              </div>
            )}
            {toolRedactions && toolRedactions.length > 0 && (
              <ToolRedactionFooter groups={toolRedactions} />
            )}
            {model && (
              <div className="mt-1.5 text-[10px] text-quon-muted">
                {t("chat.answeredBy", { model })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});
