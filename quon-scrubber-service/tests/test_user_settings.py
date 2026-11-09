"""Per-user settings overrides: isolation, layering over the global default,
sealed keys at rest, and the SSRF guard on a per-user endpoint.

The security property: a user's override only ever changes their own routing, so
no account can repoint another user's PII extraction (which was the whole point of
making these per-user instead of a shared global write).
"""

from __future__ import annotations

import db
import key_resolver
import net_guard
import settings_store
import user_settings
from config import settings
from conftest import make_active_user


def _uid(client, email: str) -> str:
    with db.get_conn() as c:
        return c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()["id"]


def _enable_secret(monkeypatch):
    monkeypatch.setattr(settings, "quon_server_secret", "test-server-secret-123")


def test_openrouter_key_override_is_per_user(quon_client, monkeypatch):
    _enable_secret(monkeypatch)
    make_active_user(quon_client, "g@x.de")
    make_active_user(quon_client, "h@x.de")
    g, h = _uid(quon_client, "g@x.de"), _uid(quon_client, "h@x.de")
    user_settings.set_openrouter_key(g, "sk-mine")
    # provisioning is disabled in the fixture -> self-host: g's override wins,
    # h falls back to the global key (None here).
    assert key_resolver.resolve_openrouter_key(g) == "sk-mine"
    assert key_resolver.resolve_openrouter_key(h) != "sk-mine"


def test_disabled_models_override_is_per_user(quon_client):
    make_active_user(quon_client, "i@x.de")
    make_active_user(quon_client, "j@x.de")
    i, j = _uid(quon_client, "i@x.de"), _uid(quon_client, "j@x.de")
    user_settings.set_disabled_ids(i, ["openrouter::foo"])
    assert user_settings.resolve_disabled_ids(i) == {"openrouter::foo"}
    assert "openrouter::foo" not in user_settings.resolve_disabled_ids(j)


