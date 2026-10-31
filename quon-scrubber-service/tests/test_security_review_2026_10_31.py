"""Holes found by the 2026-10-31 adversarial review of the optional-e-mail-
verification / CORS-guard changes. Each test states the SAFE behaviour and is
marked ``xfail(strict=True)``: it documents a confirmed hole without turning the
gate red, and the moment a fix lands it XPASSes — which strict mode reports as a
failure, forcing whoever fixed it to drop the marker and keep the regression.

All values are synthetic.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from config import Settings, settings
from conftest import b64, register_body

_REPO = Path(__file__).resolve().parents[2]


# --- 1. CORS boot guard: a wildcard MIXED into the list ---------------------
@pytest.mark.parametrize(
    "raw", ["*, https://quon.example.com", "https://quon.example.com,*", "null"]
)
def test_prod_boot_rejects_wildcard_or_null_anywhere_in_cors_list(raw, monkeypatch, tmp_path):
    import main

    monkeypatch.setattr(settings, "database_path", str(tmp_path / "q.db"))
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "quon_server_secret", "s" * 32)
    monkeypatch.setattr(settings, "cors_allow_origins", raw)
    with pytest.raises(RuntimeError, match="CORS_ALLOW_ORIGINS"):
        with TestClient(main.app):
            pass


# --- 2. EMAIL_VERIFICATION: an unrecognised value must fail CLOSED ----------
@pytest.mark.parametrize("mode", ["requried", "require", "true", "on"])
def test_unknown_email_verification_mode_requires_verification(mode):
    assert Settings(email_verification=mode, smtp_host="").email_verification_required is True


# --- 3. EMAIL_VERIFICATION reaches the container -----------------------------
@pytest.mark.parametrize("compose", ["docker-compose.yml", "quon-scrubber-service/docker-compose.yml"])
def test_compose_wires_email_verification(compose):
    text = (_REPO / compose).read_text(encoding="utf-8")
    assert "EMAIL_VERIFICATION:" in text, f"{compose}: EMAIL_VERIFICATION in .env is a silent no-op"


# --- 4. A PENDING account is not handed to whoever re-registers it ----------
def test_unverified_mode_does_not_activate_someone_elses_pending_account(quon_client, monkeypatch):
    c = quon_client
    # The first account (role=admin) registered while the instance still verified
    # (or before an upgrade) and never completed verification.
    assert c.post("/auth/register", json=register_body("owner@quon.local", b"O" * 32)).status_code == 201
    stale_token = c.captured["owner@quon.local"]
    monkeypatch.setattr(settings, "email_verification", "auto")
    monkeypatch.setattr(settings, "smtp_host", "")

    r = c.post("/auth/register", json=register_body("owner@quon.local", b"E" * 32))
    assert r.status_code == 409, "a pending row must not be replaced without a verify step"
    login = c.post("/auth/login", json={"email": "owner@quon.local", "auth_token": b64(b"E" * 32)})
    assert login.status_code != 200, "stranger signed in to the pending (admin) account"
    # Nothing was touched: the owner's own verify link still activates the
    # OWNER's credentials, and the stranger's auth token stays worthless.
    c.cookies.clear()
    assert c.post("/auth/verify", json={"token": stale_token}).status_code == 200
    c.cookies.clear()
    assert c.post("/auth/login", json={"email": "owner@quon.local", "auth_token": b64(b"E" * 32)}).status_code != 200
    assert c.post("/auth/login", json={"email": "owner@quon.local", "auth_token": b64(b"O" * 32)}).status_code == 200


# --- 5. An ordinary user cannot repoint the operator's GLOBAL connection -----
def test_regular_user_cannot_retarget_global_connection(quon_client, monkeypatch):
    import connections
    import settings_store

    settings_store.upsert_custom_connection(
        "acme", "Operator LLM", "https://llm.operator.example/v1", ["m1"], api_key="sk-synthetic-operator"
    )
    # The new default: auto without SMTP ⇒ a stranger's account is active at once.
    monkeypatch.setattr(settings, "email_verification", "auto")
    monkeypatch.setattr(settings, "smtp_host", "")
    c = quon_client
    c.post("/auth/register", json=register_body("operator@quon.local"))  # first = admin
    r = c.post("/auth/register", json=register_body("stranger@quon.local", b"Z" * 32))
    assert r.json()["role"] == "user" and r.json()["status"] == "active"
    c.post("/auth/login", json={"email": "stranger@quon.local", "auth_token": b64(b"Z" * 32)})
    csrf = {"X-QUON-CSRF": c.cookies.get("quon_csrf")}

    p = c.put("/settings/connections/acme", json={"base_url": "https://attacker.example/v1"}, headers=csrf)
    assert p.status_code == 403
    assert connections.resolve_for_chat("acme", "another-user")[0] == "https://llm.operator.example/v1"


# --- 6. The /auth/register limit cannot be reset by a client-sent header -----
def test_register_rate_limit_not_bypassed_by_spoofed_cf_header(quon_client, monkeypatch):
    import ratelimit

    monkeypatch.setattr(settings, "email_verification", "off")
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(ratelimit, "_limiter", ratelimit._FixedWindow())
    c = quon_client
    c.post("/auth/register", json=register_body("known@quon.local"))
    codes = [
        c.post(
            "/auth/register",
            json=register_body("known@quon.local"),
            headers={"CF-Connecting-IP": f"198.51.100.{i}"},
        ).status_code
        for i in range(15)
    ]
    assert 429 in codes, f"409 enumeration oracle unbounded: {sorted(set(codes))}"
