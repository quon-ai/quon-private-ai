"""Pytest bootstrap: put the service root on sys.path so ``import main`` works,
plus shared fixtures/helpers for the auth, sync and provisioning tests."""

import base64
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.resolve()))

# Settings that the suite requires but that only exist in the operator's
# untracked .env. Without these a clean checkout fails with
# "QUON_SERVER_SECRET is not configured" - which is what a fresh CI runner is,
# and what a new contributor's first `pytest` is. Set before anything imports
# config.py, since pydantic-settings reads the environment at instantiation.
#
# `setdefault`, so a real environment always wins; and a deterministic
# test-only value, so the suite never seals anything under the operator's real
# secret. The same shape of bug existed once for COOKIE_SECURE and was fixed
# for that one variable only; this covers every required setting.
os.environ.setdefault("QUON_SERVER_SECRET", "test-only-not-a-real-secret-0123456789abcdef")
os.environ.setdefault("APP_BASE_URL", "http://localhost:8000")
os.environ.setdefault("COOKIE_SECURE", "false")


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def register_body(email: str, auth_token: bytes = b"A" * 32) -> dict:
    """A fake (server-shaped) registration payload. The real key material is
    produced client-side in JS; here we only need opaque, well-formed blobs."""
    return {
        "email": email,
        "auth_token": b64(auth_token),
        "kdf_salt": b64(b"S" * 16),
        "kdf_params": {"alg": "argon2id", "ops": 3, "mem": 67108864, "v": 1},
        "wrap_pw": b64(b"W" * 48),
        "rec_salt": b64(b"R" * 16),
        "wrap_rec": b64(b"X" * 48),
    }


def make_active_user(client, email: str = "user@quon.local", auth_token: bytes = b"A" * 32) -> dict:
    """Register + verify a user; return the CSRF header for authed POSTs.

    The session cookie is stored on the client automatically by TestClient.
    """
    client.post("/auth/register", json=register_body(email, auth_token))
    token = client.captured[email]
    client.post("/auth/verify", json={"token": token})
    return {"X-QUON-CSRF": client.cookies.get("quon_csrf")}


@pytest.fixture(autouse=True)
def _pin_email_verification(monkeypatch):
    """The suite was written against the verify flow, so it runs with
    EMAIL_VERIFICATION=required regardless of SMTP. Tests of the modes
    themselves set the attribute again (a later monkeypatch wins)."""
    from config import settings  # after the sys.path setup above, like quon_client

    monkeypatch.setattr(settings, "email_verification", "required")


@pytest.fixture
def quon_client(monkeypatch, tmp_path):
    """A TestClient on an isolated temp DB, with email delivery captured and
    OpenRouter provisioning disabled (BYOK) by default. Tests that need
    provisioning enable it explicitly."""
    from config import settings
    import db
    import email_service
    import settings_store

    monkeypatch.setattr(settings, "database_path", str(tmp_path / "quon-test.db"))
    # Isolate the runtime settings store: it persists to a module-level JSON path,
    # so without this a test that writes global settings (via PUT /settings/*)
    # would clobber the operator's real device runtime_settings.json.
    monkeypatch.setattr(settings_store, "_STORE_PATH", tmp_path / "runtime_settings.json")
    settings_store._cache = None
    monkeypatch.setattr(settings, "cookie_secure", False)
    monkeypatch.setattr(settings, "openrouter_provisioning_key", "")
    # Disable the SSRF guard + rate limiting for the general suite (tests use
    # placeholder provider URLs and register/login many users on one client IP).
    # Each is exercised explicitly in its own test.
    monkeypatch.setattr(settings, "allow_private_provider_urls", True)
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    db._initialized = False
    db.init_db()

    # /account/usage caches per user in-process - never leak entries across tests.
    import account

    account._usage_cache.clear()

    captured: dict = {}
    captured_lang: dict = {}
    monkeypatch.setattr(
        email_service,
        "send_verification",
        lambda to, token, lang=None: (
            captured.__setitem__(to, token),
            captured_lang.__setitem__(to, lang),
        ),
    )
    monkeypatch.setattr(
        email_service,
        "send_password_reset",
        lambda to, token, lang=None: captured.__setitem__(("reset", to), token),
    )

    from fastapi.testclient import TestClient
    from main import app

    client = TestClient(app)
    client.captured = captured  # type: ignore[attr-defined]
    client.captured_lang = captured_lang  # type: ignore[attr-defined]
    try:
        yield client
    finally:
        db._initialized = False
        settings_store._cache = None  # don't leak the temp cache to later tests
