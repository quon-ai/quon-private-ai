"""Accounts, email verification, sessions, CSRF, and recovery/reset."""

from __future__ import annotations

import base64

from conftest import b64, make_active_user, register_body


def test_register_pending_then_verify_activates(quon_client):
    c = quon_client
    r = c.post("/auth/register", json=register_body("a@x.de"))
    assert r.status_code == 201 and r.json()["status"] == "pending"

    # login before verify is rejected
    assert (
        c.post("/auth/login", json={"email": "a@x.de", "auth_token": b64(b"A" * 32)}).status_code
        == 403
    )

    rv = c.post("/auth/verify", json={"token": c.captured["a@x.de"]})
    assert rv.status_code == 200 and rv.json()["status"] == "active"
    assert "quon_session" in c.cookies and "quon_csrf" in c.cookies
    assert c.get("/auth/me").json()["status"] == "active"


def test_onboarding_pending_reported_once_at_verify(quon_client):
    """A brand-new signup is eligible for the first-login onboarding flow - the
    /auth/verify response is the one place that reports it (true), because it
    is the only unambiguous server-observable "just came alive" event: verify
    and the client's later unlock() may happen on different devices, so nothing
    else can be relied on client-side. It must never be reported true again
    (this token/account), including from /auth/me on a later, unrelated call."""
    c = quon_client
    c.post("/auth/register", json=register_body("new@x.de"))
    rv = c.post("/auth/verify", json={"token": c.captured["new@x.de"]})
    assert rv.json()["onboarding_pending"] is True

    # A subsequent /auth/me for the same session never repeats it.
    assert c.get("/auth/me").json()["onboarding_pending"] is False


def test_onboarding_pending_false_for_login_after_verify(quon_client):
    """login() (a returning user unlocking on a fresh device/browser, or after
    logout) must report onboarding_pending False - the flag is a one-shot
    "brand new" signal consumed entirely at verify time, not a standing account
    property login should ever resurface."""
    c = quon_client
    make_active_user(c, "returning@x.de")
    c.post("/auth/logout", headers={"X-QUON-CSRF": c.cookies.get("quon_csrf")})

    r = c.post("/auth/login", json={"email": "returning@x.de", "auth_token": b64(b"A" * 32)})
    assert r.status_code == 200
    assert r.json()["user"]["onboarding_pending"] is False


def test_login_wrong_password_rejected(quon_client):
    c = quon_client
    make_active_user(c, "b@x.de")
    c.post("/auth/logout", headers={"X-QUON-CSRF": c.cookies.get("quon_csrf")})

    assert (
        c.post("/auth/login", json={"email": "b@x.de", "auth_token": b64(b"B" * 32)}).status_code
        == 401
    )
    r = c.post("/auth/login", json={"email": "b@x.de", "auth_token": b64(b"A" * 32)})
    assert r.status_code == 200
    # login returns the password-wrapped Master Key so the client can unlock it
    assert r.json()["key_material"]["wrap_pw"] == b64(b"W" * 48)


def test_csrf_required_on_unsafe_methods(quon_client):
    c = quon_client
    make_active_user(c, "c@x.de")
    assert c.post("/auth/logout").status_code == 403  # no CSRF header
    assert (
        c.post("/auth/logout", headers={"X-QUON-CSRF": c.cookies.get("quon_csrf")}).status_code
        == 200
    )


def test_kdf_anti_enumeration(quon_client):
    c = quon_client
    make_active_user(c, "d@x.de")
    known = c.get("/auth/kdf", params={"email": "d@x.de"}).json()
    assert known["kdf_salt"] == b64(b"S" * 16)
    unknown = c.get("/auth/kdf", params={"email": "nobody@x.de"})
    assert unknown.status_code == 200
    assert len(base64.b64decode(unknown.json()["kdf_salt"])) == 16  # believable dummy


def test_me_requires_session(quon_client):
    assert quon_client.get("/auth/me").status_code == 401


def test_duplicate_active_email_fakes_pending_signup(quon_client, monkeypatch):
    """Registering an already-active email must not reveal the account exists:
    same 201 'pending' response as a fresh signup (anti-enumeration). The owner
    gets a notice email instead of a verify link."""
    import email_service

    c = quon_client
    make_active_user(c, "e@x.de")
    notices: list[str] = []
    monkeypatch.setattr(email_service, "send_already_registered", notices.append)
    r = c.post("/auth/register", json=register_body("e@x.de"))
    assert r.status_code == 201 and r.json()["status"] == "pending"
    assert notices == ["e@x.de"]


def test_password_reset_via_recovery(quon_client):
    c = quon_client
    make_active_user(c, "f@x.de")

    assert c.post("/auth/reset/request", json={"email": "f@x.de"}).status_code == 200
    token = c.captured[("reset", "f@x.de")]

    mat = c.get("/auth/reset/material", params={"token": token})
    assert mat.status_code == 200 and mat.json()["wrap_rec"] == b64(b"X" * 48)

    rr = c.post(
        "/auth/reset-password",
        json={
            "token": token,
            "auth_token": b64(b"N" * 32),
            "kdf_salt": b64(b"T" * 16),
            "kdf_params": {"alg": "argon2id"},
            "wrap_pw": b64(b"P" * 48),
        },
    )
    assert rr.status_code == 200
    assert c.get("/auth/me").status_code == 401  # existing sessions invalidated

    # old password no longer works; new one does
    assert (
        c.post("/auth/login", json={"email": "f@x.de", "auth_token": b64(b"A" * 32)}).status_code
        == 401
    )
    assert (
        c.post("/auth/login", json={"email": "f@x.de", "auth_token": b64(b"N" * 32)}).status_code
        == 200
    )
