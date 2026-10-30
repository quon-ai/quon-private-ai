"""Production-config fail-fast: with Secure cookies (the HTTPS-deployment
signal) the app must refuse to boot without QUON_SERVER_SECRET or with a
wildcard CORS origin — both previously failed only at runtime (500 on saving
a BYOK key; silently-broken cookie auth)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import main
from config import settings


def _boot():
    # TestClient triggers the lifespan on __enter__.
    with TestClient(main.app):
        pass


def test_prod_boot_requires_server_secret(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "q.db"))
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "quon_server_secret", "")
    monkeypatch.setattr(settings, "cors_allow_origins", "https://quon.example.com")
    with pytest.raises(RuntimeError, match="QUON_SERVER_SECRET"):
        _boot()


def test_prod_boot_rejects_wildcard_cors(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "q.db"))
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "quon_server_secret", "s" * 32)
    monkeypatch.setattr(settings, "cors_allow_origins", "*")
    with pytest.raises(RuntimeError, match="CORS_ALLOW_ORIGINS"):
        _boot()


def test_prod_boot_rejects_empty_cors(monkeypatch, tmp_path):
    """An EMPTY value resolves to ["*"] (config.cors_origins_list) and must be
    refused exactly like the literal wildcard — the raw-string check missed it.
    """
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "q.db"))
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "quon_server_secret", "s" * 32)
    monkeypatch.setattr(settings, "cors_allow_origins", "")
    with pytest.raises(RuntimeError, match="CORS_ALLOW_ORIGINS"):
        _boot()


def test_dev_boot_unaffected(monkeypatch, tmp_path):
    # cookie_secure off (dev/tests): boots without secret and with wildcard CORS.
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "q.db"))
    monkeypatch.setattr(settings, "cookie_secure", False)
    monkeypatch.setattr(settings, "quon_server_secret", "")
    monkeypatch.setattr(settings, "cors_allow_origins", "*")
    _boot()


def _prod_base(monkeypatch, tmp_path):
    """A valid production config — the open-registration checks below vary only
    the invite code / provisioning / shared key on top of this."""
    monkeypatch.setattr(settings, "database_path", str(tmp_path / "q.db"))
    monkeypatch.setattr(settings, "cookie_secure", True)
    monkeypatch.setattr(settings, "quon_server_secret", "s" * 32)
    monkeypatch.setattr(settings, "cors_allow_origins", "https://quon.example.com")


def test_open_registration_with_shared_key_warns_loudly(monkeypatch, tmp_path, caplog):
    """Empty SIGNUP_INVITE_CODE + no provisioning + a shared key = anyone who
    reaches the host can register, bill the operator's uncapped key, and (as the
    first account) become admin. Must WARN — but not refuse to boot: open signup
    is legitimate when users bring their own keys."""
    _prod_base(monkeypatch, tmp_path)
    monkeypatch.setattr(settings, "signup_invite_code", "")
    monkeypatch.setattr(main.settings_store, "get_openrouter_key", lambda: "sk-shared")
    import openrouter_provisioning as prov

    monkeypatch.setattr(prov, "is_enabled", lambda: False)

    with caplog.at_level("WARNING"):
        _boot()
    assert "OPEN REGISTRATION" in caplog.text
    assert "SIGNUP_INVITE_CODE" in caplog.text


def test_no_warning_when_an_invite_code_is_set(monkeypatch, tmp_path, caplog):
    _prod_base(monkeypatch, tmp_path)
    monkeypatch.setattr(settings, "signup_invite_code", "let-me-in")
    monkeypatch.setattr(main.settings_store, "get_openrouter_key", lambda: "sk-shared")
    import openrouter_provisioning as prov

    monkeypatch.setattr(prov, "is_enabled", lambda: False)

    with caplog.at_level("WARNING"):
        _boot()
    assert "OPEN REGISTRATION" not in caplog.text


def test_no_warning_when_provisioning_gives_each_user_a_capped_key(
    monkeypatch, tmp_path, caplog
):
    _prod_base(monkeypatch, tmp_path)
    monkeypatch.setattr(settings, "signup_invite_code", "")
    monkeypatch.setattr(main.settings_store, "get_openrouter_key", lambda: "sk-shared")
    import openrouter_provisioning as prov

    monkeypatch.setattr(prov, "is_enabled", lambda: True)

    with caplog.at_level("WARNING"):
        _boot()
    assert "OPEN REGISTRATION" not in caplog.text
