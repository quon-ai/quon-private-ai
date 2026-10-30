"""EMAIL_VERIFICATION=auto|required|off.

The home-server case: nobody runs a mail relay, and an account that stays
`pending` forever because its verification link only went to a log is a
broken product. "auto" (the default) requires verification exactly when
SMTP_HOST is set.
"""

from __future__ import annotations

from config import settings
from conftest import register_body


def _health(client) -> dict:
    return client.get("/health").json()


def test_auto_without_smtp_activates_on_registration(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "email_verification", "auto")
    monkeypatch.setattr(settings, "smtp_host", "")
    assert _health(quon_client)["email_verification_required"] is False
    r = quon_client.post("/auth/register", json=register_body("home@quon.local"))
    assert r.status_code == 201
    assert r.json()["status"] == "active"
    assert r.json()["onboarding_pending"] is True
    assert "home@quon.local" not in quon_client.captured  # no mail went out
    # the first account on a fresh instance is the operator
    assert r.json()["role"] == "admin"


def test_auto_with_smtp_keeps_the_verify_flow(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "email_verification", "auto")
    monkeypatch.setattr(settings, "smtp_host", "mail.example.org")
    assert _health(quon_client)["email_verification_required"] is True
    r = quon_client.post("/auth/register", json=register_body("mail@quon.local"))
    assert r.status_code == 201
    assert r.json()["status"] == "pending"
    assert "mail@quon.local" in quon_client.captured


def test_off_wins_over_smtp(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "email_verification", "off")
    monkeypatch.setattr(settings, "smtp_host", "mail.example.org")
    assert _health(quon_client)["email_verification_required"] is False
    r = quon_client.post("/auth/register", json=register_body("off@quon.local"))
    assert r.json()["status"] == "active"


def test_without_verification_a_duplicate_is_refused_honestly(quon_client, monkeypatch):
    """With verification there is an anti-enumeration fake-pending answer and a
    mail to the real owner. Without a mail path that answer would only strand
    the user, so the duplicate is a plain 409 — documented as the trade-off."""
    monkeypatch.setattr(settings, "email_verification", "off")
    body = register_body("dup@quon.local")
    assert quon_client.post("/auth/register", json=body).status_code == 201
    r = quon_client.post("/auth/register", json=body)
    assert r.status_code == 409


def test_required_is_the_suite_default(quon_client):
    assert _health(quon_client)["email_verification_required"] is True
    r = quon_client.post("/auth/register", json=register_body("req@quon.local"))
    assert r.json()["status"] == "pending"
