"""Closed-beta signup gate: /auth/register honors settings.signup_invite_code."""

from __future__ import annotations

from config import settings
from conftest import register_body


def test_register_open_when_no_invite_code(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "signup_invite_code", "")
    r = quon_client.post("/auth/register", json=register_body("open@quon.local"))
    assert r.status_code == 201


def test_register_requires_correct_invite_code(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "signup_invite_code", "letmein")

    # missing code -> rejected
    assert quon_client.post("/auth/register", json=register_body("a@quon.local")).status_code == 403
    # wrong code -> rejected
    wrong = {**register_body("a@quon.local"), "invite_code": "nope"}
    assert quon_client.post("/auth/register", json=wrong).status_code == 403
    # correct code -> created
    ok = {**register_body("a@quon.local"), "invite_code": "letmein"}
    assert quon_client.post("/auth/register", json=ok).status_code == 201


def test_invite_code_is_whitespace_trimmed(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "signup_invite_code", "letmein")
    padded = {**register_body("b@quon.local"), "invite_code": "  letmein  "}
    assert quon_client.post("/auth/register", json=padded).status_code == 201


def test_health_says_whether_registration_needs_an_invite(monkeypatch):
    """The sign-up form shows its invite field only when the instance is closed;
    it learns that from /health, so the flag must track SIGNUP_INVITE_CODE."""
    from fastapi.testclient import TestClient

    import main
    from config import settings

    with TestClient(main.app) as c:
        monkeypatch.setattr(settings, "signup_invite_code", "")
        assert c.get("/health").json()["signup_invite_required"] is False
        monkeypatch.setattr(settings, "signup_invite_code", "closed-beta")
        assert c.get("/health").json()["signup_invite_required"] is True

