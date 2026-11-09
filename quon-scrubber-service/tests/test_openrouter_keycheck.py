"""A user's own OpenRouter key is verified before it is stored.

Users paste keys from other vendors; the override wins over the provisioned
sub-key, so every chat fails with OpenRouter's misleading "Missing
Authentication header" until they remove it.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest

import openrouter_keycheck as kc
from conftest import make_active_user


class _Resp:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class _FakeClient:
    """Answers GET /auth/key with a fixed status, or raises."""

    calls: list[str] = []

    def __init__(self, *a, **k) -> None:
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, headers=None):
        _FakeClient.calls.append(url)
        if _FakeClient.status == "network":
            raise httpx.ConnectError("boom")
        return _Resp(_FakeClient.status)


def _fake(monkeypatch, status):
    _FakeClient.status = status
    _FakeClient.calls = []
    monkeypatch.setattr(kc.httpx, "AsyncClient", _FakeClient)


def test_a_key_from_another_vendor_is_rejected_without_a_network_call(monkeypatch):
    _fake(monkeypatch, 200)
    with pytest.raises(kc.KeyRejected) as ei:
        asyncio.run(kc.verify_openrouter_key("sk-ant-api03-not-an-openrouter-key"))
    assert ei.value.status == 400
    assert "not an OpenRouter key" in str(ei.value)
    assert _FakeClient.calls == []


def test_a_well_formed_key_openrouter_does_not_know_is_rejected(monkeypatch):
    _fake(monkeypatch, 401)
    with pytest.raises(kc.KeyRejected) as ei:
        asyncio.run(kc.verify_openrouter_key("sk-or-v1-0000"))
    assert ei.value.status == 400
    assert "does not know this key" in str(ei.value)
    assert _FakeClient.calls and _FakeClient.calls[0].endswith("/auth/key")


def test_a_key_openrouter_accepts_passes(monkeypatch):
    _fake(monkeypatch, 200)
    asyncio.run(kc.verify_openrouter_key("  sk-or-v1-0000  "))


def test_openrouter_unreachable_rejects_with_503_rather_than_storing_blind(monkeypatch):
    _fake(monkeypatch, "network")
    with pytest.raises(kc.KeyRejected) as ei:
        asyncio.run(kc.verify_openrouter_key("sk-or-v1-0000"))
    assert ei.value.status == 503


def test_endpoint_refuses_a_foreign_key_and_stores_nothing(quon_client, monkeypatch):
    import user_settings

    _fake(monkeypatch, 200)
    headers = make_active_user(quon_client, "keys@quon.local")
    r = quon_client.put(
        "/settings/openrouter-key", json={"api_key": "sk-ant-api03-nope"}, headers=headers
    )
    assert r.status_code == 400
    assert "not an OpenRouter key" in r.json()["detail"]
    me = quon_client.get("/auth/me", headers=headers).json()
    assert user_settings.get_openrouter_key(me["id"]) is None


def test_endpoint_stores_a_verified_key_and_an_empty_body_clears_it(quon_client, monkeypatch):
    import user_settings

    _fake(monkeypatch, 200)
    headers = make_active_user(quon_client, "keys2@quon.local")
    me = quon_client.get("/auth/me", headers=headers).json()
    assert (
        quon_client.put(
            "/settings/openrouter-key", json={"api_key": "sk-or-v1-0000"}, headers=headers
        ).status_code
        == 200
    )
    assert user_settings.get_openrouter_key(me["id"]) == "sk-or-v1-0000"
    # The settings read tells the caller an own key is in use (so the card can
    # offer "remove") - presence only, never the key.
    status = quon_client.get("/settings", headers=headers).json()
    assert status["own_openrouter_key"] is True
    assert "sk-or" not in str(status)
    calls_before = len(_FakeClient.calls)
    assert (
        quon_client.put("/settings/openrouter-key", json={"api_key": ""}, headers=headers).status_code
        == 200
    )
    assert user_settings.get_openrouter_key(me["id"]) is None
    assert len(_FakeClient.calls) == calls_before  # clearing asks nobody
    assert quon_client.get("/settings", headers=headers).json()["own_openrouter_key"] is False
    assert quon_client.get("/settings").json()["own_openrouter_key"] is False  # anonymous: never
