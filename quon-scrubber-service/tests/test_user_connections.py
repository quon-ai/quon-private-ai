"""Per-user BYOK provider connections: sealing, merge into the catalog, isolation."""

from __future__ import annotations

import crypto_server
import db
import user_connections
from conftest import make_active_user


def _enable_server_secret(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "quon_server_secret", "test-server-secret-123")
    crypto_server._server_box.cache_clear()  # drop the lru_cached box so it re-derives


def _user_id(email: str) -> str:
    with db.get_conn() as c:
        return c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()["id"]


def test_add_lists_routes_and_seals(quon_client, monkeypatch):
    _enable_server_secret(monkeypatch)
    h = make_active_user(quon_client, "u1@quon.local")

    r = quon_client.put(
        "/settings/my-connections/c1",
        headers=h,
        json={
            "label": "My OpenAI",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-secret-123",
            "models": ["gpt-4o"],
        },
    )
    assert r.status_code == 200
    conns = {c["id"]: c for c in r.json()["connections"]}
    assert conns["c1"]["owner"] == "user"
    assert conns["c1"]["key_configured"] is True
    assert "api_key" not in conns["c1"]  # never echoed

    # appears in the model catalog for this (authed) client
    models = quon_client.get("/models").json()
    assert any(m["connection_id"] == "c1" and m["model"] == "gpt-4o" for m in models)

    # the key is sealed at rest (not plaintext) and unseals for routing
    uid = _user_id("u1@quon.local")
    with db.get_conn() as c:
        cipher = c.execute(
            "SELECT key_cipher FROM user_connections WHERE user_id=? AND id=?", (uid, "c1")
        ).fetchone()["key_cipher"]
    assert isinstance(cipher, (bytes, memoryview)) and bytes(cipher) != b"sk-secret-123"
    assert user_connections.resolve_key(uid, "c1") == ("https://api.openai.com/v1", "sk-secret-123")


def test_update_without_key_keeps_it(quon_client, monkeypatch):
    _enable_server_secret(monkeypatch)
    h = make_active_user(quon_client, "u1@quon.local")
    quon_client.put(
        "/settings/my-connections/c1",
        headers=h,
        json={"label": "X", "base_url": "https://x/v1", "api_key": "sk-keep", "models": ["m1"]},
    )
    # update models only (no api_key) -> key stays
    r = quon_client.put(
        "/settings/my-connections/c1", headers=h, json={"models": ["m1", "m2"]}
    )
    conns = {c["id"]: c for c in r.json()["connections"]}
    assert conns["c1"]["key_configured"] is True and "m2" in conns["c1"]["models"]
    uid = _user_id("u1@quon.local")
    assert user_connections.resolve_key(uid, "c1")[1] == "sk-keep"


def test_connections_are_per_user_isolated(quon_client, monkeypatch):
    _enable_server_secret(monkeypatch)
    h1 = make_active_user(quon_client, "u1@quon.local")
    quon_client.put(
        "/settings/my-connections/c1",
        headers=h1,
        json={"label": "U1", "base_url": "https://x/v1", "api_key": "sk1", "models": ["m1"]},
    )
    # second user (the TestClient session cookie now belongs to u2)
    make_active_user(quon_client, "u2@quon.local")
    conns = {c["id"] for c in quon_client.get("/settings").json()["connections"]}
    assert "c1" not in conns  # u2 does not see u1's connection
    assert "openrouter" in conns  # but the global one is shared
    models = quon_client.get("/models").json()
    assert not any(m["connection_id"] == "c1" for m in models)


def test_openrouter_id_reserved(quon_client, monkeypatch):
    _enable_server_secret(monkeypatch)
    h = make_active_user(quon_client, "u1@quon.local")
    r = quon_client.put(
        "/settings/my-connections/openrouter",
        headers=h,
        json={"label": "x", "base_url": "https://x/v1", "api_key": "k", "models": []},
    )
    assert r.status_code == 400


def test_my_connection_endpoints_require_auth(quon_client):
    assert quon_client.put("/settings/my-connections/c1", json={"models": []}).status_code == 401