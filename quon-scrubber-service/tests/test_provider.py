"""Unit tests for the chat relay request builder (no network)."""

from __future__ import annotations

import pytest

import provider
from models import ChatTurn


def _payload(reasoning_effort):
    _, payload, _ = provider._build_request(
        "some/model",
        [ChatTurn(role="user", content="hi")],
        stream=True,
        api_key="test-key",
        reasoning_effort=reasoning_effort,
    )
    return payload


def test_reasoning_added_for_valid_effort():
    for effort in ("low", "medium", "high"):
        assert _payload(effort)["reasoning"] == {"effort": effort}


@pytest.mark.parametrize("effort", [None, "", "off", "ultra", "HIGH", "max"])
def test_reasoning_omitted_when_absent_or_invalid(effort):
    # None/off/omitted -> no reasoning param; a bad value must never reach the provider.
    assert "reasoning" not in _payload(effort)


def test_reasoning_effort_defaults_to_omitted():
    _, payload, _ = provider._build_request(
        "some/model", [ChatTurn(role="user", content="hi")], stream=False, api_key="k"
    )
    assert "reasoning" not in payload


# ---------------------------------------------------------------------------
# friendly_provider_error - upstream failures become actionable user messages
# ---------------------------------------------------------------------------


def test_friendly_error_402_credits_exhausted():
    body = b'{"error": {"message": "Insufficient credits. Add more using https://openrouter.ai/settings/credits"}}'
    msg = provider.friendly_provider_error(402, body)
    assert "budget is used up" in msg
    assert "Settings" in msg
    # The upstream top-up URL is misleading for provisioned sub-keys - must not leak.
    assert "openrouter.ai" not in msg


def test_friendly_error_key_limit_exceeded():
    body = b'{"error": {"message": "Key limit exceeded"}}'
    assert "budget is used up" in provider.friendly_provider_error(403, body) or \
        "budget is used up" in provider.friendly_provider_error(402, body)


def test_friendly_error_bad_key():
    msg = provider.friendly_provider_error(401, b'{"error": {"message": "No auth credentials found"}}')
    assert "rejected" in msg and "key" in msg


def test_friendly_error_rate_limit():
    msg = provider.friendly_provider_error(429, b'{"error": {"message": "Rate limit exceeded"}}')
    assert "rate-limiting" in msg


def test_friendly_error_falls_back_to_raw():
    msg = provider.friendly_provider_error(500, b'{"error": {"message": "internal fizzle"}}')
    assert "internal fizzle" in msg and "500" in msg


# --- streaming: mid-stream error must be surfaced, not swallowed ------------
import asyncio  # noqa: E402


class _FakeResp:
    def __init__(self, lines, status_code=200):
        self.status_code = status_code
        self._lines = lines

    async def aiter_lines(self):
        for line in self._lines:
            yield line

    async def aread(self):
        return b""


class _FakeStream:
    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self._resp

    async def __aexit__(self, *a):
        return False


class _FakeClient:
    def __init__(self, resp):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def stream(self, *a, **k):
        return _FakeStream(self._resp)


async def _collect(lines):
    out = []
    async for delta in provider.chat_stream(
        "openrouter/fusion", [ChatTurn(role="user", content="hi")], api_key="k", base_url=None
    ):
        out.append(delta)
    return out


def _patch_stream(monkeypatch, lines):
    resp = _FakeResp(lines)
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda *a, **k: _FakeClient(resp))


def test_stream_surfaces_mid_stream_error_after_a_preamble(monkeypatch):
    # A router/meta model (fusion) streams a preamble delta, then fails with an
    # error chunk (no `choices`). That error must be raised - not silently dropped
    # leaving the client hanging on the half-answer.
    _patch_stream(
        monkeypatch,
        [
            'data: {"choices": [{"delta": {"content": "Fusion is running…"}}]}',
            'data: {"error": {"message": "upstream model unavailable"}}',
        ],
    )
    with pytest.raises(provider.ProviderError) as ei:
        asyncio.run(_collect(None))
    assert "upstream model unavailable" in str(ei.value)


def test_stream_yields_deltas_and_stops_on_done(monkeypatch):
    _patch_stream(
        monkeypatch,
        [
            ": OPENROUTER PROCESSING",  # keep-alive comment - skipped, not an error
            'data: {"choices": [{"delta": {"content": "Hello "}}]}',
            'data: {"choices": [{"delta": {"content": "world"}}]}',
            "data: [DONE]",
            'data: {"choices": [{"delta": {"content": "IGNORED after done"}}]}',
        ],
    )
    assert asyncio.run(_collect(None)) == ["Hello ", "world"]


def test_stream_forwards_reasoning_as_a_distinct_event(monkeypatch):
    # Reasoning ("thinking") deltas come on a separate `reasoning` field for
    # reasoning models; they must be yielded as their own {reasoning: ...} event,
    # never mixed into the answer text.
    _patch_stream(
        monkeypatch,
        [
            'data: {"choices": [{"delta": {"reasoning": "Let me think… "}}]}',
            'data: {"choices": [{"delta": {"reasoning": "step 2."}}]}',
            'data: {"choices": [{"delta": {"content": "The answer."}}]}',
            "data: [DONE]",
        ],
    )
    assert asyncio.run(_collect(None)) == [
        {"reasoning": "Let me think… "},
        {"reasoning": "step 2."},
        "The answer.",
    ]


# --- streaming: tool-call fragments accumulate into one event ----------------


def test_stream_accumulates_tool_calls_into_one_event(monkeypatch):
    _patch_stream(
        monkeypatch,
        [
            'data: {"choices": [{"delta": {"content": "Ich rufe das Tool auf."}}]}',
            'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call_1", '
            '"function": {"name": "get_events", "arguments": "{\\"day\\": "}}]}}]}',
            'data: {"choices": [{"delta": {"tool_calls": [{"index": 0, '
            '"function": {"arguments": "\\"monday\\"}"}}]}}]}',
            'data: {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]}',
            "data: [DONE]",
        ],
    )
    out = asyncio.run(_collect([]))
    assert out[0] == "Ich rufe das Tool auf."
    assert out[1] == {
        "tool_calls": [{"id": "call_1", "name": "get_events", "arguments": '{"day": "monday"}'}]
    }
    assert len(out) == 2  # flushed exactly once (finish_reason, not again on DONE)


def test_build_request_passes_tools_and_tool_turns():
    turns = [
        ChatTurn(role="user", content="Wann ist mein Termin?"),
        ChatTurn(
            role="assistant",
            content="",
            tool_calls=[
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "get_events", "arguments": "{}"},
                }
            ],
        ),
        ChatTurn(role="tool", content="[DATUM_1] 14:00", tool_call_id="call_1"),
    ]
    tools = [{"type": "function", "function": {"name": "get_events", "parameters": {}}}]
    _url, payload, _headers = provider._build_request(
        "openrouter/auto", turns, stream=True, api_key="k", tools=tools
    )
    assert payload["tools"] == tools
    assistant = payload["messages"][2]
    assert assistant["tool_calls"][0]["id"] == "call_1"
    tool_turn = payload["messages"][3]
    assert tool_turn == {"role": "tool", "content": "[DATUM_1] 14:00", "tool_call_id": "call_1"}


def test_web_search_plugin_only_on_openrouter_endpoint(monkeypatch):
    """web_search adds OpenRouter's plugins field - but never for a custom
    OpenAI-compatible endpoint (it would reject the unknown field)."""
    from config import settings

    from models import ChatTurn

    msgs = [ChatTurn(role="user", content="Gibt es den Oura Ring 5?")]
    _url, payload, _h = provider._build_request(
        "~anthropic/claude-sonnet-latest", msgs, stream=True, api_key="k", web_search=True
    )
    assert {"type": "openrouter:web_search"} in payload["tools"]
    # Only web_search. Attaching `web_fetch` or `datetime` was measured against
    # the live instance to delay the first token to ~10 s and suppress streaming
    # on every message - even ones the model never searched for. Re-adding
    # either must fail this test, not quietly cost every user 9 seconds.
    assert payload["tools"] == [{"type": "openrouter:web_search"}]

    # Custom BYOK endpoint: plugins must not be attached.
    _url, payload, _h = provider._build_request(
        "some/model", msgs, stream=True, api_key="k",
        base_url="https://my-own-endpoint.example.com/v1", web_search=True,
    )
    assert "tools" not in payload

    # Toggle off: nothing attached even on OpenRouter.
    _url, payload, _h = provider._build_request(
        "openai/gpt-5-mini", msgs, stream=True, api_key="k", web_search=False
    )
    assert "tools" not in payload

    # Coexists with client (MCP) function tools in one array.
    mcp_tools = [{"type": "function", "function": {"name": "mcp__s__t", "parameters": {}}}]
    _url, payload, _h = provider._build_request(
        "openai/gpt-5-mini", msgs, stream=True, api_key="k", tools=mcp_tools, web_search=True
    )
    assert payload["tools"][0]["type"] == "function"
    assert {"type": "openrouter:web_search"} in payload["tools"][1:]


def test_system_prompt_states_todays_date():
    """Today's date is stated in the system prompt rather than fetched through
    the `openrouter:datetime` tool - free, instead of a ~10 s stall per message."""
    from models import ChatTurn

    _url, payload, _h = provider._build_request(
        "openai/gpt-5-mini", [ChatTurn(role="user", content="Welcher Tag ist heute?")],
        stream=False, api_key="k",
    )
    system = payload["messages"][0]
    assert system["role"] == "system"
    assert f"Today's date is {provider._today()}." in system["content"]


# --- streaming: web-search citations (annotations) ---------------------------


def test_stream_forwards_web_search_citations(monkeypatch):
    # With the agentic web_search tool the model's sources arrive as
    # `annotations` on a delta. They must surface as their own event so the UI
    # can render a "Sources" strip - only url+title, never the page excerpt.
    _patch_stream(
        monkeypatch,
        [
            'data: {"choices": [{"delta": {"annotations": [{"type": "url_citation",'
            ' "url_citation": {"url": "https://a.example/x", "title": "A",'
            ' "content": "page text we drop"}}]}}]}',
            'data: {"choices": [{"delta": {"content": "The answer."}}]}',
            "data: [DONE]",
        ],
    )
    assert asyncio.run(_collect(None)) == [
        {"annotations": [{"url": "https://a.example/x", "title": "A"}]},
        "The answer.",
    ]


def test_stream_citations_dedupe_and_accept_message_shape(monkeypatch):
    # Providers repeat the full annotation list on later chunks, and may put it
    # on the finished `message` instead of a delta - each URL is forwarded once.
    _patch_stream(
        monkeypatch,
        [
            'data: {"choices": [{"delta": {"annotations": [{"type": "url_citation",'
            ' "url_citation": {"url": "https://a.example/x", "title": "A"}}]}}]}',
            'data: {"choices": [{"delta": {}, "message": {"annotations":'
            ' [{"url_citation": {"url": "https://a.example/x", "title": "A"}},'
            ' {"url_citation": {"url": "https://b.example/y", "title": "B"}}]}}]}',
            "data: [DONE]",
        ],
    )
    assert asyncio.run(_collect(None)) == [
        {"annotations": [{"url": "https://a.example/x", "title": "A"}]},
        {"annotations": [{"url": "https://b.example/y", "title": "B"}]},
    ]


def test_stream_ignores_malformed_annotations(monkeypatch):
    # A citation is a nice-to-have: junk in the annotations array must never
    # break the answer stream.
    _patch_stream(
        monkeypatch,
        [
            'data: {"choices": [{"delta": {"annotations": ["nonsense", {"no_url": 1},'
            ' {"url_citation": {"title": "no url"}}]}}]}',
            'data: {"choices": [{"delta": {"content": "Still fine."}}]}',
            "data: [DONE]",
        ],
    )
    assert asyncio.run(_collect(None)) == ["Still fine."]


# --- Image generation ------------------------------------------------------


def test_build_request_asks_for_images_only_when_told():
    _, payload, _ = provider._build_request(
        "google/gemini-2.5-flash-image", [ChatTurn(role="user", content="hi")], stream=True,
        api_key="k", image_output=True,
    )
    assert payload["modalities"] == ["image", "text"]
    # Text sends carry nothing extra - the send-path latency rule.
    _, payload, _ = provider._build_request(
        "openrouter/fusion", [ChatTurn(role="user", content="hi")], stream=True, api_key="k"
    )
    assert "modalities" not in payload


def test_stream_forwards_generated_images_as_events(monkeypatch):
    png = "data:image/png;base64,iVBORw0KGgo="
    _patch_stream(
        monkeypatch,
        [
            'data: {"choices":[{"delta":{"content":"Here you go"}}]}',
            'data: {"choices":[{"delta":{"images":[{"type":"image_url","image_url":{"url":"'
            + png
            + '"}}]}}]}',
            # A provider that only fills the final message is covered too.
            'data: {"choices":[{"delta":{},"message":{"images":[{"type":"image_url","image_url":{"url":"'
            + png
            + '"}}]}}]}',
            # Not a data URL -> ignored, never forwarded.
            'data: {"choices":[{"delta":{"images":[{"type":"image_url","image_url":{"url":"https://x/y.png"}}]}}]}',
            "data: [DONE]",
        ],
    )
    out = asyncio.run(_collect([]))
    assert out == ["Here you go", {"image": png}, {"image": png}]


class _RefusedResp(_FakeResp):
    """A non-200 answer whose body carries OpenRouter's reason."""

    def __init__(self, status_code, body):
        super().__init__([], status_code=status_code)
        self._body = body

    async def aread(self):
        return self._body


def test_stream_refusal_logs_the_upstream_reason_for_the_operator(monkeypatch, caplog):
    # The user sees a friendly "key rejected" (then "connection
    # lost"); the operator sees only httpx's bare "401 Unauthorized" and could
    # not tell a disabled sub-key from a wrong one. The reason must be logged - 
    # the key itself never is.
    resp = _RefusedResp(401, b'{"error": {"message": "Key has been disabled", "code": 401}}')
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda *a, **k: _FakeClient(resp))
    with caplog.at_level("WARNING", logger="quon.provider"):
        with pytest.raises(provider.ProviderError) as ei:
            asyncio.run(_collect(None))
    assert "rejected this account's API key" in str(ei.value)
    logged = [r.getMessage() for r in caplog.records if "openrouter refused" in r.getMessage()]
    assert logged and "401" in logged[0] and "Key has been disabled" in logged[0]
    assert "sk-or-" not in logged[0]
