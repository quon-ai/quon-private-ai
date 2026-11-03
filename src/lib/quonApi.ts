/**
 * Typed client for the QUON scrubber service (quon-scrubber-service).
 *
 * The base URL comes from VITE_QUON_API_URL and defaults to localhost:8000.
 * All calls are browser-side: text is scrubbed locally before anything is sent
 * to a third-party LLM.
 */

import { tr } from "./i18n/i18n";
import { diagAppend } from "./diagLog";
import { getLangPref, hasExplicitLangPref } from "./langPref";
import { http, streamingFetch } from "@/lib/platform";
import { verifyRedactions } from "@/lib/redactSpans";
import { captureCsrf, csrfToken } from "@/lib/api/csrf";

export const QUON_API_URL: string = import.meta.env.VITE_QUON_API_URL ?? "http://localhost:8000";

export const QUON_ENABLED: boolean = (import.meta.env.VITE_QUON_ENABLED ?? "true") !== "false";

export const DEFAULT_PLACEHOLDER_STYLE: PlaceholderStyle =
  (import.meta.env.VITE_QUON_PLACEHOLDER_STYLE as PlaceholderStyle) ?? "typed";

/**
 * Chat models offered in the composer dropdown. `id` is the OpenRouter model
 * slug sent to the (upcoming) /chat endpoint; "Auto" uses OpenRouter's router.
 * `disabled` greys an option out (local models aren't wired yet). Slugs are
 * editable — this is the temporary fixed list until /models is served by the
 * backend.
 */
export interface ChatModel {
  /** Unique dropdown id, composite "<connection_id>::<model slug>". */
  id: string;
  label: string;
  disabled?: boolean;
  /** Which provider connection serves this model. */
  connection_id?: string;
  /** Provider-local model slug sent to the relay. */
  model?: string;
  /** The model can return a generated image (#79) — the picker badges it and
   *  a send asks for `image_output`. */
  image_output?: boolean;
}

export const CHAT_MODELS: ChatModel[] = [
  { label: "Claude Sonnet", id: "~anthropic/claude-sonnet-latest" },
  { label: "Claude Opus", id: "~anthropic/claude-opus-latest" },
  { label: "Gemini Flash", id: "~google/gemini-flash-latest" },
  { label: "Mistral Large", id: "mistralai/mistral-large" },
  { label: "GPT", id: "~openai/gpt-latest" },
  { label: "Local", id: "local", disabled: true },
];

// The pre-catalog placeholder default for brand-new stores. Once the real
// catalog loads, validity correction falls back to the FIRST enabled catalog
// model — so the server-side default list must lead with the same model.
export const DEFAULT_CHAT_MODEL = "~anthropic/claude-sonnet-latest";

// --- Types ----------------------------------------------------------------
export type Language = "auto" | "de" | "en";
export type PlaceholderStyle = "typed" | "generic" | "indexed";

/** Matches canonical indexed placeholders like [PERSON_1], [EMAIL_2], [AMOUNT_3]. */
export const PLACEHOLDER_RE = /\[[A-Z]+_\d+\]/g;

/**
 * Tolerant matcher used only for re-hydration. A model echoing a placeholder back
 * sometimes lightly mutates it — case drift (`[Person_1]`), separator drift
 * (`[PERSON-1]`, `[PERSON 1]`) or inner padding (`[ PERSON_1 ]`). We still want to
 * restore those. (Markdown-bold `**[PERSON_1]**` already matches — the `**` sit
 * outside the brackets.)
 *
 * The SECOND alternative matches a BRACKET-LESS uppercase token (`PERSON_1`): the
 * model regularly drops the brackets when forming a possessive/genitive
 * (`PERSON_1s Bedürfnisse`) or otherwise inlining the token — a real reported bug
 * where the answer showed a raw `PERSON_1` instead of the name. This is safe
 * because a bare match with NO matching map entry is a no-op (returns the token
 * unchanged), so ordinary uppercase_number tokens in text are never altered.
 * Each match is normalized back to the canonical `[TYPE_N]` key before lookup.
 */
const PLACEHOLDER_RE_TOLERANT = /\[\s*([A-Za-z]+)[\s_-]+(\d+)\s*\]|\b([A-Z]{2,})_(\d+)/g;

/**
 * Replace every indexed placeholder using `map` in a single pass (no cascade).
 * Tolerant of light model mutations of the token; a token with no matching map
 * entry is left exactly as-is (never turned into a half-rendered placeholder).
 */
export function applyPlaceholders(text: string, map: Record<string, string>): string {
  return text.replace(
    PLACEHOLDER_RE_TOLERANT,
    (token, bType: string, bIdx: string, uType: string, uIdx: string) => {
      const type = bType ?? uType;
      const index = bIdx ?? uIdx;
      const canonical = `[${type.toUpperCase()}_${index}]`;
      return map[canonical] ?? map[token] ?? token;
    },
  );
}

export interface ScrubOptions {
  language?: Language;
  /** Browser-locale tie-break for language:"auto" — used by the backend ONLY
   *  when the text itself carries zero language evidence (bare noun queries
   *  like "Milchreis Rezept"). Injected automatically by scrubText(). */
  language_hint?: "de" | "en";
  show_entities?: boolean;
  placeholder_style?: PlaceholderStyle;
  /** Words/values the user marked to always redact on-device (case-insensitive). */
  always_redact?: string[];
  /** Allow-list: values that must never be redacted (case-insensitive, whole-value). */
  never_redact?: string[];
  /** Entity types the user turned off; empty/omitted = scrub all. CUSTOM is
   *  always kept server-side. */
  disabled_types?: string[];
}

/**
 * The user's UI language as a scrub-language hint ("de"/"en"), or undefined for
 * any other locale. Sent with every scrub so the backend's zero-evidence
 * fallback routes a bare German noun query ("Milchreis Rezept") through the
 * GERMAN spaCy model instead of hardcoding English — the single biggest
 * real-world PERSON false-positive class. Never overrides actual text signal.
 * SSR-safe: no navigator on the server.
 */
export function browserLanguageHint(): "de" | "en" | undefined {
  // The user's explicit UI-language choice is the strongest tie-break signal.
  if (hasExplicitLangPref()) return getLangPref();
  if (typeof navigator === "undefined") return undefined;
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("de")) return "de";
  if (lang.startsWith("en")) return "en";
  return undefined;
}

export interface Entity {
  type: string;
  value: string;
  placeholder: string;
  confidence: number;
}

export interface ScrubMetadata {
  model_used: string;
  processing_time_ms: number;
  /** true when the optional LLM enrichment did not run (NER + regex may still have caught PII) */
  fallback_mode: boolean;
  language_detected: string;
  /** true when the spaCy/Presidio NER engine ran (person names detectable) */
  ner_used?: boolean;
  /** why the LLM enrichment was skipped, when it was (e.g. "timeout", "budget") */
  skip_reason?: string | null;
  /** true when the input had no upper-case letter — NER names are deferred to the LLM */
  low_case_signal?: boolean;
}

/** Friendly, user-facing reason the AI enrichment step was skipped. */
export function enrichmentSkipReason(reason?: string | null): string | null {
  switch (reason) {
    case "timeout":
      return tr("chat.skip.timeout");
    case "unreachable":
      return tr("chat.skip.unreachable");
    case "auth":
      return tr("chat.skip.auth");
    case "rate_limit":
      return tr("chat.skip.rateLimit");
    case "budget":
      return tr("chat.skip.budget");
    case "provider_error":
      return tr("chat.skip.providerError");
    case "parse":
      return tr("chat.skip.parse");
    case "unconfigured":
      return tr("chat.skip.unconfigured");
    case "disabled":
      return tr("chat.skip.disabled");
    default:
      return null;
  }
}

export interface ScrubResult {
  scrubbed: string;
  original_length: number;
  scrubbed_length: number;
  entities: Entity[];
  metadata: ScrubMetadata;
}

export interface HealthStatus {
  status: string;
  version: string;
  /** true when the spaCy/Presidio NER engine is loaded and ready */
  ner_ready?: boolean;
  /** Active PII extraction backend. "local" now means the whole detection stack
   *  runs in-process (NER + regex + GLiNER), not just Ollama — from the caller's
   *  side both mean the same thing: nothing leaves the box to classify text. */
  /** true when the active PII backend can run right now */
  pii_ready?: boolean;
  /** false when the LLM extraction tier is switched off entirely. Absent on
   *  servers predating the flag, so only an explicit `false` means "off". */
  /** GLiNER is configured as a detector. */
  gliner_enabled?: boolean;
  /** GLiNER's model has actually been loaded (it loads lazily, on first scrub). */
  gliner_loaded?: boolean;
  /** Registration needs an invite code on this instance (SIGNUP_INVITE_CODE is
   *  set). The sign-up form shows its invite field only then. */
  signup_invite_required?: boolean;
  demo_scrub_enabled?: boolean;
  demo_scrub_max_chars?: number;
  /** False when accounts are active on creation (no e-mail verification). */
  email_verification_required?: boolean;
}

export interface EntityTypeInfo {
  type: string;
  placeholder: string;
  description: string;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Assistant turn that requested tool calls (OpenAI shape) — MCP loop. */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** For role:"tool" replies: which call this result answers. */
  tool_call_id?: string;
}

/** One accumulated tool call streamed back by the provider. */
export interface StreamToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** A web page the model cited when answering with web search on. Public web
 *  metadata (no user data); persisted with the chat like any other message
 *  field, i.e. E2E-encrypted. */
export interface WebSource {
  url: string;
  title: string;
}

export interface ChatResult {
  answer: string;
  model: string;
}

export class QuonError extends Error {
  /** HTTP status of the failed response, when this came from one (a network-level
   *  failure — timeout, DNS, connection refused — has no status). */
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "QuonError";
    this.status = status;
  }
}

/** True for a QuonError that came from a 401 response — the session/cookie is
 *  genuinely gone, as opposed to the scrubber being unreachable or a generic
 *  provider/server error. Callers use this to avoid mislabeling a session
 *  expiry as "QUON is unreachable" or "model provider error" (report #5,
 *  2026-07-15 UX walkthrough). */
export function isUnauthorizedError(err: unknown): boolean {
  return err instanceof QuonError && err.status === 401;
}

// --- Session-expiry hook ---------------------------------------------------
// Registered by authStore (see authStore.ts) so a 401 mid-session — the cookie/
// session is genuinely gone (expired, revoked, account deleted elsewhere) —
// transitions the app straight to the sign-in screen instead of every
// subsequent call failing with a misleading "scrubber unreachable" / "model
// provider error" message. A plain module-level callback (not an authStore
// import) keeps this file dependency-free, and avoids a cycle: authStore
// already imports api/http.ts (which imports QUON_API_URL from here).
let onUnauthorized: (() => void) | null = null;

/** Register the handler invoked on a 401 from any authenticated QUON endpoint
 *  reached through `request()` or `chatStream()`. */
export function setUnauthorizedHandler(cb: () => void): void {
  onUnauthorized = cb;
}

// --- Transport ------------------------------------------------------------
/** Re-exported so existing call sites keep working; see lib/api/csrf.ts for
 *  why this cannot simply read `document.cookie` in the native shell. */
export { csrfToken };

/**
 * The error for a non-2xx response: the backend's `detail` when it sent one
 * (that is the string `translateApiError` localises — e.g. "That is not an
 * OpenRouter key …" from the key check, #91), else path + status. Before this
 * every caller saw only "/settings/openrouter-key responded 400", so a reason
 * the server took care to word never reached the screen. The diagnostics log
 * keeps path + status only — never a body (#68).
 */
async function responseError(path: string, res: Response): Promise<QuonError> {
  let detail: string | null = null;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) {
      const d = (body as { detail: unknown }).detail;
      if (typeof d === "string" && d.trim()) detail = d.trim();
    }
  } catch {
    /* not JSON, or already consumed — fall back to the status line */
  }
  return new QuonError(detail ?? `${path} responded ${res.status}`, res.status);
}

async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const method = (init.method ?? "GET").toUpperCase();
  try {
    const res = await http().fetch(`${QUON_API_URL}${path}`, {
      ...init,
      signal: controller.signal,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(method !== "GET" && method !== "HEAD" ? { "X-QUON-CSRF": csrfToken() } : {}),
        ...init.headers,
      },
    });
    captureCsrf(res);
    if (!res.ok) {
      // #68: two iPhone reports of "Fehler beim Senden" arrived with a
      // diagnostic log that held NOTHING but crash markers — the failed
      // request itself was never recorded. Path + status only, never a body.
      diagAppend(`api ${method} ${path} -> ${res.status}`);
      if (res.status === 401) onUnauthorized?.();
      throw await responseError(path, res);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof QuonError) throw err;
    const name = err instanceof Error ? err.name : "Error";
    diagAppend(
      `api ${method} ${path} failed before a response: ${name} (online=${navigator.onLine})`,
    );
    throw new QuonError(err instanceof Error ? err.message : `request to ${path} failed`);
  } finally {
    clearTimeout(timer);
  }
}

/** Thrown when the backend returned 200 but a value the user asked to have
 *  ALWAYS redacted is still present in the result. Distinct from a transport
 *  failure: retrying will not help, and the send must not proceed. */
export class ScrubIncompleteError extends QuonError {
  readonly term: string;
  constructor(term: string) {
    super(`/scrub returned text still containing a required redaction`);
    this.name = "ScrubIncompleteError";
    this.term = term;
  }
}

/** Scrub raw text and return the pseudonymized result + entity report. */
/** The scrub-only demo (/demo): no session, no options beyond the language
 *  hint, no re-hydration map kept anywhere. The backend answers 404 when the
 *  instance has the demo off, 413 over its length cap, 429 per IP and 503 at
 *  its process-wide ceiling; the page maps those to its own messages. */
export async function demoScrub(
  text: string,
  languageHint: "de" | "en" | null,
): Promise<ScrubResult> {
  return request<ScrubResult>(
    "/demo/scrub",
    { method: "POST", body: JSON.stringify({ text, language_hint: languageHint }) },
    30_000,
  );
}

export async function scrubText(text: string, options?: ScrubOptions): Promise<ScrubResult> {
  const result = await scrubRequest(text, options);
  // ⚠️ The choke point that makes a hand-redaction a GUARANTEE rather than a
  // hope. Every send path funnels through here, so verifying once means each of
  // them fails closed through its existing catch — no per-site edits, and no new
  // path can forget it. `always_redact` is the user's explicit instruction; if a
  // term survived, the backend did not honour it and the text must not be sent.
  //
  // Placeholders need no special handling — see the note in redactSpans.ts.
  const surviving = verifyRedactions(result.scrubbed, options?.always_redact ?? []);
  if (surviving) throw new ScrubIncompleteError(surviving);
  return result;
}

async function scrubRequest(text: string, options?: ScrubOptions): Promise<ScrubResult> {
  return request<ScrubResult>(
    "/scrub",
    {
      method: "POST",
      body: JSON.stringify({
        text,
        options: {
          language: "auto",
          language_hint: browserLanguageHint(),
          show_entities: true,
          placeholder_style: DEFAULT_PLACEHOLDER_STYLE,
          ...options,
        },
      }),
    },
    180000, // CPU-only Ollama (~4 tok/s) chunks long inputs sequentially; allow
    // plenty of headroom above the per-chunk OLLAMA_TIMEOUT so the whole message
    // completes instead of failing closed into fallback mode.
  );
}

/** Probe service + Ollama health (used by the status indicator). */
export async function checkHealth(): Promise<HealthStatus> {
  return request<HealthStatus>("/health", { method: "GET" }, 5000);
}

/** Instance-level connector config (public values only — e.g. the operator's
 *  Dropbox OAuth client id for one-click connect). */
export async function getConnectorsConfig(): Promise<{
  dropbox_app_key: string;
  ms_client_id: string;
}> {
  return request<{ dropbox_app_key: string; ms_client_id: string }>(
    "/connectors/config",
    { method: "GET" },
    5000,
  );
}

/** Fetch the supported entity catalog (used for the legend). */
export async function getEntities(): Promise<EntityTypeInfo[]> {
  return request<EntityTypeInfo[]>("/entities", { method: "GET" }, 5000);
}

export interface CloudOcrResult {
  text: string;
  model: string;
}

/**
 * Cloud OCR fallback — only ever called after the user explicitly confirmed
 * the escalation in the scan dialog (the default path is fully on-device).
 * Unlike the generic `request()` this surfaces the backend's `detail` message,
 * because the failure modes are actionable (budget exhausted, rate limit).
 */
// --- MCP tool servers ------------------------------------------------------

export interface McpServerInfo {
  id: string;
  label: string;
  url: string;
  auth_configured: boolean;
  enabled: boolean;
}

export async function listMcpServers(): Promise<McpServerInfo[]> {
  return request<McpServerInfo[]>("/mcp/servers", { method: "GET" }, 15000);
}

/** Create/update an MCP server. `auth_header` is write-only ("Name: value");
 *  empty/omitted keeps the existing secret. */
export async function upsertMcpServer(
  id: string,
  body: { label: string; url: string; auth_header?: string; enabled?: boolean },
): Promise<McpServerInfo[]> {
  return request<McpServerInfo[]>(
    `/mcp/servers/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(body) },
    15000,
  );
}

export async function deleteMcpServer(id: string): Promise<McpServerInfo[]> {
  return request<McpServerInfo[]>(
    `/mcp/servers/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    15000,
  );
}

export async function ocrCloudTranscribe(imageB64: string): Promise<CloudOcrResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await http().fetch(`${QUON_API_URL}/ocr/cloud`, {
      method: "POST",
      signal: controller.signal,
      credentials: "include",
      headers: { "content-type": "application/json", "X-QUON-CSRF": csrfToken() },
      body: JSON.stringify({ image_b64: imageB64 }),
    });
    if (!res.ok) {
      let detail = `cloud OCR failed (${res.status})`;
      try {
        const body = (await res.json()) as { detail?: unknown };
        if (typeof body.detail === "string" && body.detail) detail = body.detail;
      } catch {
        // non-JSON error body — keep the generic message
      }
      throw new QuonError(detail);
    }
    return (await res.json()) as CloudOcrResult;
  } catch (err) {
    if (err instanceof QuonError) throw err;
    throw new QuonError(err instanceof Error ? err.message : "cloud OCR request failed");
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchedUrl {
  url: string;
  title: string;
  text: string;
}

/**
 * Fetch a public web page's main text via the backend (server-side Readability).
 * NOT zero-knowledge for the URL: the server sees the URL + public page content
 * (same trust class as web_fetch). The returned text is ingested + encrypted
 * client-side. SSRF-guarded server-side.
 */
export async function fetchUrl(url: string, raw = false): Promise<FetchedUrl> {
  const res = await http().fetch(`${QUON_API_URL}/fetch-url`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "X-QUON-CSRF": csrfToken() },
    body: JSON.stringify({ url, raw }),
  });
  if (!res.ok) {
    let detail = `URL import failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new QuonError(detail);
  }
  return (await res.json()) as FetchedUrl;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  /** Absolute image URL ON THE ORIGIN. Never render it directly — pass it
   *  through `linkImageUrl` so the merchant's server never sees the browser. */
  image?: string | null;
}

/**
 * Preview metadata (title, description, image URL) for an answer's cited web
 * results. The server does the fetching so the browser never contacts the cited
 * sites — a direct request would tell every site in the result list who is
 * asking about it, the same passive leak that keeps favicons out of the strip.
 *
 * Best-effort by design: a failure yields an empty list and the plain source
 * chips stay. Never let this block or fail an answer.
 */
export async function linkPreviews(urls: string[]): Promise<LinkPreview[]> {
  if (!urls.length) return [];
  const res = await http().fetch(`${QUON_API_URL}/link-previews`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "X-QUON-CSRF": csrfToken() },
    body: JSON.stringify({ urls: urls.slice(0, 12) }),
  });
  if (!res.ok) return [];
  try {
    const body = (await res.json()) as { previews?: LinkPreview[] };
    return body.previews ?? [];
  } catch {
    return [];
  }
}

/** Same-origin URL that re-serves a preview image through QUON's own proxy. */
export function linkImageUrl(imageUrl: string): string {
  return `${QUON_API_URL}/link-image?url=${encodeURIComponent(imageUrl)}`;
}

export interface FeedbackPayload {
  category?: string;
  message: string;
  /** Optional screenshot as base64 (raw or data-URL); the server attaches it. */
  screenshotB64?: string;
  screenshotMime?: string;
  contactBack?: boolean;
  /** Optional technical diagnostics (diagLog report) — consent-gated in the
   *  dialog with the full text shown before sending. */
  diag?: string;
}

/**
 * Send beta feedback to the operator (emailed server-side). NOT zero-knowledge:
 * the message + optional screenshot reach the server in the clear — the UI says
 * so. Tied to the logged-in account.
 */
export async function sendFeedback(payload: FeedbackPayload): Promise<void> {
  const res = await http().fetch(`${QUON_API_URL}/feedback`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json", "X-QUON-CSRF": csrfToken() },
    body: JSON.stringify({
      category: payload.category ?? "",
      message: payload.message,
      screenshot_b64: payload.screenshotB64 ?? null,
      screenshot_mime: payload.screenshotMime ?? null,
      contact_back: payload.contactBack ?? false,
      diag: payload.diag ?? null,
    }),
  });
  if (!res.ok) {
    let detail = `Feedback failed (${res.status})`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string" && body.detail) detail = body.detail;
    } catch {
      /* keep generic */
    }
    throw new QuonError(detail);
  }
}

/**
 * Send an already-scrubbed conversation to OpenRouter (relayed by the backend).
 * `protected` must reflect whether the messages actually contain QUON
 * placeholders, so the backend picks the right system prompt (a placeholder-
 * preserving one only when there is something to preserve).
 */
export async function chatComplete(
  messages: ChatTurn[],
  model: string,
  protectedFlag = true,
  connectionId?: string,
): Promise<ChatResult> {
  return request<ChatResult>(
    "/chat",
    {
      method: "POST",
      body: JSON.stringify({
        model,
        connection_id: connectionId,
        messages,
        protected: protectedFlag,
      }),
    },
    120000,
  );
}

/** Fetch the configured chat models for the dropdown. */
export async function getModels(): Promise<ChatModel[]> {
  return request<ChatModel[]>("/models", { method: "GET" }, 5000);
}

/** Stream a chat completion; `onDelta` is called with each text chunk. When
 *  `tools` are sent and the model requests calls, `onToolCalls` receives the
 *  accumulated calls (once) — the caller runs the consent/execute loop. */
export async function chatStream(
  messages: ChatTurn[],
  model: string,
  protectedFlag: boolean,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
  connectionId?: string,
  reasoningEffort?: string,
  tools?: unknown[],
  onToolCalls?: (calls: StreamToolCall[]) => void,
  webSearch?: boolean,
  onReasoning?: (delta: string) => void,
  onSources?: (sources: WebSource[]) => void,
  resume?: ResumeHooks,
  /** Ask an image-capable model for a picture (#79); the data URL arrives via
   *  `onImage` — one event per image, stored sealed on the device by the caller. */
  image?: { output: boolean; onImage?: (dataUrl: string) => void },
): Promise<StreamLegResult> {
  let res: Response;
  try {
    // streamingFetch, not http().fetch: this response is READ AS IT ARRIVES,
    // and the Android shell's native fetch cannot do that (platform/streamHttp.ts).
    res = await streamingFetch()(`${QUON_API_URL}/chat/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", "X-QUON-CSRF": csrfToken() },
      body: JSON.stringify({
        model,
        connection_id: connectionId,
        messages,
        protected: protectedFlag,
        tools: tools && tools.length ? tools : undefined,
        web_search: webSearch || undefined,
        // "off"/undefined → omit so the provider uses its default (JSON drops undefined).
        reasoning_effort:
          reasoningEffort && reasoningEffort !== "off" ? reasoningEffort : undefined,
        image_output: image?.output || undefined,
      }),
      signal,
    });
  } catch (err) {
    diagAppend(
      `api POST /chat/stream failed before a response: ${err instanceof Error ? err.name : "Error"} (online=${navigator.onLine})`,
    );
    throw new QuonError(err instanceof Error ? err.message : "stream request failed");
  }
  if (!res.ok || !res.body) {
    diagAppend(`api POST /chat/stream -> ${res.status}${res.body ? "" : " (no body)"}`);
    if (res.status === 401) onUnauthorized?.();
    throw await responseError("/chat/stream", res);
  }

  return await readChatSse(res, {
    onDelta,
    onToolCalls,
    onReasoning,
    onSources,
    onImage: image?.onImage,
    onJob: resume?.onJob,
    onEvent: resume?.onEvent,
  });
}

/** Outcome of one streaming leg. `terminal: false` means the stream stopped
 *  WITHOUT a done/error event — i.e. the connection was cut (the mobile
 *  backgrounding case), so the caller should resume rather than treat the
 *  partial answer as final. */
export interface StreamLegResult {
  terminal: boolean;
}

/** Hooks a caller needs to make a stream RESUMABLE: the job id the server minted
 *  and a running count of applied events (the resume offset). */
export interface ResumeHooks {
  onJob?: (jobId: string) => void;
  onEvent?: (appliedCount: number) => void;
}

interface SseHandlers extends ResumeHooks {
  onDelta: (delta: string) => void;
  onToolCalls?: (calls: StreamToolCall[]) => void;
  onReasoning?: (delta: string) => void;
  onSources?: (sources: WebSource[]) => void;
  /** A generated image as a data URL (#79). */
  onImage?: (dataUrl: string) => void;
}

/**
 * Read one SSE chat stream to completion. Shared by the initial POST and the
 * resume GET so both apply events identically — the resume replay MUST produce
 * the same accumulation the lost leg would have.
 *
 * `onEvent` reports how many BUFFERED events have been applied. The leading
 * `{job}` announcement is not one of them (the server prepends it outside the
 * buffer), so the count maps 1:1 onto the server-side index.
 */
async function readChatSse(res: Response, h: SseHandlers): Promise<StreamLegResult> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let applied = 0;
  let terminal = false;
  for (;;) {
    const { done, value } = await readOrIdle(reader);
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) >= 0) {
      const dataLine = buffer
        .slice(0, sep)
        .split("\n")
        .find((l) => l.startsWith("data:"));
      buffer = buffer.slice(sep + 2);
      if (!dataLine) continue;
      let payload: {
        job?: string;
        delta?: string;
        reasoning?: string;
        done?: boolean;
        error?: string;
        tool_calls?: StreamToolCall[];
        annotations?: WebSource[];
        image?: string;
      };
      try {
        payload = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      if (payload.job) {
        h.onJob?.(payload.job);
        continue; // not a buffered event — must not advance the offset
      }
      applied += 1;
      h.onEvent?.(applied);
      if (payload.done) terminal = true;
      if (payload.error) {
        terminal = true; // a real answer about the request — never resume it
        throw new StreamPayloadError(payload.error);
      }
      if (payload.tool_calls?.length) h.onToolCalls?.(payload.tool_calls);
      if (payload.reasoning) h.onReasoning?.(payload.reasoning);
      if (payload.annotations?.length) h.onSources?.(payload.annotations);
      if (payload.image) h.onImage?.(payload.image);
      if (payload.delta) h.onDelta(payload.delta);
    }
  }
  return { terminal };
}

/**
 * The server heartbeats an open stream every 20 s (`: ping`, main.py) while the
 * provider is silent, so a healthy leg is never quiet for long. A leg that
 * delivers NOTHING for this long is a socket that is open on paper and dead on
 * the wire — a mobile radio hand-off, a proxy that stopped forwarding. Before
 * this watchdog that leg hung „Antwort wird erstellt…" indefinitely (feedback
 * #85: 50 s and counting on Android, while the server had the whole answer
 * after 15 s), because `reader.read()` never resolves and nothing else fires.
 * Three missed heartbeats and the leg is cut and resumed from its offset.
 */
export const STREAM_IDLE_MS = 60_000;

/** Thrown by the idle watchdog — status-less on purpose: `isTransportFailure`
 *  treats it as a dropped socket and the caller re-attaches to the job. */
export class StreamIdleError extends QuonError {
  constructor() {
    super(`stream idle for ${STREAM_IDLE_MS / 1000}s — no bytes, no heartbeat`);
    this.name = "StreamIdleError";
  }
}

async function readOrIdle(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StreamIdleError()), STREAM_IDLE_MS);
  });
  try {
    return await Promise.race([reader.read(), idle]);
  } catch (e) {
    if (e instanceof StreamIdleError) void reader.cancel().catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * An `{error}` event INSIDE a 200 stream: the provider refused the request
 * (bad key, budget gone, model unavailable). It arrives without an HTTP status
 * — the stream itself was fine — which is exactly the signature a dropped
 * socket has, so it needs its own type: `isTransportFailure` must say NO to
 * it. Feedback #84: the key-rejected message was swallowed by five resume
 * attempts and shown as "Verbindung verloren".
 */
export class StreamPayloadError extends QuonError {
  constructor(message: string) {
    super(message);
    this.name = "StreamPayloadError";
  }
}

/** Thrown when a resume target is gone (server restart / TTL) — the caller
 *  falls back to its normal Retry path. */
export class StreamGoneError extends Error {}

/**
 * Re-attach to a generation that kept running server-side while this client was
 * away (mobile backgrounding kills the socket, not the answer). Replays the
 * events from `from` and then rides the live tail.
 */
export async function resumeChatStream(
  jobId: string,
  from: number,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<StreamLegResult> {
  let res: Response;
  try {
    res = await streamingFetch()(
      `${QUON_API_URL}/chat/stream/resume?job=${encodeURIComponent(jobId)}&from_index=${from}`,
      { credentials: "include", signal },
    );
  } catch (err) {
    throw new QuonError(err instanceof Error ? err.message : "resume request failed");
  }
  if (res.status === 404) throw new StreamGoneError("stream job expired");
  if (!res.ok || !res.body) {
    if (res.status === 401) onUnauthorized?.();
    throw await responseError("/chat/stream/resume", res);
  }
  return await readChatSse(res, handlers);
}

// --- Settings -------------------------------------------------------------
/** A chat provider connection (OpenRouter or a BYOK OpenAI-compatible provider). */
export interface ProviderConnection {
  id: string;
  label: string;
  kind: string; // "openrouter" | "openai"
  base_url: string;
  models: string[];
  key_configured: boolean;
  builtin: boolean;
  owner: "global" | "user"; // "global" = operator-shared; "user" = your own BYOK
}

/** One model from a provider's catalog (GET …/catalog). */
export interface CatalogModel {
  id: string;
  name: string;
}

/** Partial connection upsert; omit api_key to keep the existing key. */
export interface ConnectionInput {
  label?: string;
  base_url?: string;
  models?: string[];
  api_key?: string;
}

export interface SettingsStatus {
  openrouter_configured: boolean;
  /** The caller has an own OpenRouter key stored (overrides the included one). */
  own_openrouter_key?: boolean;
  models: ChatModel[];
  connections: ProviderConnection[];
}

export async function getSettings(): Promise<SettingsStatus> {
  return request<SettingsStatus>("/settings", { method: "GET" }, 5000);
}

export async function setOpenRouterKey(apiKey: string): Promise<SettingsStatus> {
  return request<SettingsStatus>(
    "/settings/openrouter-key",
    { method: "PUT", body: JSON.stringify({ api_key: apiKey }) },
    8000,
  );
}

export async function setModelsConfig(disabledIds: string[]): Promise<SettingsStatus> {
  return request<SettingsStatus>(
    "/settings/models",
    { method: "PUT", body: JSON.stringify({ disabled_ids: disabledIds }) },
    8000,
  );
}

/** Create/update a provider connection ("openrouter" or a custom id). */
export async function upsertConnection(
  id: string,
  input: ConnectionInput,
): Promise<SettingsStatus> {
  return request<SettingsStatus>(
    `/settings/connections/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
    8000,
  );
}

/** Delete a custom connection (OpenRouter cannot be removed). */
export async function deleteConnection(id: string): Promise<SettingsStatus> {
  return request<SettingsStatus>(
    `/settings/connections/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    8000,
  );
}

/** Fetch a connection's available models from its provider catalog. */
export async function getConnectionCatalog(id: string): Promise<CatalogModel[]> {
  return request<CatalogModel[]>(
    `/settings/connections/${encodeURIComponent(id)}/catalog`,
    { method: "GET" },
    20000,
  );
}

// --- Included AI budget (provisioned OpenRouter sub-key) --------------------
/**
 * Usage of the account's included AI budget (the $-capped OpenRouter sub-key
 * minted at signup on hosted deployments). `provisioned` is false on self-host
 * / BYOK-only deployments — hide any budget UI entirely then. Only usage/limit
 * numbers are exposed; the sub-key itself never leaves the server.
 */
export interface UsageStatus {
  provisioned: boolean;
  usage_usd: number | null;
  limit_usd: number | null;
  limit_remaining_usd: number | null;
  disabled: boolean;
}

/** Fetch the signed-in user's included-budget usage (server caches ~5 min). */
export async function getUsage(): Promise<UsageStatus> {
  return request<UsageStatus>("/account/usage", { method: "GET" }, 10000);
}

// --- Per-user (BYOK) connections (auth-gated; sealed server-side) ----------
/** Create/update one of the signed-in user's own providers. */
export async function upsertMyConnection(
  id: string,
  input: ConnectionInput,
): Promise<SettingsStatus> {
  return request<SettingsStatus>(
    `/settings/my-connections/${encodeURIComponent(id)}`,
    { method: "PUT", body: JSON.stringify(input) },
    8000,
  );
}

/** Delete one of the signed-in user's own providers. */
export async function deleteMyConnection(id: string): Promise<SettingsStatus> {
  return request<SettingsStatus>(
    `/settings/my-connections/${encodeURIComponent(id)}`,
    { method: "DELETE" },
    8000,
  );
}

/** Fetch the catalog for one of the signed-in user's own providers. */
export async function getMyConnectionCatalog(id: string): Promise<CatalogModel[]> {
  return request<CatalogModel[]>(
    `/settings/my-connections/${encodeURIComponent(id)}/catalog`,
    { method: "GET" },
    20000,
  );
}

// --- Derived status -------------------------------------------------------
export type QuonStatus = "active" | "fallback" | "offline" | "loading";

/**
 * Map a /health response (or a failed probe) to a traffic-light status.
 *  - active:   service up + the active PII backend is ready (cloud configured,
 *              or local Ollama up with a model) → NER + patterns + LLM enrichment
 *  - fallback: service up but the LLM backend is unavailable → NER + patterns only
 *  - offline:  service unreachable → data would be sent unprotected
 */
export function deriveStatus(health: HealthStatus | null, failed: boolean): QuonStatus {
  if (failed) return "offline";
  if (!health) return "loading";
  // pii_ready is the whole in-process detection stack (NER + net + GLiNER) —
  // the only detector there is, since the LLM extraction tier was removed.
  return health.pii_ready ? "active" : "fallback";
}
