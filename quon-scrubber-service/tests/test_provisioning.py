"""OpenRouter per-user key provisioning + account/admin lifecycle.

The OpenRouter management API is mocked at ``openrouter_provisioning._request``;
``crypto_server`` seals the minted secret at rest with QUON_SERVER_SECRET.
"""

from __future__ import annotations

import pytest

from conftest import make_active_user, register_body


@pytest.fixture
def provisioning_client(quon_client, monkeypatch):
    from config import settings
    import crypto_server
    import openrouter_provisioning as prov

    monkeypatch.setattr(settings, "quon_server_secret", "test-server-secret")
    monkeypatch.setattr(settings, "openrouter_provisioning_key", "prov-key")
    monkeypatch.setattr(settings, "admin_token", "admin-secret")
    crypto_server._server_box.cache_clear()

    state = {"fail": False, "gets": 0}

    async def fake_request(method, path, json=None, **_kw):
        if state["fail"]:
            raise prov.ProvisioningError("simulated OpenRouter outage")
        if method == "POST" and path == "/keys":
            return {"key": "sk-or-USERKEY", "data": {"hash": "h1", "limit": 5.0, "usage": 0.0}}
        if method == "GET":
            state["gets"] += 1
            return {"data": {"hash": "h1", "limit": 5.0, "usage": 0.42, "limit_remaining": 4.58}}
        return {}

    monkeypatch.setattr(prov, "_request", fake_request)
    quon_client._prov_state = state  # type: ignore[attr-defined]
    try:
        yield quon_client
    finally:
        crypto_server._server_box.cache_clear()


def _uid(email: str) -> str:
    import db

    with db.get_conn() as c:
        return c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()["id"]


def test_verify_provisions_sealed_key(provisioning_client):
    import db
    import openrouter_provisioning as prov

    make_active_user(provisioning_client, "p1@x.de")
    uid = _uid("p1@x.de")
    with db.get_conn() as c:
        row = c.execute("SELECT or_hash FROM user_or_keys WHERE user_id=?", (uid,)).fetchone()
    assert row["or_hash"] == "h1"
    # the sealed secret round-trips back to the minted value
    assert prov.get_user_key_secret(uid) == "sk-or-USERKEY"


def test_account_usage_reports_remaining(provisioning_client):
    make_active_user(provisioning_client, "p2@x.de")
    u = provisioning_client.get("/account/usage").json()
    assert u["provisioned"] is True
    assert u["usage_usd"] == 0.42 and u["limit_remaining_usd"] == 4.58


def test_account_usage_not_provisioned(quon_client):
    """Self-host / provisioning-off: no user_or_keys row -> provisioned:false and
    no numbers, so the frontend hides the budget UI entirely."""
    make_active_user(quon_client, "np@x.de")
    u = quon_client.get("/account/usage").json()
    assert u["provisioned"] is False
    assert u["usage_usd"] is None and u["limit_usd"] is None


def test_account_usage_updates_mirror_and_caches(provisioning_client):
    """A live refresh updates the usage_usd mirror; a second request within the
    cache TTL is served in-process (no second OpenRouter call). An admin limit
    change invalidates the cached entry."""
    import account
    import db

    c = provisioning_client
    make_active_user(c, "p6@x.de")
    uid = _uid("p6@x.de")

    first = c.get("/account/usage").json()
    assert first["usage_usd"] == 0.42
    assert c._prov_state["gets"] == 1
    with db.get_conn() as cc:
        row = cc.execute("SELECT usage_usd FROM user_or_keys WHERE user_id=?", (uid,)).fetchone()
    assert row["usage_usd"] == 0.42  # mirror refreshed from upstream

    second = c.get("/account/usage").json()
    assert second == first
    assert c._prov_state["gets"] == 1  # cache hit - no second upstream call

    c.post(
        f"/admin/users/{uid}/or-limit",
        json={"limit_usd": 50},
        headers={"Authorization": "Bearer admin-secret"},
    )
    assert uid not in account._usage_cache  # admin change invalidates


def test_account_usage_falls_back_to_mirror_on_outage(provisioning_client):
    """When the live refresh fails, the stored mirror is returned (uncached, so
    recovery is picked up on the next request)."""
    import account

    c = provisioning_client
    make_active_user(c, "p7@x.de")
    uid = _uid("p7@x.de")

    c._prov_state["fail"] = True
    u = c.get("/account/usage").json()
    assert u["provisioned"] is True
    assert u["usage_usd"] == 0.0 and u["limit_usd"] == 5.0  # values minted at signup
    assert uid not in account._usage_cache  # fallback responses are not cached

    c._prov_state["fail"] = False
    u = c.get("/account/usage").json()
    assert u["usage_usd"] == 0.42  # live again on the very next request


def test_fails_closed_on_provisioning_outage(provisioning_client):
    import db

    c = provisioning_client
    c.post("/auth/register", json=register_body("p3@x.de"))
    c._prov_state["fail"] = True
    token = c.captured["p3@x.de"]

    r = c.post("/auth/verify", json={"token": token})
    assert r.status_code == 502
    with db.get_conn() as cc:
        assert cc.execute("SELECT status FROM users WHERE email=?", ("p3@x.de",)).fetchone()[
            "status"
        ] == "pending"

    # recovery: the same token still works once OpenRouter is back
    c._prov_state["fail"] = False
    assert c.post("/auth/verify", json={"token": token}).json()["status"] == "active"


def test_disabled_key_has_no_secret(provisioning_client):
    import db
    import openrouter_provisioning as prov

    make_active_user(provisioning_client, "p4@x.de")
    uid = _uid("p4@x.de")
    with db.get_conn() as c:
        c.execute("UPDATE user_or_keys SET disabled=1 WHERE user_id=?", (uid,))
    assert prov.get_user_key_secret(uid) is None


def test_admin_limit_requires_token(provisioning_client):
    c = provisioning_client
    make_active_user(c, "p5@x.de")
    uid = _uid("p5@x.de")
    assert (
        c.post(
            f"/admin/users/{uid}/or-limit",
            json={"limit_usd": 50},
            headers={"Authorization": "Bearer wrong"},
        ).status_code
        == 403
    )
    assert (
        c.post(
            f"/admin/users/{uid}/or-limit",
            json={"limit_usd": 50},
            headers={"Authorization": "Bearer admin-secret"},
        ).status_code
        == 200
    )


def test_byok_self_host_activates_without_subkey(quon_client):
    """With provisioning disabled (default fixture), verify activates the account
    and no sub-key row is created - the relay falls back to the global BYOK key."""
    import db
    import openrouter_provisioning as prov

    make_active_user(quon_client, "byok@x.de")
    uid = _uid("byok@x.de")
    with db.get_conn() as c:
        assert c.execute("SELECT 1 FROM user_or_keys WHERE user_id=?", (uid,)).fetchone() is None
    assert prov.get_user_key_secret(uid) is None
