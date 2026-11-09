"""Pydantic request/response schemas for the QUON scrubber API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Language = Literal["auto", "de", "en"]
# typed:   [PERSON], [EMAIL], [TELEFON] ...
# generic: [PII] for everything
# indexed: [PERSON_1], [EMAIL_1], [AMOUNT_2] ... - unique per value, for re-hydration
PlaceholderStyle = Literal["typed", "generic", "indexed"]


class ScrubOptions(BaseModel):
    language: Language = "auto"
    # Client-supplied tie-break for `language: "auto"`, used only when the text
    # itself carries zero language evidence (no hint-word hits either way - 
    # bare noun queries like "Milchreis Rezept"). The browser knows the user's
    # UI language; a hardcoded "en" default sends such German queries through
    # the English spaCy model, whose PERSON guesses on unfamiliar German
    # compounds are the single biggest real-world FP class (36% of FP-affected
    # prompts in a review of real chat history). Any value other than
    # "de"/"en" is ignored. Never overrides actual text signal.
    language_hint: Literal["de", "en"] | None = None
    show_entities: bool = True
    placeholder_style: PlaceholderStyle = "typed"
    # Caller-supplied words/values that must always be redacted (deterministic,
    # case-insensitive). These are the user's own "always redact on device" list
    # (name, address, numbers ...). They are applied per-request and never stored
    # server-side. Type CUSTOM, score 1.0 (highest).
    always_redact: list[str] = Field(default_factory=list)
    # Caller-supplied allow-list: values that must never be redacted (case-
    # insensitive, whole-value match). Suppresses false positives from any detector
    # - NER and LLM - e.g. a product/ingredient ("Xantan") mistaken for a name.
    # Applied per-request, never stored server-side.
    never_redact: list[str] = Field(default_factory=list)
    # Entity TYPES the user turned off. Empty/None = scrub everything (default,
    # unchanged behavior). Listed types are not redacted - the user's per-request
    # policy (Settings, per-project overridable). CUSTOM (the always_redact list)
    # is always kept regardless, even if listed. Applied per-request, never
    # stored server-side. (A drop-list, not an allow-list, so the client never
    # needs to know the full catalog and the default is naturally "all on".)
    disabled_types: list[str] = Field(default_factory=list)


class ScrubRequest(BaseModel):
    text: str = Field(..., description="Raw text to pseudonymize.")
    options: ScrubOptions = Field(default_factory=ScrubOptions)


class Entity(BaseModel):
    type: str
    value: str
    placeholder: str
    confidence: float


class ScrubMetadata(BaseModel):
    model_used: str
    processing_time_ms: int
    # True when the optional LLM enrichment did not run (timeout/parse error or
    # disabled). The NER + regex base may still have detected PII - see ner_used.
    fallback_mode: bool
    language_detected: str
    # True when the spaCy/Presidio NER engine ran (names detectable).
    ner_used: bool = False
    # Machine-readable reason the LLM enrichment was skipped, when it was:
    # disabled | unconfigured | timeout | unreachable | auth | rate_limit |
    # budget | provider_error | parse. None when enrichment ran.
    skip_reason: str | None = None
    # True when the input had no upper-case letter (no case signal). NER PERSON is
    # unreliable here and is deferred to the LLM - so lowercase + skipped LLM means
    # names were likely missed. The UI uses this to warn more strongly.
    low_case_signal: bool = False


class DemoScrubRequest(BaseModel):
    """The scrub-only demo: text in, placeholders out. No account, no options
    beyond the language hint; the length cap is a setting checked by the
    endpoint, so an operator can change it without a code change."""

    text: str = Field(..., description="Text to pseudonymize.")
    language_hint: Literal["de", "en"] | None = None


class ScrubResponse(BaseModel):
    scrubbed: str
    original_length: int
    scrubbed_length: int
    entities: list[Entity]
    metadata: ScrubMetadata


class HealthResponse(BaseModel):
    status: str
    version: str
    # True when the spaCy/Presidio NER engine is loaded and ready.
    ner_ready: bool = False
    # The whole in-process detection stack (NER + regex net + GLiNER when
    # enabled) is loaded and usable. There is no other backend, so this flag
    # describes the only detector that exists.
    pii_ready: bool = False
    gliner_enabled: bool = False
    gliner_loaded: bool = False
    # True when SIGNUP_INVITE_CODE is set, i.e. /auth/register needs a code (the
    # static one or an admin-issued single-use invite). Public on purpose: the
    # sign-up form shows its invite field only then, and /auth/register reveals
    # the same fact by refusing without one.
    signup_invite_required: bool = False
    # OpenRouter routing region (region.py): "global" or "eu". On /health so
    # the client learns it from the poll it already runs - the chat hides the
    # Web toggle on it, the trust page names it.
    region: str = "global"
    web_search_available: bool = True
    # False when accounts are active on creation (EMAIL_VERIFICATION=auto without
    # SMTP, or "off"): the sign-up flow then signs the user in instead of sending
    # them to their inbox.
    email_verification_required: bool = True
    demo_scrub_enabled: bool = False
    demo_scrub_max_chars: int = 0
    demo_contact_url: str = ""
    demo_contact_email: str = ""


class EntityTypeInfo(BaseModel):
    type: str
    placeholder: str
    description: str


# --- Chat (OpenRouter relay) ----------------------------------------------
Role = Literal["system", "user", "assistant", "tool"]


class ChatTurn(BaseModel):
    role: Role
    content: str
    # Function-calling turns (MCP tools): an assistant turn that requested tool
    # calls carries `tool_calls` (OpenAI shape); the reply turn carries
    # role:"tool" + the matching `tool_call_id`. Plain chats omit both.
    tool_calls: list[dict] | None = None
    tool_call_id: str | None = None


class ChatRequest(BaseModel):
    model: str = "openrouter/auto"
    # Which provider connection to route through ("openrouter" or a custom
    # connection id). None/omitted -> the built-in OpenRouter connection.
    connection_id: str | None = None
    messages: list[ChatTurn] = Field(..., min_length=1)
    # True when the messages were scrubbed before sending (filter active).
    # False when the filter is off - use a neutral system prompt so the model
    # does not apply its own privacy heuristics to real text.
    protected: bool = True
    # OpenAI-shape tool definitions (MCP tools discovered client-side). The
    # provider may answer with tool_calls, which stream back as a distinct SSE
    # event; the client executes them (with consent) and continues the chat
    # with tool turns. None/empty -> no tools sent (behavior unchanged).
    tools: list[dict] | None = None
    # Ask for an IMAGE back as well as text (OpenRouter `modalities`). Only
    # honoured by image-output models (gemini-*-image, gpt-*-image); the client
    # sets it from the catalog's `image_output` flag. The prompt is scrubbed
    # exactly like any text turn - the returned image is data, not a transcript
    # of anything personal, so nothing needs re-hydrating.
    image_output: bool = False
    # Attach OpenRouter's agentic SERVER tools (web search, URL fetch,
    # current date/time): the model invokes them when IT decides it needs to
    # (queries derive from the SCRUBBED prompt; cost only per search/fetch
    # performed). Only honored when the request routes through the built-in
    # OpenRouter connection.
    web_search: bool = False
    # Reasoning/thinking budget for reasoning-capable models ("low"/"medium"/"high").
    # None/omitted -> don't send a reasoning param (provider default). Ignored by models
    # that don't support reasoning. Passed through to OpenRouter's unified `reasoning`.
    reasoning_effort: str | None = None


class ChatResponse(BaseModel):
    answer: str
    model: str


class OcrCloudRequest(BaseModel):
    # Base64 JPEG/PNG/WebP (client re-encodes via canvas: <=2000 px, EXIF/GPS
    # stripped). The length cap bounds decode work; the decoded bytes are
    # checked against ocr_cloud.MAX_IMAGE_BYTES again.
    image_b64: str = Field(min_length=1, max_length=12_000_000)


class OcrCloudResponse(BaseModel):
    text: str
    model: str


class FetchUrlRequest(BaseModel):
    # A single public web page URL to import as a document. Length-capped to keep
    # the SSRF check + fetch bounded; https-only + host validation happen in
    # net_guard (fetch_url.fetch_and_extract).
    url: str = Field(min_length=1, max_length=2048)
    # raw=True returns the body verbatim (no Readability) - used for .ics calendar
    # subscriptions, which are parsed client-side.
    raw: bool = False


class LinkPreviewsRequest(BaseModel):
    # The cited result URLs of one answer. Capped here AND in link_preview
    # (MAX_URLS) so one reply can never fan out into many outbound fetches.
    urls: list[str] = Field(min_length=1, max_length=12)


class AgentCreateRequest(BaseModel):
    # A server-side web-watch agent. `spec.query` is the search term (interest
    # metadata - not private encrypted content). `kind` is "web-watch" for now.
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(default="web-watch", max_length=40)
    spec: dict = Field(default_factory=dict)
    schedule: str = Field(default="daily", max_length=20)


class AgentInfo(BaseModel):
    id: str
    name: str
    kind: str
    spec: dict
    schedule: str
    enabled: bool
    last_run_at: int | None = None
    created_at: int


class AgentEnabledRequest(BaseModel):
    enabled: bool


class AgentResultItem(BaseModel):
    id: str
    agent_id: str | None = None
    # base64 crypto_box_seal(result, user's identity pubkey) - server can't read it.
    sealed: str
    created_at: int


class FeedbackRequest(BaseModel):
    # Beta feedback from a logged-in user, emailed to the operator. Not
    # zero-knowledge (the message + optional screenshot reach the server in the
    # clear - stated honestly in the UI). Category is a free short tag; the
    # screenshot is an optional base64 image (data-URL prefix tolerated).
    category: str = Field(default="", max_length=40)
    message: str = Field(min_length=1, max_length=5000)
    # Optional screenshot as base64 (raw or "data:image/png;base64,..."); capped.
    screenshot_b64: str | None = Field(default=None, max_length=8_000_000)
    screenshot_mime: str | None = Field(default=None, max_length=40)
    # Whether the user wants a reply (adds their account email as Reply-To).
    contact_back: bool = False
    # Optional client diagnostics (the diagLog breadcrumb report - technical
    # strings only, consent-gated with a full preview in the UI). Capped well
    # above the client's own ~6KB ring limit.
    diag: str | None = Field(default=None, max_length=12_000)


class FetchUrlResponse(BaseModel):
    # The final url after redirects, the extracted title (may be empty), and the
    # Readability main text. Ingested + encrypted client-side like any document.
    url: str
    title: str
    text: str


class LinkPreviewItem(BaseModel):
    # `image` is an absolute URL on the ORIGIN. The client must load it through
    # GET /link-image (the proxy), never put it in an <img src> directly - that
    # would hand the merchant the user's IP and interest.
    url: str
    title: str
    description: str
    image: str | None = None


class LinkPreviewsResponse(BaseModel):
    previews: list[LinkPreviewItem]


class ChatModelInfo(BaseModel):
    # Unique dropdown id, composite "<connection_id>::<model slug>".
    id: str
    label: str
    disabled: bool = False
    # Which connection serves this model, and the provider-local model slug.
    connection_id: str = "openrouter"
    model: str = ""
    # The model can return an image (OpenRouter output_modalities / the slug
    # convention `...-image`). Drives the picker badge and `image_output` on send.
    image_output: bool = False


class ConnectionInfo(BaseModel):
    """A chat provider connection (no secrets - key is never returned)."""

    id: str
    label: str
    # "openrouter" (built-in) or "openai" (OpenAI-compatible BYOK provider).
    kind: str
    base_url: str
    models: list[str] = Field(default_factory=list)
    key_configured: bool = False
    builtin: bool = False
    # "global" (operator-configured, shared) or "user" (this user's own BYOK).
    owner: str = "global"


class CatalogModel(BaseModel):
    """One entry from a provider's /models catalog."""

    id: str
    name: str = ""


# --- Settings -------------------------------------------------------------
class SettingsResponse(BaseModel):
    openrouter_configured: bool
    # The caller has stored an own OpenRouter key that overrides the included
    # sub-key; without this flag the settings card could not offer "remove".
    own_openrouter_key: bool = False
    # OpenRouter routing region (region.py): "global" or "eu". With "eu" the
    # catalog is already filtered to in-region models and web search is off.
    region: str = "global"
    web_search_available: bool = True
    models: list[ChatModelInfo]
    # Provider connections (OpenRouter + any BYOK OpenAI-compatible providers).
    connections: list[ConnectionInfo] = Field(default_factory=list)
    # PII extraction backend configuration (the key itself is never returned).


class OpenRouterKeyRequest(BaseModel):
    # min_length=0: an empty string CLEARS the user's override (user_settings).
    api_key: str = Field(..., min_length=0)


class ModelsConfigRequest(BaseModel):
    disabled_ids: list[str] = Field(default_factory=list)


class ConnectionUpsertRequest(BaseModel):
    """Create/update a provider connection. Omitted fields are left unchanged;
    api_key is write-only (an empty/omitted value keeps the existing key)."""

    label: str | None = None
    base_url: str | None = None
    models: list[str] | None = None
    api_key: str | None = None


class McpServerInfo(BaseModel):
    """A user's registered MCP tool server (no secrets)."""

    id: str
    label: str
    url: str
    auth_configured: bool
    enabled: bool


class McpServerUpsertRequest(BaseModel):
    """Create/update an MCP server. auth_header is write-only ("Name: value",
    e.g. "Authorization: Bearer ..."); empty/omitted keeps the existing secret."""

    label: str
    url: str
    auth_header: str | None = None
    enabled: bool = True
