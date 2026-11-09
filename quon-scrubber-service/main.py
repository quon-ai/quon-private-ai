"""QUON scrubber service - FastAPI application and HTTP endpoints."""

from __future__ import annotations

import asyncio
import os
import base64
import binascii
import json
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

import account
import admin
import auth
import connections
import user_connections
import db
import key_resolver
import openrouter_keycheck
import region
import ner
import net_guard
import ocr_cloud
import optional_features
import provider
import stream_jobs
import ratelimit
import scrubber
import settings_store
import shares
import sync
import user_settings
from config import settings
from models import (
    CatalogModel,
    ChatModelInfo,
    ChatRequest,
    ChatResponse,
    ConnectionUpsertRequest,
    DemoScrubRequest,
    EntityTypeInfo,
    HealthResponse,
    ModelsConfigRequest,
    OcrCloudRequest,
    OcrCloudResponse,
    OpenRouterKeyRequest,
    ScrubOptions,
    ScrubRequest,
    ScrubResponse,
    SettingsResponse,
)


def _settings_response(user_id: str | None = None) -> SettingsResponse:
    # The caller's EFFECTIVE settings: their own per-user overrides layered over
    # the operator's global default (user_settings.effective_view). Only the
    # user's own base-url override is echoed - never the global endpoint/key.
    return SettingsResponse(
        openrouter_configured=settings_store.is_configured(),
        own_openrouter_key=user_settings.has_openrouter_key(user_id),
        region=region.region(),
        web_search_available=region.web_search_available(),
        models=connections.chat_catalog(user_id),
        connections=connections.list_connections(user_id),
    )

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("quon")


async def _maintenance_loop() -> None:
    """Hourly DB housekeeping: drop expired sessions + spent email tokens.

    Keeps the hot auth tables from growing without bound (every login inserts a
    session row; expiry alone never deletes anything). Errors are logged and the
    loop continues - housekeeping must never take the service down.
    """
    while True:
        await asyncio.sleep(3600)
        try:
            sessions, tokens = await asyncio.to_thread(auth.sweep_expired)
            if sessions or tokens:
                logger.info("sweeper: removed %d expired sessions, %d email tokens",
                            sessions, tokens)
        except Exception:
            logger.exception("sweeper failed; retrying next cycle")
        for hook in optional_features.HOUSEKEEPING:
            try:
                await hook()
            except Exception:
                logger.exception("%s failed; retrying next cycle", getattr(hook, "__name__", "hook"))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Apply DB migrations, warm the NER engine, start housekeeping.

    1. Apply any pending SQLite migrations (forward-only, idempotent).
    2. Warm the spaCy/Presidio NER engine off the event loop so the first
       request is not penalised by the ~2 s model-load cost.
    3. Start the hourly sweeper (expired sessions / email tokens) and run one
       sweep at boot so restarts also clean up.
    """
    # 0. Production config sanity - fail fast and loud instead of at runtime.
    #    COOKIE_SECURE=true is the "this is a real HTTPS deployment" signal
    #    (dev/tests run with it off and are unaffected).
    if settings.cookie_secure:
        if not settings.quon_server_secret:
            raise RuntimeError(
                "QUON_SERVER_SECRET is not set. It seals per-user provider keys "
                "at rest; without it, saving a key in Settings fails at runtime. "
                "Generate one (e.g. `openssl rand -base64 32`), set it in .env, "
                "and keep it STABLE — rotating it invalidates sealed keys."
            )
        # Test the resolved list, not the raw string: config maps an empty value
        # to ["*"] as well, and a check on the raw string lets that one through.
        # And test every entry: Starlette treats a "*" anywhere in the list as
        # allow-all and, with credentials on, reflects the caller's origin; "null"
        # matches the Origin an attacker's sandboxed frame sends; an entry
        # without a scheme can never match a real origin.
        bad = [
            o
            for o in settings.cors_origins_list
            if o == "*" or o.lower() == "null" or not o.startswith(("http://", "https://"))
        ]
        if bad:
            raise RuntimeError(
                "CORS_ALLOW_ORIGINS is '*', empty, or contains an invalid entry "
                f"({', '.join(bad)}) but cookies are Secure (production). Cookie "
                "auth requires explicit origins — set it to your exact frontend "
                "origin, e.g. https://quon.example.com."
            )
        if os.environ.get("QUON_TEST_LIGHT_KDF") == "1":
            raise RuntimeError(
                "QUON_TEST_LIGHT_KDF=1 is a test-harness flag (weakened Argon2 "
                "verifier params) and must never be set on a production "
                "deployment. Unset it."
            )
        # Open registration on a public instance whose users would all spend the
        # operator's single shared provider key. Deliberately a warning, not a
        # fatal: open signup is a legitimate choice (e.g. when every user brings
        # their own key). But it is the most expensive default to discover by
        # accident - and the first account created also becomes the admin - so
        # say it loudly, every boot, until one of the two is configured.
        import openrouter_provisioning as _prov  # local: avoids an import cycle

        if not settings.signup_invite_code:
            shared_key = bool(settings_store.get_openrouter_key()) and not _prov.is_enabled()
            unverified = not settings.email_verification_required
            if shared_key or unverified:
                logger.warning(
                    "OPEN REGISTRATION on a public deployment: SIGNUP_INVITE_CODE is "
                    "empty, so anyone who reaches this instance can create an account"
                    + (
                        " — and it is ACTIVE at once, under any address (no e-mail "
                        "verification: EMAIL_VERIFICATION=%s, SMTP_HOST %s)"
                        % (settings.email_verification, "set" if settings.smtp_host else "unset")
                        if unverified
                        else ""
                    )
                    + (
                        ". Every account bills chat to your single shared "
                        "OPENROUTER_API_KEY, uncapped"
                        if shared_key
                        else ""
                    )
                    + ". The first account created on a fresh instance becomes the ADMIN. "
                    "Set SIGNUP_INVITE_CODE before exposing this host; a private network "
                    "is the only place this is fine."
                )

    # 1. DB migrations
    db.init_db()
    logger.info("database ready (%s)", settings.database_path)

    # 2. NER warmup
    if settings.ner_enabled:
        ready = await asyncio.to_thread(ner.warmup)
        logger.info("NER engine %s", "ready" if ready else "unavailable")

    # 2b. GLiNER warmup - in the BACKGROUND, unlike NER above.
    #     NER costs ~2s and can block startup. GLiNER measured 24.2s on the
    #     production box: blocking on that would push readiness past the
    #     container healthcheck's 20s start period, so the orchestrator would
    #     restart a container that is merely still loading. Warming off to the
    #     side keeps startup fast AND keeps the 24s off the first real user, who
    #     would otherwise wait half a minute and conclude the product is broken.
    #     Failure is non-fatal: the detector is fail-soft by design.
    gliner_warm = None
    if settings.gliner_enabled:

        async def _warm_gliner() -> None:
            import gliner_detect

            try:
                ok = await asyncio.to_thread(gliner_detect.warm)
                logger.info("gliner %s", "ready" if ok else "unavailable")
            except Exception:
                logger.exception("gliner warmup failed (detector contributes nothing)")

        # Held in a local so the task is not garbage-collected mid-flight.
        gliner_warm = asyncio.create_task(_warm_gliner())

    # 3. Housekeeping: sweep once now, then hourly in the background.
    try:
        await asyncio.to_thread(auth.sweep_expired)
    except Exception:
        logger.exception("boot sweep failed (continuing)")
    sweeper = asyncio.create_task(_maintenance_loop())
    # 4. EU routing: learn what the EU domain serves (hourly) and probe the
    # catalog's floating aliases (daily) - a no-op in global mode.
    region_refresh = asyncio.create_task(region.refresh_loop(connections.openrouter_slugs))

    yield

    sweeper.cancel()
    region_refresh.cancel()
    if gliner_warm is not None:
        gliner_warm.cancel()


app = FastAPI(
    title="QUON Scrubber Service",
    version=settings.version,
    description="Local PII pseudonymization: spaCy/Presidio NER (primary) + optional LLM enrichment.",
    lifespan=lifespan,
)

# Cookie auth sends credentials, so origins must be explicit (a wildcard origin
# is rejected by browsers alongside credentials). In production set
# CORS_ALLOW_ORIGINS to your exact frontend origin(s). When left as "*" (dev), we
# reflect the request origin via a regex so credentialed requests still work;
# in practice the Vite dev proxy + Caddy make API and frontend same-origin.
_cors_kwargs: dict = {
    "allow_credentials": settings.cors_allow_credentials,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.cors_origins_list == ["*"]:
    _cors_kwargs["allow_origin_regex"] = ".*"
    if settings.cors_allow_credentials:
        logger.warning(
            "INSECURE CORS: reflecting any origin with credentials enabled. "
            "Set CORS_ALLOW_ORIGINS to explicit origin(s) in production."
        )
else:
    _cors_kwargs["allow_origins"] = settings.cors_origins_list
# Rate limiter added before CORS so CORS stays the outermost middleware and its
# headers are applied even to 429 responses.
app.add_middleware(ratelimit.RateLimitMiddleware)
app.add_middleware(CORSMiddleware, **_cors_kwargs)

app.include_router(auth.router)
app.include_router(account.router)
app.include_router(admin.router)
app.include_router(sync.router)
app.include_router(shares.router)
# Optional features - everything a build may leave out, mounted from one
# registry so this file is identical in both editions (see optional_features.py).
for _router in optional_features.ROUTERS:
    app.include_router(_router)

# NOTE: Memory & Documents are entirely client-side and zero-knowledge - built,
# embedded and searched in the browser, synced as opaque ciphertext via /sync.
# There is deliberately no server-side Memory/Documents code: the former non-ZK
# "server-assist" endpoints were removed to keep the surface small. (Migrations
# 0002/0003 still create the legacy tables for schema-history continuity; nothing
# reads them in this build.)


@app.get("/", include_in_schema=False)
async def root() -> dict[str, str]:
    return {"service": "quon-scrubber-service", "version": settings.version}


@app.post("/scrub", response_model=ScrubResponse)
async def scrub_endpoint(
    request: ScrubRequest, user: auth.User = Depends(auth.current_active_user)
) -> ScrubResponse:
    """Pseudonymize raw text and return the scrubbed text plus an entity report.

    Requires an active account. Detection runs in-process (NER, GLiNER when
    enabled, the regex safety net, the guard chain); nothing leaves the server.
    """
    return await scrubber.scrub(request.text, request.options)


@app.post("/demo/scrub", response_model=ScrubResponse)
async def demo_scrub_endpoint(request: DemoScrubRequest) -> ScrubResponse:
    """The scrub-only demo: a visitor without an account pastes a text and gets
    the placeholders back. Same detector as /scrub, default options.

    Off unless DEMO_SCRUB_ENABLED (404, so the surface does not exist on a
    self-hosted instance by default). Capped in length (413), rate-limited per
    IP by the middleware (429) and process-wide here (503). The text is handled
    for this one request and is neither stored nor logged; no model is called.
    """
    if not settings.demo_scrub_enabled:
        raise HTTPException(status_code=404, detail="demo not enabled")
    if len(request.text) > settings.demo_scrub_max_chars:
        raise HTTPException(
            status_code=413,
            detail=f"demo texts are limited to {settings.demo_scrub_max_chars} characters",
        )
    if not ratelimit.allow_global("demo-scrub", settings.demo_scrub_global_per_minute, 60):
        raise HTTPException(status_code=503, detail="demo busy, try again in a minute")
    # The indexed style the app uses ([EMAIL_1]); the plain default would hand the
    # page [EMAIL], which its placeholder regex does not recognise.
    options = ScrubOptions(
        language="auto",
        language_hint=request.language_hint,
        show_entities=True,
        placeholder_style="indexed",
    )
    return await scrubber.scrub(request.text, options)


@app.post("/ocr/cloud", response_model=OcrCloudResponse)
async def ocr_cloud_endpoint(
    request: OcrCloudRequest, user: auth.User = Depends(auth.current_active_user)
) -> OcrCloudResponse:
    """Cloud OCR fallback for photos the on-device reader couldn't handle.

    Only ever called after the user explicitly confirmed the escalation in the
    scan dialog (the default path is fully on-device). The image is validated
    (magic bytes, size cap), relayed once to the vision model with OpenRouter
    ZDR routing enforced, and discarded - nothing is stored or logged.
    """
    api_key = key_resolver.resolve_openrouter_key(user.id)
    if not api_key:
        raise HTTPException(status_code=503, detail="no AI access key for cloud text recognition")
    try:
        image = base64.b64decode(request.image_b64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="invalid image encoding") from exc
    if len(image) > ocr_cloud.MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    mime = ocr_cloud.sniff_image_mime(image)
    if mime is None:
        raise HTTPException(
            status_code=415, detail="unsupported image type — send a JPEG, PNG or WebP"
        )
    try:
        text, model_used = await ocr_cloud.transcribe(image, mime, api_key=api_key)
    except provider.ProviderError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    return OcrCloudResponse(text=text, model=model_used)


@app.get("/health", response_model=HealthResponse)
async def health_endpoint() -> HealthResponse:
    """Liveness probe plus the state of the DETECTION stack.

    Reports the state of the in-process detection stack - the only detector
    there is. Nothing here may describe a component that cannot be configured:
    that is confident readiness about a detector that does not run.
    """
    ner_ready = ner.is_ready()
    gliner_loaded = False
    if settings.gliner_enabled:
        import gliner_detect

        gliner_loaded = gliner_detect.is_loaded()

    # Detection is entirely in-process - spaCy + GLiNER + the regex net. There
    # is no remote extraction tier, so there is no backend to name and no
    # endpoint to probe: pii_ready is the local stack's readiness.
    return HealthResponse(
        status="ok",
        version=settings.version,
        ner_ready=ner_ready,
        pii_ready=ner_ready and (gliner_loaded or not settings.gliner_enabled),
        gliner_enabled=settings.gliner_enabled,
        gliner_loaded=gliner_loaded,
        signup_invite_required=bool(settings.signup_invite_code),
        region=region.region(),
        web_search_available=region.web_search_available(),
        email_verification_required=settings.email_verification_required,
        demo_scrub_enabled=settings.demo_scrub_enabled,
        demo_scrub_max_chars=settings.demo_scrub_max_chars,
        demo_contact_url=settings.demo_contact_url,
        demo_contact_email=settings.demo_contact_email,
    )


@app.get("/entities", response_model=list[EntityTypeInfo])
async def entities_endpoint() -> list[EntityTypeInfo]:
    """List every supported entity type with its placeholder and description."""
    return [EntityTypeInfo(**entry) for entry in scrubber.ENTITY_CATALOG]


@app.get("/models", response_model=list[ChatModelInfo])
async def models_endpoint(
    user: auth.User | None = Depends(auth.current_user_optional),
) -> list[ChatModelInfo]:
    """Chat model catalog - global connections plus the caller's own, if signed in."""
    return connections.chat_catalog(user.id if user else None)


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    request: ChatRequest, user: auth.User = Depends(auth.current_active_user)
) -> ChatResponse:
    """Relay an already-scrubbed conversation to the selected provider."""
    resolved = connections.resolve_for_chat(request.connection_id, user.id)
    if not resolved:
        raise HTTPException(status_code=503, detail="no AI access key for this provider")
    base_url, api_key = resolved
    try:
        answer, model_used = await provider.chat_complete(
            request.model,
            request.messages,
            protected=request.protected,
            api_key=api_key,
            base_url=base_url,
            reasoning_effort=request.reasoning_effort,
        )
    except provider.ProviderError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    return ChatResponse(answer=answer, model=model_used)


# Interval between SSE heartbeat comments while the provider is silent. Router/
# meta models (openrouter/fusion: fan-out + judge step) can "think" for minutes
# without emitting a single token; OpenRouter keeps its leg alive with
# ": OPENROUTER PROCESSING" comments, which provider.chat_stream consumes - but
# without this nothing flows on the client leg, and idle streamed responses are cut by
# proxies (Cloudflare drops them after ~100 s of no bytes -> the reported
# "Verbindung verloren" mid-answer on fusion). Comments are invisible to the
# client parser (it only reads `data:` lines), so this is pure keep-alive.
STREAM_HEARTBEAT_SECONDS = 20.0


# Strong references to in-flight generation tasks: asyncio only holds weak
# refs, so without this a backgrounded job could be garbage-collected mid-answer.
_JOB_TASKS: set[asyncio.Task] = set()


@app.post("/chat/stream")
async def chat_stream_endpoint(
    request: ChatRequest, user: auth.User = Depends(auth.current_active_user)
) -> StreamingResponse:
    """Stream the selected provider's reply token-by-token as Server-Sent Events."""
    resolved = connections.resolve_for_chat(request.connection_id, user.id)
    if not resolved:
        raise HTTPException(status_code=503, detail="no AI access key for this provider")
    base_url, api_key = resolved

    # Generation runs in a BACKGROUND task writing into a job buffer; this
    # response only follows that buffer. So a phone that gets backgrounded (page
    # frozen, socket dropped) does not kill the answer - the client reconnects
    # via /chat/stream/resume and picks up where it left off. See stream_jobs.py
    # for the retention/ZK note.
    job = stream_jobs.create(user.id)
    agen = provider.chat_stream(
        request.model,
        request.messages,
        protected=request.protected,
        api_key=api_key,
        base_url=base_url,
        reasoning_effort=request.reasoning_effort,
        tools=request.tools,
        web_search=request.web_search,
        image_output=request.image_output,
    ).__aiter__()
    task = asyncio.ensure_future(stream_jobs.pump(job, agen, provider.ProviderError))
    _JOB_TASKS.add(task)
    task.add_done_callback(_JOB_TASKS.discard)

    async def event_stream():
        # First line names the job so the client can resume it later.
        yield f"data: {json.dumps({'job': job.id})}\n\n"
        async for event in stream_jobs.follow(job, 0, STREAM_HEARTBEAT_SECONDS):
            if event is None:
                yield ": ping\n\n"  # provider silent - keep the client leg alive
            else:
                yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/chat/stream/resume")
async def chat_stream_resume_endpoint(
    job: str,
    from_index: int = 0,
    user: auth.User = Depends(auth.current_active_user),
) -> StreamingResponse:
    """Re-attach to a running (or just-finished) generation.

    `from_index` is how many data events the client already applied, so the
    replay is exact and its incremental `raw += delta` accumulation stays
    correct. Unknown/expired/foreign job -> 404, and the client falls back to its
    normal Retry path. Jobs live in RAM only and are user-scoped.
    """
    live = stream_jobs.get(job, user.id)
    if live is None:
        raise HTTPException(status_code=404, detail="stream job not found or expired")

    async def event_stream():
        yield f"data: {json.dumps({'job': live.id})}\n\n"
        async for event in stream_jobs.follow(live, from_index, STREAM_HEARTBEAT_SECONDS):
            if event is None:
                yield ": ping\n\n"
            else:
                yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/settings", response_model=SettingsResponse)
async def get_settings_endpoint(
    user: auth.User | None = Depends(auth.current_user_optional),
) -> SettingsResponse:
    """Non-secret settings: connections (incl. the caller's own), model catalog, PII."""
    return _settings_response(user.id if user else None)


@app.put("/settings/openrouter-key", response_model=SettingsResponse)
async def set_openrouter_key_endpoint(
    body: OpenRouterKeyRequest,
    user: auth.User = Depends(auth.current_active_user),
) -> SettingsResponse:
    """Set this user's own OpenRouter key (write-only; never returned). Overrides
    their provisioned sub-key / the global key for their own chat + PII billing.

    Verified before it is stored: the override wins over the sub-key, so a
    pasted OpenAI/Anthropic key would silently break every chat until the user
    found and removed it. An empty body clears the override, no check needed."""
    if body.api_key.strip():
        try:
            await openrouter_keycheck.verify_openrouter_key(body.api_key)
        except openrouter_keycheck.KeyRejected as exc:
            raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    user_settings.set_openrouter_key(user.id, body.api_key)
    return _settings_response(user.id)


@app.put("/settings/models", response_model=SettingsResponse)
async def set_models_endpoint(
    body: ModelsConfigRequest,
    user: auth.User = Depends(auth.current_active_user),
) -> SettingsResponse:
    """Set which models this user has disabled (greyed out) in their dropdown."""
    user_settings.set_disabled_ids(user.id, body.disabled_ids)
    return _settings_response(user.id)


async def _admin_session(user: auth.User = Depends(auth.current_active_user)) -> auth.User:
    """The global connections are the operator's: their base_url is where every
    user's chat goes, with the operator's key attached. Gated on the admin role
    because accounts are active on creation - "any active account" would mean
    anyone on the internet could repoint them."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    return user


@app.put("/settings/connections/{cid}", response_model=SettingsResponse)
async def upsert_connection_endpoint(
    cid: str,
    body: ConnectionUpsertRequest,
    user: auth.User = Depends(_admin_session),
) -> SettingsResponse:
    """Update the operator's shared OpenRouter model catalog, or a global custom
    connection - ADMIN only. Per-user provider keys live on /settings/my-connections
    and /settings/openrouter-key - this endpoint never sets a shared secret key
    (the built-in OpenRouter key is env/operator-managed)."""
    if cid == connections.OPENROUTER_ID:
        # The shared exposed-model list (catalog curation); the KEY is per-user
        # (/settings/openrouter-key) or env - never set a global key here.
        if body.models is not None:
            settings_store.set_openrouter_models(body.models)
    else:
        existing = settings_store.get_custom_connection(cid)
        try:
            settings_store.upsert_custom_connection(
                cid,
                label=body.label if body.label is not None else (existing or {}).get("label", cid),
                base_url=body.base_url
                if body.base_url is not None
                else (existing or {}).get("base_url", ""),
                models=body.models if body.models is not None else (existing or {}).get("models", []),
                api_key=body.api_key,
            )
        except net_guard.UnsafeUrlError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _settings_response(user.id)


@app.delete("/settings/connections/{cid}", response_model=SettingsResponse)
async def delete_connection_endpoint(
    cid: str, user: auth.User = Depends(_admin_session)
) -> SettingsResponse:
    """Remove a global custom connection (the built-in OpenRouter connection cannot
    be deleted) - ADMIN only. Per-user connections are removed via
    /settings/my-connections."""
    if cid == connections.OPENROUTER_ID:
        raise HTTPException(status_code=400, detail="the OpenRouter connection cannot be removed")
    settings_store.delete_custom_connection(cid)
    return _settings_response(user.id)


@app.get("/settings/connections/{cid}/catalog", response_model=list[CatalogModel])
async def connection_catalog_endpoint(
    cid: str, _user: auth.User = Depends(auth.current_active_user)
) -> list[CatalogModel]:
    """Fetch a global connection's available models (OpenRouter / operator customs)."""
    return await _catalog(cid, None)


# --- per-user (BYOK) connections (auth-gated) ------------------------------
@app.put("/settings/my-connections/{cid}", response_model=SettingsResponse)
async def upsert_my_connection_endpoint(
    cid: str,
    body: ConnectionUpsertRequest,
    user: auth.User = Depends(auth.current_active_user),
) -> SettingsResponse:
    """Create/update one of the caller's own OpenAI-compatible providers. The
    api_key is sealed at rest and never returned (omit/empty to keep it)."""
    if cid == connections.OPENROUTER_ID:
        raise HTTPException(status_code=400, detail="'openrouter' is a reserved connection id")
    existing = user_connections.get_for_user(user.id, cid)
    try:
        user_connections.upsert(
            user.id,
            cid,
            label=body.label if body.label is not None else (existing or {}).get("label", cid),
            base_url=body.base_url if body.base_url is not None else (existing or {}).get("base_url", ""),
            models=body.models if body.models is not None else (existing or {}).get("models", []),
            api_key=body.api_key,
        )
    except net_guard.UnsafeUrlError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:  # server secret not configured -> can't seal the key
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _settings_response(user.id)


@app.delete("/settings/my-connections/{cid}", response_model=SettingsResponse)
async def delete_my_connection_endpoint(
    cid: str, user: auth.User = Depends(auth.current_active_user)
) -> SettingsResponse:
    """Remove one of the caller's own connections."""
    user_connections.delete(user.id, cid)
    return _settings_response(user.id)


@app.get("/settings/my-connections/{cid}/catalog", response_model=list[CatalogModel])
async def my_connection_catalog_endpoint(
    cid: str, user: auth.User = Depends(auth.current_active_user)
) -> list[CatalogModel]:
    """Fetch the model catalog for one of the caller's own connections."""
    return await _catalog(cid, user.id)


async def _catalog(cid: str, user_id: str | None) -> list[CatalogModel]:
    resolved = connections.resolve_catalog(cid, user_id)
    if not resolved:
        raise HTTPException(status_code=400, detail="this connection has no API key configured")
    base_url, key = resolved
    try:
        rows = await provider.list_provider_models(base_url, key)
    except provider.ProviderError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc)) from exc
    return [CatalogModel(**r) for r in rows]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=False)
