"""/chat/stream SSE heartbeats: while the provider is silent (router/meta models
like openrouter/fusion "think" for minutes between tokens), the endpoint must
keep the CLIENT leg alive with SSE comments — idle streamed responses are cut
by proxies (Cloudflare after ~100 s of no bytes), which surfaced as
"Verbindung verloren" mid-answer on fusion."""

from __future__ import annotations

import asyncio
import json

import main
import connections
import provider
from conftest import make_active_user


def _events(raw: str) -> list[dict]:
    """Content events only. The stream now opens with a {"job": …} announcement
    (resumable streams, stream_jobs.py) — that line is the resume handle, not
    part of the answer, so it is filtered out here."""
    out = []
    for line in raw.split("\n"):
        if line.startswith("data:"):
            payload = json.loads(line[5:].strip())
            if "job" in payload:
                continue
            out.append(payload)
    return out


def _job_id(raw: str) -> str | None:
    for line in raw.split("\n"):
        if line.startswith("data:"):
            payload = json.loads(line[5:].strip())
            if "job" in payload:
                return payload["job"]
    return None


def _stream(client, headers, monkeypatch, gen_factory, heartbeat=0.05):
    monkeypatch.setattr(main, "STREAM_HEARTBEAT_SECONDS", heartbeat)
    monkeypatch.setattr(connections, "resolve_for_chat", lambda cid, uid: ("https://x/v1", "k"))
    monkeypatch.setattr(provider, "chat_stream", gen_factory)
    body = {"model": "openrouter/fusion", "messages": [{"role": "user", "content": "hi"}]}
    with client.stream("POST", "/chat/stream", json=body, headers=headers) as r:
        assert r.status_code == 200
        raw = "".join(r.iter_text())
    return raw


def test_heartbeat_comments_flow_while_the_provider_is_silent(quon_client, monkeypatch):
    h = make_active_user(quon_client, "hb1@x.de")

    def slow_then_delta(*a, **k):
        async def gen():
            await asyncio.sleep(0.3)  # ≫ heartbeat interval — the "thinking" phase
            yield "Hallo"

        return gen()

    raw = _stream(quon_client, h, monkeypatch, slow_then_delta)
    # At least one keep-alive comment was emitted BEFORE the first CONTENT event
    # (the job announcement goes out immediately, ahead of any heartbeat).
    first_ping = raw.find(": ping")
    first_content = raw.find('data: {"delta"')
    assert first_ping != -1, raw
    assert first_ping < first_content
    # …and the payload still parses to the delta + done, unchanged.
    assert _events(raw) == [{"delta": "Hallo"}, {"done": True}]
    assert _job_id(raw), "every stream must name its resume job"


def test_no_heartbeat_needed_for_a_fast_stream(quon_client, monkeypatch):
    h = make_active_user(quon_client, "hb2@x.de")

    def fast(*a, **k):
        async def gen():
            yield "a"
            yield "b"

        return gen()

    raw = _stream(quon_client, h, monkeypatch, fast, heartbeat=5.0)
    assert ": ping" not in raw
    assert _events(raw) == [{"delta": "a"}, {"delta": "b"}, {"done": True}]


def test_provider_error_still_reaches_the_client_between_heartbeats(quon_client, monkeypatch):
    h = make_active_user(quon_client, "hb3@x.de")

    def preamble_then_error(*a, **k):
        async def gen():
            yield "Fusion läuft…"
            await asyncio.sleep(0.2)
            raise provider.ProviderError("The model failed mid-response: upstream", status=502)

        return gen()

    raw = _stream(quon_client, h, monkeypatch, preamble_then_error)
    events = _events(raw)
    assert events[0] == {"delta": "Fusion läuft…"}
    assert "upstream" in events[-1]["error"]
