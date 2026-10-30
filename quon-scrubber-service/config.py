"""Runtime settings for the QUON scrubber service.

All values can be overridden via environment variables (case-insensitive) or a
local ``.env`` file. Example: ``GLINER_ENABLED=true``.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        protected_namespaces=(),
    )

    # --- Service ---------------------------------------------------------
    version: str = "0.1.0"
    host: str = "0.0.0.0"
    port: int = 8000
    # SQLite file for accounts, sessions, E2E sync blobs and per-user keys.
    # Relative paths are anchored to the service directory; override with an
    # absolute path (e.g. a mounted volume) in Docker/Pi/NAS deployments.
    database_path: str = "quon.db"



    # --- NER (spaCy / Presidio) — primary detector -----------------------
    # The fast, always-on detector. Runs a Presidio AnalyzerEngine backed by
    # spaCy NER models to catch person names (plus structured PII patterns),
    # in ~tens of ms on CPU. Set to false to fall back to regex + LLM only.
    ner_enabled: bool = True
    # spaCy model per language. `_md` is the balanced default (good recall, ~40MB
    # each, fast on CPU). NOTE on German: `_lg` is NOT recommended — empirically it
    # labels common "Dr. <Name>" phrases as MISC and drops the real name, hurting
    # recall, while the POS filter below (model-independent) is what actually
    # removes the capitalized-verb false positives. `_sm` is the smallest footprint;
    # avoid `_trf` (transformer) — too slow on CPU.
    spacy_model_de: str = "de_core_news_md"
    spacy_model_en: str = "en_core_web_md"
    # PERSON precision filters. spaCy NER on German often tags capitalized
    # sentence-initial verbs/nouns ("Mache", "Rechne", "Fasse") as person names
    # and emits function-word runs ("kannst du mir") as multi-token spans. The POS
    # filter requires a proper-noun (PROPN) token in EVERY candidate span (single
    # or multi-token); a capitalization guard drops lowercase mistags; the denylist
    # (merged with a builtin German set) drops known salutations/imperative verbs.
    ner_person_pos_filter: bool = True
    ner_person_denylist: str = ""  # extra comma-separated words, case-insensitive
    # Casing is spaCy NER's main signal. On all-lowercase input ("kannst du mir
    # …") it both hallucinates PERSON spans and misses real names, so we suppress
    # NER PERSON candidates when the text carries no case signal and defer name
    # detection to the LLM enrichment layer (which handles lowercase far better).
    # Structured PII (email/phone/IBAN) is case-insensitive and stays unaffected.
    ner_person_require_case_signal: bool = True


    # --- Agents (server-side web-watch, Option C) -------------------------
    # Model the server-side agent runner uses for its web search. Web-capable +
    # cheap; gpt-4o-mini supports OpenRouter's server web-search tool and is
    # always available. Override with AGENT_MODEL. Billed to the user's own
    # OpenRouter sub-key (the daily search costs a fraction of a cent).
    agent_model: str = "openai/gpt-4o-mini"
    # Don't run an agent more often than this (seconds). The runner ticks hourly
    # from the maintenance loop but each agent is due at most once per interval.
    agent_min_interval_seconds: float = 20 * 3600  # ~daily, with slack
    agent_run_timeout: float = 90.0  # seconds per agent LLM call

    # --- Cloud OCR fallback (explicit per-photo opt-in) --------------------
    # Vision model used when the user escalates a photo the on-device OCR
    # couldn't read (handwriting, hard photos). Gemini 3.1 Flash-Lite is the
    # best measured model on German handwritten school exams (98.4% token
    # accuracy, arXiv 2606.11477) at ~$0.002/page. Routed via OpenRouter with
    # zero-data-retention enforced; billed to the caller's own sub-key.
    ocr_cloud_model: str = "google/gemini-3.1-flash-lite"
    ocr_cloud_timeout: float = 60.0  # seconds — one image, no streaming


    # Drop DATE entities that are relative durations / time-spans ("3 Wochen",
    # "für 2 Tage", "over 6 months"). These are not PII; concrete calendar dates
    # ("15.03.2025", "March 3") are kept. Applies to all detectors (mainly the LLM).
    drop_relative_durations: bool = True
    # Hard cap on a single scrub. Long documents are now chunked for the LLM (with
    # per-chunk resilience), so this is a sanity bound sized to fit a multi-page
    # attachment — it must be >= the frontend ATTACHMENT_CHAR_BUDGET (50k) so an
    # uploaded document is never silently re-truncated server-side.
    max_text_length: int = 50000

    # Deterministic safety net: always run the Presidio EMAIL/PHONE/IBAN
    # recognizers alongside the LLM and merge the results, so these
    # high-confidence PII types are never missed when the small local model
    # overlooks one (e.g. an email buried in a long CC list). Measured on the
    # 50-case corpus, qwen2.5:3b alone redacts only ~82% of emails; with the
    # safety net it is ~100%. Set to false for strict LLM-only detection.
    safety_net: bool = True

    # Also include deterministic currency amounts (e.g. "145.000 €", "$4.2M") in
    # the safety net. Trade-off: this redacts ANY amount, including public figures
    # like a company's reported revenue. Set to false to leave amounts to the LLM.
    safety_net_amounts: bool = True

    # Also include deterministic street addresses (street+number, PLZ+city) in the
    # always-on safety net, so ADDRESS is caught even with the LLM offline. When a
    # user disables the ADDRESS type, the per-request enabled_types filter drops
    # these downstream (this flag only controls detection, not policy).
    safety_net_addresses: bool = True

    # Spelled-out dates ("12. März 2025", "March 14th") in the deterministic net.
    # Written dates were LLM-only until 2026-08-19, when the golden-58 comparison
    # showed a 7B leaking 5 of them while the 24B caught them — a model-dependent
    # hole in a guarantee that should not depend on the model. Flagged like the
    # other net additions so an operator who considers dates non-sensitive can
    # leave them to the LLM.
    safety_net_spelled_dates: bool = True

    # --- GLiNER: a span-scoring encoder as a third detector -------------------
    # Off by default until it has earned its place on the holdout. Unlike the LLM
    # tier this is in-process and CPU-only: no endpoint, no timeout, and latency
    # that scales with text length rather than with how many entities a page has.
    gliner_enabled: bool = False
    gliner_model: str = "urchade/gliner_multi_pii-v1"
    # 0.5 produced junk in the feasibility probe ("We" as a person at exactly
    # 0.50). Raised, and the value belongs in config precisely so it can be swept
    # on the tune set without editing code.
    # Swept on golden-58 (labelled, never the holdout): 0.5 / 0.65 / 0.8 all gave
    # the same 98.4% recall, and FP fell 31 -> 29 -> 26. Free precision, so take it.
    # 0.8 -> 0.65, and the FP cost is REAL — an earlier version of this comment
    # claimed it was free, on the strength of a corpus FP count that sat at 5
    # through the entire sweep. That probe is simply not sensitive here. The
    # golden-58 set, which has 154 must-not-redact values, does move:
    #
    #   threshold   corpus leaks   golden-58 FP   golden-58 recall
    #   0.80        29             32             100% (245/246)
    #   0.70        19             36             100%
    #   0.65        12             37             100%
    #
    # So: 17 fewer leaks for 5 more over-redactions. Taken deliberately, because
    # the two failures are not symmetric — a leak puts real personal data in a
    # third party's logs and cannot be undone, while a false positive shows the
    # user a placeholder where an ordinary word should be, in a product that
    # ships a Review mode for exactly that. 0.70 is dominated (7 more leaks than
    # 0.65 to save a single FP) and is not a sensible middle.
    gliner_threshold: float = 0.65
    #: Ceiling for the common-noun-phrase guard (ner._is_common_noun_phrase): a
    #: GLiNER PERSON claim at or above this score is never dropped by it. Real
    #: names score ~1.0 ("Romana Schleich" 1.00 even where the tagger called both
    #: words NOUN); the daycare-child false positive "Kita Kind" scored 0.83. The
    #: guard is a conjunction of grammar signals; this makes the model's own
    #: confidence a fifth, independent interlock, so a name the tagger happens
    #: to misread still survives when GLiNER is sure of it.
    gliner_common_noun_max_score: float = 0.90
    gliner_chunk_chars: int = 1200
    #: How many chunks to score CONCURRENTLY. 0 = one per available core.
    #: Chunks are independent, so this is pure wall-clock: the scrub path measured
    #: flat at ~2.0s per 1000 chars sequentially, which makes a 50 000-char
    #: document (the max_text_length ceiling) cost 100 seconds.
    #:
    #: Threads, not processes, because torch releases the GIL during a forward
    #: pass and a second process would mean a second 3.1 GB copy of the model.
    #: Paired with gliner_torch_threads=1: GLiNER does not thread-scale WITHIN a
    #: chunk (measured 1579ms on one thread vs 1506ms on two), so giving each
    #: chunk one thread and running several chunks is strictly better than the
    #: reverse — and it stops the two from oversubscribing the box.
    gliner_max_workers: int = 0
    #: Intra-op threads per chunk. 1 by default; see gliner_max_workers.
    gliner_torch_threads: int = 1
    # The veto costs one extra model call per TENTATIVE candidate, which is rare.
    # Separate flag so detection and judgement can be measured independently.
    gliner_veto: bool = True
    #: How far a competing label must beat "person" before it vetoes a candidate
    #: NER did NOT flag as tentative. A MARGIN, not an absolute score: "Mercedes
    #: Jacobi Jäckel" scores company 0.95 / person 0.93, so any absolute bar low
    #: enough to catch brands also leaks that real name. Brands measured at +0.83
    #: to +1.00 margin (person 0.00), real names at negative margin.
    gliner_veto_person_margin: float = 0.4
    #: …AND the competing label must be confident in absolute terms. Margin alone is
    #: too loose: "Kayla Villa" scores company 0.71 with NO person span, so its
    #: margin is +0.71 and a margin-only rule vetoed a real name. Both bars are
    #: needed — confident, AND clearly better than "person".
    #
    # 0.90/0.50 -> 0.80/0.40 on 2026-08-22, swept on 45 ECHR judgments (TAB):
    #
    #   0.90 / 0.50   PERSON 396/404   FP 153   kills 2 of 4 beta FPs
    #   0.80 / 0.40   PERSON 396/404   FP 150   kills 3 of 4      <- taken
    #   0.75 / 0.30   PERSON 395/404   FP 150   kills 3 of 4  (a name for nothing)
    #
    # The old bar was too high by a hair: "MDS UI" scores software 0.88 and
    # missed the veto by two hundredths. Recall does not move until 0.75, where
    # it costs a name and buys no further precision.
    #
    # ALSO SWEPT AND REJECTED: adding "substance" and "generic term" to
    # CONTRAST_LABELS, to catch "Vitamin D" (substance 0.93) and "Verdict"
    # (generic term 0.66). It BACKFIRED — FP 153 -> 178. Enriching the label set
    # raises the person score on other spans ("end user" 0.83 -> 0.90), so the
    # veto loses more than it gains. Contrast labels are not free; sweep them.
    # --- V1 cross-check: the winning verifier from the 2026-08-23 trial ------
    # Every PERSON claim that survives the guards and vetoes gets ONE more
    # question: does GLiNER, shown ±120 chars around the claim, give it ANY
    # person score at or above this floor? Below the floor -> drop; model
    # unavailable or erroring -> keep (fail open, a verifier may only remove).
    #
    # Measured (16-run pre-registered trial, production config):
    #
    #   floor    reviewed-FP ledger    TAB PERSON     salted recall
    #   off      18/103 still fire     485/495        182/204
    #   0.02      1/103                483/495        182/204
    #   0.05      1/103                483/495        182/204   <- taken
    #   0.10      1/103                476/495        182/204
    #   0.30      1/103                469/495        182/204
    #
    # 0.05 over 0.02: identical numbers, and the higher of two equivalent
    # floors leaves more margin below it for model-version drift. The -2 TAB
    # names at 0.05 ("Lichfield Reynolds", "Mrs Åkerblom") were accepted by
    # the operator on 2026-08-23; German/salted recall is untouched. Known
    # residual: "Risikoperson" CONTAINS "person", so the cross-check scores it
    # as one — that is the click-to-dismiss UI's case, not this gate's.
    # Majority-of-windows — MEASURED AND REJECTED as a default (2026-08-23).
    # The idea: the any-window rule kept "user" on ARCHITECTURE.md (dozens of
    # occurrences, one corroborating window of four sampled), which looks like
    # the corpus's applicant-x372 lesson one layer up. The measurement:
    #
    #   any        ledger 5/129 firing   salted 182/204   TAB 375/385
    #   majority   ledger 3/129          salted 182/204   TAB 368/385  (-7)
    #
    # It kills "user" and "L" — and seven real court names with them. The
    # frequency-as-evidence assumption breaks exactly where names matter: in a
    # legal document ONE person's surname repeats fifty times, and most of its
    # windows are citation-shaped. Two ledger FPs are not worth seven names.
    # The knob stays for experimentation; the default stays honest.
    gliner_crosscheck_majority: bool = False
    gliner_person_crosscheck: bool = True
    gliner_crosscheck_floor: float = 0.05

    gliner_veto_min_score: float = 0.80
    #: "" (fp32) or "int8". LEAVE IT EMPTY — measured on the production box
    #: 2026-08-20, torch dynamic int8 DESTROYS this model:
    #:
    #:     fp32  threshold 0.65 -> person 0.992, iban 0.988, date 0.974
    #:     int8  threshold 0.65 -> nothing. At 0.001: iban 0.036, and
    #:                             "Herr Michael Brandt" labelled an IBAN.
    #:
    #: The scores did not rescale, the discrimination is gone, and no threshold
    #: recovers it. The memory saving that motivated trying it did not appear
    #: either: RSS went 3168 -> 3261 MB, i.e. 3% WORSE, because peak RSS here is
    #: torch runtime and activations, not weights. Latency gained 16%.
    #:
    #: Kept as a setting rather than deleted so the next person who reaches for
    #: "just quantize it" finds this note instead of repeating the experiment.
    #: An ONNX export is a genuinely different path (it drops torch from the
    #: inference process entirely, which is where the memory actually is) and is
    #: unevaluated.
    gliner_quantize: str = ""

    # --- Model provider: OpenRouter --------------------------------------
    # The provider API key is SERVER-SIDE only — it must never reach the browser.
    # Set it in .env (preferred, git-ignored) or the environment.
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_timeout: float = 120.0  # provider completions can be slow
    # Attribution headers recommended by OpenRouter.
    openrouter_app_url: str = "http://localhost:8080"
    openrouter_app_name: str = "QUON Privacy Gateway"

    # --- Auth / sessions -------------------------------------------------
    # Public base URL of the frontend, used to build email verification links.
    app_base_url: str = "http://localhost:8080"
    # httpOnly session cookie. cookie_secure MUST be true in production (HTTPS);
    # set false only for local http dev. SameSite=Lax + a CSRF token guard
    # cross-site requests.
    cookie_name: str = "quon_session"
    cookie_secure: bool = True
    cookie_samesite: str = "lax"  # lax|strict|none
    cookie_domain: str = ""  # empty = host-only cookie
    session_ttl_hours: int = 720  # 30 days
    email_token_ttl_hours: int = 24

    # Server master secret (any string; hashed to a 32-byte key). Seals the
    # per-user OpenRouter sub-key at rest. MUST be set in production and kept
    # stable — rotating it makes existing sealed sub-keys unreadable.
    quon_server_secret: str = ""

    # --- OpenRouter provisioning (server-side only) ----------------------
    # A *provisioning* key (distinct from inference keys) that can mint, monitor,
    # patch and delete per-user sub-keys via /api/v1/keys. Leave empty for
    # self-hosted QUON Home, which uses BYOK instead of auto-provisioning.
    openrouter_provisioning_key: str = ""
    openrouter_provisioning_base_url: str = "https://openrouter.ai/api/v1"
    # Hard credit cap (USD) minted per new user during onboarding.
    openrouter_user_limit_usd: float = 5.0
    # Shared-secret bearer token guarding the /admin/* lifecycle endpoints.
    admin_token: str = ""

    # Gate self-service signup: when set, POST /auth/register requires a matching
    # OAuth client id ("App key") of the OPERATOR's Dropbox app — instance-level,
    # set once so end users get a one-click "Connect Dropbox" (no per-user app
    # registration). A client id is PUBLIC by design (PKCE, no secret involved);
    # served to the frontend via GET /connectors/config. Empty = the Dropbox
    # connector shows an honest "operator has not enabled this" note.
    dropbox_app_key: str = ""
    # Azure app registration (Microsoft identity platform) for the OneDrive
    # connector — same model as dropbox_app_key: the OPERATOR registers ONE app
    # for the instance and every user authorizes their own account against it.
    # A SPA client id is PUBLIC by design (PKCE, no secret). Register it with
    # redirect URI <origin>/connectors as platform "Single-page application"
    # and the `common` tenant (personal + work/school accounts). Empty = the
    # OneDrive connector shows an honest "operator has not enabled this" note.
    ms_client_id: str = ""

    # invite_code. Empty = open registration (default). Used for the closed beta —
    # hand the code to invited testers; it replaces the Caddy basic-auth gate.
    signup_invite_code: str = ""

    # SSRF guard: provider base_urls (BYOK / custom connections) must be https and
    # resolve to public IPs. Set true ONLY for a self-host pointing at a local
    # provider (e.g. http://localhost:11434) — it disables the guard.
    allow_private_provider_urls: bool = False

    # The middle ground between "public hosts only" and switching the guard OFF:
    # a comma-separated list of hostnames that are allowed to resolve to a private
    # address. Written for a self-hosted PII endpoint — a vLLM box in our own VPC
    # is exactly what the guard would otherwise reject, and reaching for
    # allow_private_provider_urls there would ALSO unblock every user-supplied
    # BYOK url, i.e. hand out SSRF to the instance metadata service (on EC2 that
    # is credentials). This list is OPERATOR-supplied, never user-supplied, and is
    # matched on the HOSTNAME only — exactly, case-insensitively, no wildcards.
    # https and a resolvable host are still required.
    # Example: PROVIDER_PRIVATE_HOST_ALLOWLIST=llm.internal.example.com
    provider_private_host_allowlist: str = ""

    # Per-IP rate limiting on /auth/* (brute-force / signup-abuse guard). On by
    # default; disabled in the test harness.
    rate_limit_enabled: bool = True

    # --- Sync: original document bytes ------------------------------------
    # Per-user total-bytes cap for the `originals` sync collection (client-side
    # encrypted original file bytes, chunked ≤ ~3 MiB per blob). A push that
    # would exceed it is rejected per-blob with status "quota" — the document's
    # extracted text keeps syncing normally; only the layout-view bytes stay
    # device-local. Tombstoned blobs store empty ciphertext, so deleting a
    # document frees its quota. Override via ORIGINALS_QUOTA_BYTES.
    originals_quota_bytes: int = 200 * 1024 * 1024  # 200 MB

    # --- SMTP (email verification) ---------------------------------------
    # When smtp_host is empty, verification links are logged instead of sent
    # (dev mode). In production these must be set for the verify flow to work.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "QUON <no-reply@quon.local>"
    # Recipient for beta-feedback emails (POST /feedback). Empty → falls back to
    # smtp_from (operator sees it in the no-reply inbox). Set FEEDBACK_EMAIL in
    # the device .env to route feedback to a real inbox.
    feedback_email: str = ""
    # Optional: mirror each feedback submission into a GitHub issue so it lands
    # in a trackable backlog instead of only an inbox. Both must be set or the
    # mirroring is simply off (see github_issues.py). The token wants ONLY
    # "Issues: write" on that one repository — it is a write credential to a
    # third party, so scope it as narrowly as GitHub allows.
    github_token: str = ""
    github_repo: str = ""  # "owner/name"
    # Transport: STARTTLS upgrade (port 587, the default) vs. implicit TLS /
    # SMTPS (port 465, e.g. Cloudflare Email Service smtp.mx.cloudflare.net:465).
    smtp_starttls: bool = True
    # Force implicit TLS. Leave false to auto-detect: port 465 ⇒ implicit TLS.
    smtp_ssl: bool = False

    @property
    def smtp_implicit_tls(self) -> bool:
        """True when the connection should be wrapped in TLS from the start
        (SMTPS), rather than upgraded via STARTTLS."""
        return self.smtp_ssl or self.smtp_port == 465

    # --- CORS ------------------------------------------------------------
    # Comma-separated list of allowed origins for the browser client. With cookie
    # auth, credentials are sent, so this MUST be explicit origins (not "*") in
    # production. cors_allow_credentials enables Set-Cookie across origins.
    cors_allow_origins: str = "*"
    cors_allow_credentials: bool = True

    # --- Logging ---------------------------------------------------------
    log_level: str = "INFO"

    @property
    def cors_origins_list(self) -> list[str]:
        raw = self.cors_allow_origins.strip()
        if raw == "*" or not raw:
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
