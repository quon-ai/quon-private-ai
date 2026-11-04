"""Strict EU routing (region.py): the chat URL, the catalog filter, the alias
probe, web search off — and that global mode is untouched."""

from __future__ import annotations

import asyncio

import httpx
import pytest

import connections
import provider
import region
import settings_store
from config import settings
from models import ChatTurn


class _Resp:
    def __init__(self, status_code: int, body: dict | None = None) -> None:
        self.status_code = status_code
        self._body = body or {}

    def json(self):
        return self._body


class _FakeClient:
    """GET /models → the EU list; POST /chat/completions → per-alias status."""

    list_status = 200
    eu_ids: list[str] = []
    alias_status: dict[str, int] = {}
    posts: list[str] = []
    gets: int = 0
    raise_network = False

    def __init__(self, *a, **k) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, **k):
        _FakeClient.gets += 1
        if _FakeClient.raise_network:
            raise httpx.ConnectError("down")
        return _Resp(_FakeClient.list_status, {"data": [{"id": i} for i in _FakeClient.eu_ids]})

    async def post(self, url, json=None, **k):
        slug = json["model"]
        _FakeClient.posts.append(slug)
        return _Resp(_FakeClient.alias_status.get(slug, 200))


@pytest.fixture
def eu(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_region", "eu")
    monkeypatch.setattr(settings, "openrouter_api_key", "sk-or-v1-global")
    monkeypatch.setattr(region.httpx, "AsyncClient", _FakeClient)
    _FakeClient.list_status = 200
    _FakeClient.eu_ids = ["anthropic/claude-sonnet-4.5", "mistralai/mistral-large"]
    _FakeClient.alias_status = {"~anthropic/claude-sonnet-latest": 200, "~google/gemini-flash-latest": 404}
    _FakeClient.posts = []
    _FakeClient.gets = 0
    _FakeClient.raise_network = False
    region.reset()
    yield
    region.reset()


CATALOG = [
    "~anthropic/claude-sonnet-latest",
    "~google/gemini-flash-latest",
    "mistralai/mistral-large",
    "openrouter/fusion",
    "google/gemini-2.5-flash-image",
]


def test_global_mode_changes_nothing(monkeypatch):
    monkeypatch.setattr(settings, "openrouter_region", "global")
    region.reset()
    assert region.chat_base_url() == settings.openrouter_base_url
    assert region.web_search_available() is True
    assert region.available("openrouter/fusion") is None
    url, payload, _ = provider._build_request(
        "openrouter/fusion", [ChatTurn(role="user", content="hi")], stream=True, api_key="k", web_search=True
    )
    assert url.startswith(settings.openrouter_base_url)
    assert {"type": "openrouter:web_search"} in payload["tools"]


def test_eu_chat_goes_to_the_eu_domain_and_never_carries_the_web_plugin(eu):
    url, payload, _ = provider._build_request(
        "anthropic/claude-sonnet-4.5", [ChatTurn(role="user", content="hi")], stream=True, api_key="k", web_search=True
    )
    assert url.startswith("https://eu.openrouter.ai/api/v1")
    assert "tools" not in payload
    assert region.web_search_available() is False


def test_refresh_learns_the_list_and_probes_only_stale_aliases(eu):
    asyncio.run(region.refresh(CATALOG, now=1000.0))
    assert region.available("mistralai/mistral-large") is True
    assert region.available("openrouter/fusion") is False
    assert region.available("google/gemini-2.5-flash-image") is False
    assert region.available("~anthropic/claude-sonnet-latest") is True
    assert region.available("~google/gemini-flash-latest") is False
    assert sorted(_FakeClient.posts) == sorted(["~anthropic/claude-sonnet-latest", "~google/gemini-flash-latest"])
    # An hour later: list refreshed, aliases NOT re-probed (daily) — probes cost money.
    asyncio.run(region.refresh(CATALOG, now=1000.0 + region.LIST_TTL_S))
    assert _FakeClient.gets == 2
    assert len(_FakeClient.posts) == 2
    asyncio.run(region.refresh(CATALOG, now=1000.0 + region.PROBE_TTL_S + 1))
    assert len(_FakeClient.posts) == 4


def test_unknown_keeps_a_model_visible_and_a_failed_refresh_keeps_the_last_state(eu):
    assert region.available("openrouter/fusion") is None  # nothing learned yet
    asyncio.run(region.refresh(CATALOG, now=1000.0))
    assert region.available("openrouter/fusion") is False
    _FakeClient.raise_network = True
    asyncio.run(region.refresh(CATALOG, now=1000.0 + 2 * region.LIST_TTL_S))
    assert region.available("openrouter/fusion") is False  # last known state, not wiped


def test_eu_catalog_drops_models_the_eu_domain_does_not_serve(eu, monkeypatch):
    monkeypatch.setattr(settings_store, "get_openrouter_models", lambda: CATALOG)
    monkeypatch.setattr(settings_store, "is_configured", lambda: True)
    monkeypatch.setattr(settings_store, "get_custom_connections", lambda: [])
    monkeypatch.setattr(connections.user_connections, "list_for_user", lambda uid: [])
    asyncio.run(region.refresh(CATALOG, now=1000.0))
    ids = [m.model for m in connections.chat_catalog(None)]
    assert ids == ["~anthropic/claude-sonnet-latest", "mistralai/mistral-large"]
    # The image model is gone with it — no image generation in strict EU.
    assert not any(m.image_output for m in connections.chat_catalog(None))


def test_the_fail_closed_refusal_gets_a_worded_message():
    msg = provider.friendly_provider_error(404, b'{"error":{"message":"No endpoints found supporting your data region."}}')
    assert "not available with EU routing" in msg
    msg = provider.friendly_provider_error(403, b'{"error":{"message":"Tool \'openrouter:fusion\' is not available on region-specific endpoints."}}')
    assert "not available with EU routing" in msg


def test_health_and_settings_report_the_region(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "openrouter_region", "eu")
    h = quon_client.get("/health").json()
    assert h["region"] == "eu" and h["web_search_available"] is False
    s = quon_client.get("/settings").json()
    assert s["region"] == "eu" and s["web_search_available"] is False
    monkeypatch.setattr(settings, "openrouter_region", "global")
    h = quon_client.get("/health").json()
    assert h["region"] == "global" and h["web_search_available"] is True

