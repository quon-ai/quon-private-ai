"""OpenRouter chat-completion client (blocking + streaming).

The provider API key lives server-side (runtime settings store / .env) and never
reaches the browser. The browser sends already-scrubbed text here; this module
relays it to OpenRouter and returns/streams the assistant reply.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime, timezone

import httpx

import net_guard
import region
import settings_store
from config import settings
from models import ChatTurn

logger = logging.getLogger("quon.provider")

# Fixed model catalog served by GET /models (the frontend dropdown mirrors it).
# "id" is the OpenRouter slug; "Auto" uses OpenRouter's own router.
CHAT_MODELS: list[dict] = [
    {"label": "Auto", "id": "openrouter/auto", "disabled": False},
    {"label": "Claude Sonnet", "id": "anthropic/claude-sonnet-4.5", "disabled": False},
    {"label": "ChatGPT", "id": "openai/gpt-4o", "disabled": False},
    {"label": "Gemini Pro", "id": "google/gemini-2.5-pro", "disabled": False},
    {"label": "Local", "id": "local", "disabled": True},
]

# Used when the message was scrubbed (filter active): tells the model to keep
# QUON placeholders intact so they can be re-hydrated client-side.
SYSTEM_PROMPT_PROTECTED = (
    "You are a helpful assistant accessed through QUON, a privacy gateway. The "
    "user's messages may contain placeholder tokens such as [PERSON_1], "
    "[EMAIL_1], [TELEFON_1], [IBAN_1], [AMOUNT_1], [DATE_1], [PIN_1]. Each "
    "placeholder stands for a piece of personal data that was redacted before it "
    "reached you. Treat every placeholder as an opaque identifier: do not guess "
    "what it represents, and keep the exact same placeholders verbatim in your "
    "reply so they can be restored locally. Answer in the user's language."
    " When you produce a COMPLETE standalone document or web page (not a short snippet), output it as a SINGLE fenced code block tagged ```markdown or ```html so it can be saved as a document."
    " If that document itself contains fenced code blocks (a diagram, a snippet), open and close the OUTER fence with FOUR backticks (````markdown) so the inner ``` fences stay intact."
)

# Used when the filter is off: a neutral prompt with no mention of redaction so
# the model does not apply its own privacy heuristics to real text.
SYSTEM_PROMPT_UNPROTECTED = (
    "You are a helpful assistant. Answer in the user's language."
    " When you produce a COMPLETE standalone document or web page (not a short snippet), output it as a SINGLE fenced code block tagged ```markdown or ```html so it can be saved as a document."
    " If that document itself contains fenced code blocks (a diagram, a snippet), open and close the OUTER fence with FOUR backticks (````markdown) so the inner ``` fences stay intact."
)


def _today() -> str:
    """Today in UTC, ISO-8601. Its own function so tests can pin the line."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class ProviderError(RuntimeError):
    """An error talking to the provider. ``status`` is the HTTP code to surface."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


def _extract_error(body: bytes | str) -> str:
    try:
        parsed = json.loads(body)
        if isinstance(parsed, dict):
            err = parsed.get("error")
            if isinstance(err, dict) and err.get("message"):
                return str(err["message"])
            if isinstance(err, str):
                return err
    except (ValueError, TypeError):
        pass
    text = body.decode("utf-8", "ignore") if isinstance(body, bytes) else body
    return (text or "unknown error")[:200]


def friendly_provider_error(status_code: int, body: bytes | str) -> str:
    """Turn an upstream provider failure into a message a user can act on.

    The raw upstream text is technical ("Insufficient credits. Add more using
    https://openrouter.ai/...") and, for provisioned sub-keys, actively misleading - 
    the user cannot top up a key they don't own. Map the known cases (credit/
    spend-cap exhaustion, bad key, rate limit) to plain guidance and fall back to
    the raw message for everything else.
    """
    raw = _extract_error(body)
    low = raw.lower()
    if status_code == 429 or "rate limit" in low:
        return "The model provider is rate-limiting right now — wait a moment and try again."
    if status_code == 402 or "insufficient credits" in low or "spend limit" in low or (
        "limit" in low and "exceeded" in low
    ):
        return (
            "Your AI budget is used up — this account's included credit or its "
            "spending cap has been reached. Add your own provider API key under "
            "Settings → Providers to keep chatting."
        )
    if "data region" in low or "region-specific endpoint" in low:
        return (
            "This model is not available with EU routing — pick another model "
            "from the list."
        )
    if status_code in (401, 403):
        return (
            "The AI provider rejected this account's API key. If you added your "
            "own key, check it under Settings → Providers."
        )
    return f"Provider error {status_code}: {raw}"


_REASONING_EFFORTS = ("low", "medium", "high")


def _build_request(
    model: str,
    messages: list[ChatTurn],
    stream: bool,
    protected: bool = True,
    api_key: str | None = None,
    base_url: str | None = None,
    reasoning_effort: str | None = None,
    tools: list[dict] | None = None,
    web_search: bool = False,
    image_output: bool = False,
) -> tuple[str, dict, dict]:
    # Prefer the caller-resolved key (per-connection / per-user sub-key); fall
    # back to the global OpenRouter key for self-host / dev (BYOK).
    key = api_key or settings_store.get_openrouter_key()
    if not key:
        raise ProviderError(
            "This provider is not configured — add its API key in Settings.", status=503
        )
    endpoint = (base_url or region.chat_base_url()).rstrip("/")
    system_prompt = SYSTEM_PROMPT_PROTECTED if protected else SYSTEM_PROMPT_UNPROTECTED
    # Today's date, stated outright. This replaces OpenRouter's
    # `openrouter:datetime` server tool, which was measured to stall every
    # request by ~10 s (see the tool block below) to deliver one short string.
    system_prompt = f"{system_prompt}\n\nToday's date is {_today()}."
    def turn(m: ChatTurn) -> dict:
        out: dict = {"role": m.role, "content": m.content}
        # Function-calling turns (MCP): pass the OpenAI-shape fields through.
        if m.tool_calls:
            out["tool_calls"] = m.tool_calls
        if m.tool_call_id:
            out["tool_call_id"] = m.tool_call_id
        return out

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            *(turn(m) for m in messages),
        ],
        "stream": stream,
    }
    if tools:
        # Copy - the web-search append below must not mutate the caller's list.
        payload["tools"] = list(tools)
    # OpenRouter's agentic web SEARCH (executed on OpenRouter's side; the MODEL
    # decides when to invoke it - vendor-app comfort). Cost accrues only per
    # search actually performed. Coexists with client (MCP) function tools in
    # the same array. Gated to the real OpenRouter endpoint - custom
    # OpenAI-compatible providers don't know the type.
    #
    # Only web_search. `openrouter:web_fetch` and `openrouter:datetime` were
    # attached here too and turned out to be the single biggest latency defect
    # in the product: measured against the live instance, merely ATTACHING
    # either one delayed the first token to ~10.1 s and suppressed streaming
    # entirely (the whole answer arrived in one chunk), on questions the model
    # never even searched for - zero citations came back. Isolated per tool,
    # first-token on "how does a heat pump work":
    #     none 1.5-2.2 s | web_search 1.8-2.3 s | datetime 10.1 s | web_fetch
    #     10.2-10.9 s (Gemini Flash; datetime also 10.1 s on Claude Sonnet)
    # So web_search is free and the other two cost ~9 s on every message. The
    # date they were partly there for is now simply stated in the system prompt
    # above, and "read this URL" is already served by POST /fetch-url.
    # ...and not in EU routing: the plugin is refused there for every model
    # ("Web search is not available in your data region"), so it is never sent.
    if web_search and endpoint == settings.openrouter_base_url.rstrip("/") and not region.is_eu():
        payload.setdefault("tools", []).append({"type": "openrouter:web_search"})
    # OpenRouter's unified reasoning param - normalizes effort across o-series
    # (effort) and Anthropic/Gemini (token budget). Models without reasoning ignore
    # it. Only send a validated value so bad input can't reach the provider.
    if reasoning_effort in _REASONING_EFFORTS:
        payload["reasoning"] = {"effort": reasoning_effort}
    # Image generation: OpenRouter's `modalities` asks an image-capable
    # model for a picture alongside text; it streams back as `delta.images`
    # (base64 data URLs). Sent only when the client asked - text models ignore
    # or reject the field, and nothing rides on every request unmeasured.
    if image_output:
        payload["modalities"] = ["image", "text"]
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        # Attribution headers are OpenRouter-specific but harmless to other
        # OpenAI-compatible providers (they ignore unknown headers).
        "HTTP-Referer": settings.openrouter_app_url,
        "X-Title": settings.openrouter_app_name,
    }
    url = f"{endpoint}/chat/completions"
    return url, payload, headers


async def list_provider_models(base_url: str, api_key: str) -> list[dict]:
    """Fetch a provider's ``/models`` catalog (OpenAI-compatible). Returns a list
    of ``{"id", "name"}`` dicts. Raises :class:`ProviderError` on failure."""
    url = f"{base_url.rstrip('/')}/models"
    # SSRF re-check at request time (the catalog returns the upstream body, so this
    # is the non-blind path; re-validating here also defeats DNS rebinding).
    try:
        await asyncio.to_thread(net_guard.validate_public_url, url)
    except net_guard.UnsafeUrlError as exc:
        raise ProviderError(str(exc), status=400) from exc
    headers = {"Authorization": f"Bearer {api_key}"}
    try:
        async with httpx.AsyncClient(timeout=settings.openrouter_timeout) as client:
            response = await client.get(url, headers=headers)
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise ProviderError(f"Could not reach the provider ({type(exc).__name__}).") from exc
    if response.status_code != 200:
        raise ProviderError(
            f"Provider catalog error {response.status_code}: {_extract_error(response.content)}",
            status=502,
        )
    data = response.json()
    rows = data.get("data", data) if isinstance(data, dict) else data
    out: list[dict] = []
    for row in rows if isinstance(rows, list) else []:
        if isinstance(row, dict) and row.get("id"):
            out.append({"id": str(row["id"]), "name": str(row.get("name") or row["id"])})
    out.sort(key=lambda r: r["id"])
    return out


async def _guard_byok_url(base_url: str | None, url: str) -> None:
    """SSRF re-check at request time for user-supplied (BYOK) ``base_url``. The
    default OpenRouter endpoint is a trusted config constant and skipped; a
    user-configured endpoint is re-validated on every call so a host that resolved
    public when saved can't be rebound to loopback/RFC1918/metadata mid-flight."""
    if not base_url:
        return
    try:
        await asyncio.to_thread(net_guard.validate_public_url, url)
    except net_guard.UnsafeUrlError as exc:
        raise ProviderError(str(exc), status=400) from exc


async def chat_complete(
    model: str,
    messages: list[ChatTurn],
    protected: bool = True,
    api_key: str | None = None,
    base_url: str | None = None,
    reasoning_effort: str | None = None,
    web_search: bool = False,
) -> tuple[str, str]:
    """Blocking completion. Returns ``(answer, model_used)``."""
    url, payload, headers = _build_request(
        model,
        messages,
        stream=False,
        protected=protected,
        api_key=api_key,
        base_url=base_url,
        reasoning_effort=reasoning_effort,
        web_search=web_search,
    )
    await _guard_byok_url(base_url, url)
    try:
        async with httpx.AsyncClient(timeout=settings.openrouter_timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise ProviderError(f"Could not reach OpenRouter ({type(exc).__name__}).") from exc

    if response.status_code != 200:
        logger.warning(
            "openrouter refused chat/completions: %s %s",
            response.status_code,
            _extract_error(response.content),
        )
        raise ProviderError(
            friendly_provider_error(response.status_code, response.content),
            status=502,
        )
    data = response.json()
    try:
        answer = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProviderError("Unexpected response shape from OpenRouter.") from exc
    return answer, data.get("model", model)


def _iter_annotations(delta_obj: dict, choice: dict) -> list[dict]:
    """Flatten a chunk's web-search citations into ``{url, title}`` dicts.

    Providers put them either on the streaming `delta` or on the finished
    `message`, and wrap each one as ``{"type": "url_citation", "url_citation":
    {...}}`` - though some send the fields inline. Unknown or malformed shapes
    are skipped rather than raised: a citation is a nice-to-have, never a reason
    to break the answer stream.
    """
    out: list[dict] = []
    raw = (delta_obj.get("annotations") or []) + (
        (choice.get("message") or {}).get("annotations") or []
    )
    for ann in raw:
        if not isinstance(ann, dict):
            continue
        cite = ann.get("url_citation")
        cite = cite if isinstance(cite, dict) else ann
        if isinstance(cite.get("url"), str):
            out.append(cite)
    return out


def _iter_images(delta_obj: dict, choice: dict) -> list[str]:
    """Data URLs of generated images on a streamed delta or the final message
    (OpenRouter shape: ``images: [{type: "image_url", image_url: {url}}]``)."""
    raw = (delta_obj.get("images") or []) + ((choice.get("message") or {}).get("images") or [])
    out: list[str] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        url = (item.get("image_url") or {}).get("url") if isinstance(item.get("image_url"), dict) else None
        if isinstance(url, str) and url.startswith("data:image/"):
            out.append(url)
    return out


async def chat_stream(
    model: str,
    messages: list[ChatTurn],
    protected: bool = True,
    api_key: str | None = None,
    base_url: str | None = None,
    reasoning_effort: str | None = None,
    tools: list[dict] | None = None,
    web_search: bool = False,
    image_output: bool = False,
) -> AsyncIterator[str | dict]:
    """Stream completion: yields text deltas (str). When the model requests
    tool calls, their streamed fragments are accumulated and one dict event
    ``{"tool_calls": [{id, name, arguments}, ...]}`` is yielded at stream end.
    With ``image_output`` a generated picture arrives as ``{"image": <data URL>}``.
    Raises :class:`ProviderError`."""
    url, payload, headers = _build_request(
        model,
        messages,
        stream=True,
        protected=protected,
        api_key=api_key,
        base_url=base_url,
        reasoning_effort=reasoning_effort,
        tools=tools,
        web_search=web_search,
        image_output=image_output,
    )
    await _guard_byok_url(base_url, url)
    try:
        async with httpx.AsyncClient(timeout=settings.openrouter_timeout) as client:
            async with client.stream("POST", url, json=payload, headers=headers) as response:
                if response.status_code != 200:
                    body = await response.aread()
                    # The user sees the friendly text; the operator needs the
                    # upstream reason (disabled key? limit? model gone?) - httpx
                    # logs only the status. Never the key, never the prompt.
                    logger.warning(
                        "openrouter refused chat/completions: %s %s",
                        response.status_code,
                        _extract_error(body),
                    )
                    raise ProviderError(
                        friendly_provider_error(response.status_code, body),
                        status=502,
                    )
                # Tool-call fragments accumulate by index; flushed as one event.
                pending_calls: dict[int, dict] = {}
                # Citation URLs already forwarded - providers repeat the full
                # annotation list on later chunks, so dedupe by URL.
                seen_citations: set[str] = set()

                def flush_tool_calls() -> dict | None:
                    if not pending_calls:
                        return None
                    calls = [
                        {
                            "id": c.get("id", f"call_{i}"),
                            "name": c.get("name", ""),
                            "arguments": c.get("arguments", ""),
                        }
                        for i, c in sorted(pending_calls.items())
                    ]
                    pending_calls.clear()
                    return {"tool_calls": calls}

                async for line in response.aiter_lines():
                    line = line.strip()
                    # SSE keep-alive comments (": OPENROUTER PROCESSING") and blank
                    # lines aren't data - skip them (they still reset the read timeout,
                    # which is how slow/router models like fusion hold the connection).
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        event = flush_tool_calls()
                        if event:
                            yield event
                        return
                    try:
                        chunk = json.loads(data)
                    except ValueError:
                        continue
                    # A mid-stream provider error - common with meta/router models
                    # (e.g. openrouter fusion) that orchestrate upstream models and
                    # can fail after emitting a preamble. It arrives as a chunk with
                    # an `error` field and no usable `choices`. Surfacing it (instead
                    # of silently dropping it, which leaves the client hanging on a
                    # half-answer) turns "no response" into a clear error the UI can
                    # show + retry.
                    err = chunk.get("error")
                    if err:
                        msg = err.get("message") if isinstance(err, dict) else str(err)
                        raise ProviderError(
                            f"The model failed mid-response: {msg or 'unknown model error'}",
                            status=502,
                        )
                    choice = (chunk.get("choices") or [{}])[0]
                    delta_obj = choice.get("delta", {}) or {}
                    for tc in delta_obj.get("tool_calls") or []:
                        slot = pending_calls.setdefault(tc.get("index", 0), {"arguments": ""})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["arguments"] += fn["arguments"]
                    if choice.get("finish_reason") == "tool_calls":
                        event = flush_tool_calls()
                        if event:
                            yield event
                    # Reasoning ("thinking") tokens - OpenRouter surfaces them in a
                    # separate `reasoning` delta for reasoning models. Forwarded as a
                    # distinct event so the client can show a collapsible thinking
                    # panel; never mixed into the answer text. Contains no user PII
                    # the answer wouldn't (it's the model reasoning over placeholders).
                    reasoning = delta_obj.get("reasoning")
                    if reasoning:
                        yield {"reasoning": reasoning}
                    # Web-search citations. With the agentic `openrouter:web_search`
                    # tool the model's sources arrive as `annotations`
                    # (type "url_citation"), either on a delta or on the final
                    # message. Forwarded as their own event so the client can show
                    # a "Sources" strip. Only url+title travel: the citation's
                    # `content` excerpt is page text we neither need nor want to
                    # store. Public web metadata - no user PII, and it rides the
                    # same E2E-encrypted chat as everything else.
                    new_cites = []
                    for ann in _iter_annotations(delta_obj, choice):
                        url = ann.get("url")
                        if url and url not in seen_citations:
                            seen_citations.add(url)
                            new_cites.append({"url": url, "title": ann.get("title") or ""})
                    if new_cites:
                        yield {"annotations": new_cites}
                    # Generated images. Streaming providers put them on
                    # the delta; a provider that only fills the final message
                    # is covered too. One event per image, the data URL as-is - 
                    # the client stores the bytes sealed on the device.
                    for img in _iter_images(delta_obj, choice):
                        yield {"image": img}
                    delta = delta_obj.get("content")
                    if delta:
                        yield delta
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise ProviderError(f"Could not reach OpenRouter ({type(exc).__name__}).") from exc
