"""Account self-service: change email, change password, delete account.

These guard the zero-knowledge invariants: change-password must re-wrap only
(Master Key unchanged -> recovery wrap untouched, synced data still decryptable),
require the current password, and invalidate other sessions; delete must verify
the password and cascade the account away.
"""

from __future__ import annotations

import pytest
from conftest import b64, make_active_user, register_body


def _capture_email_change(monkeypatch, captured):
    import email_service

    monkeypatch.setattr(
        email_service,
        "send_email_change",
        lambda to, token, lang=None: captured.__setitem__(("change_email", to), token),
    )


# --- change password ------------------------------------------------------
def _new_pw_body(current=b"A" * 32, new=b"N" * 32):
    return {
        "current_auth_token": b64(current),
        "auth_token": b64(new),
        "kdf_salt": b64(b"T" * 16),
        "kdf_params": {"alg": "argon2id"},
        "wrap_pw": b64(b"P" * 48),
    }


def test_change_password_wrong_current_rejected_no_mutation(quon_client):
    c = quon_client
    csrf = make_active_user(c, "cp1@x.de")  # password authToken = A*32

    r = c.post("/auth/change-password", json=_new_pw_body(current=b"Z" * 32), headers=csrf)
    assert r.status_code == 403

    # Nothing changed: key material still the original wrap, old password still unlocks.
    assert c.get("/auth/keymaterial").json()["wrap_pw"] == b64(b"W" * 48)
    c.post("/auth/logout", headers=csrf)
    assert c.post("/auth/login", json={"email": "cp1@x.de", "auth_token": b64(b"A" * 32)}).status_code == 200


def test_change_password_requires_csrf_and_session(quon_client):
    c = quon_client
    make_active_user(c, "cp2@x.de")
    # session present but no CSRF header -> 403
    assert c.post("/auth/change-password", json=_new_pw_body()).status_code == 403
    # anonymous -> 401
    c2 = _fresh_client()
    assert c2.post("/auth/change-password", json=_new_pw_body()).status_code == 401


def test_change_password_success_rotates_and_keeps_recovery(quon_client):
    c = quon_client
    csrf = make_active_user(c, "cp3@x.de")

    # A second live session for the same user (must be killed by the change).
    other = _fresh_client()
    assert other.post("/auth/login", json={"email": "cp3@x.de", "auth_token": b64(b"A" * 32)}).status_code == 200
    assert other.get("/auth/me").status_code == 200

    r = c.post("/auth/change-password", json=_new_pw_body(), headers=csrf)
    assert r.status_code == 200

    # New password material stored; recovery wrap UNTOUCHED (MK unchanged).
    km = c.get("/auth/keymaterial").json()
    assert km["wrap_pw"] == b64(b"P" * 48) and km["kdf_salt"] == b64(b"T" * 16)
    c.post("/auth/reset/request", json={"email": "cp3@x.de"})
    tok = c.captured[("reset", "cp3@x.de")]
    assert c.get("/auth/reset/material", params={"token": tok}).json()["wrap_rec"] == b64(b"X" * 48)

    # Caller's session survives; the other session is invalidated.
    assert c.get("/auth/me").status_code == 200
    assert other.get("/auth/me").status_code == 401

    # Old password no longer logs in; the new one does.
    c.post("/auth/logout", headers={"X-QUON-CSRF": c.cookies.get("quon_csrf")})
    assert c.post("/auth/login", json={"email": "cp3@x.de", "auth_token": b64(b"A" * 32)}).status_code == 401
    assert c.post("/auth/login", json={"email": "cp3@x.de", "auth_token": b64(b"N" * 32)}).status_code == 200


# --- delete account -------------------------------------------------------
def test_delete_account_wrong_password_rejected(quon_client):
    c = quon_client
    csrf = make_active_user(c, "del1@x.de")
    assert c.post("/auth/delete-account", json={"auth_token": b64(b"Z" * 32)}, headers=csrf).status_code == 403
    assert c.get("/auth/me").status_code == 200  # still there


def test_delete_account_success_cascades(quon_client):
    c = quon_client
    csrf = make_active_user(c, "del2@x.de")
    assert c.post("/auth/delete-account", json={"auth_token": b64(b"A" * 32)}, headers=csrf).status_code == 200
    # Session cleared + account gone.
    assert c.get("/auth/me").status_code == 401
    assert c.post("/auth/login", json={"email": "del2@x.de", "auth_token": b64(b"A" * 32)}).status_code == 401
    # The email is free again (row + all dependents cascaded away).
    assert c.post("/auth/register", json=register_body("del2@x.de")).status_code == 201


# --- change email ---------------------------------------------------------
def test_change_email_request_and_confirm_swaps(quon_client, monkeypatch):
    c = quon_client
    _capture_email_change(monkeypatch, c.captured)
    csrf = make_active_user(c, "old@x.de")

    r = c.post("/auth/change-email/request", json={"new_email": "new@x.de"}, headers=csrf)
    assert r.status_code == 200 and r.json()["ok"] is True

    token = c.captured[("change_email", "new@x.de")]
    conf = c.post("/auth/change-email/confirm", json={"token": token})
    assert conf.status_code == 200 and conf.json()["email"] == "new@x.de"
    assert c.get("/auth/me").json()["email"] == "new@x.de"


def test_change_email_request_taken_active_is_silent(quon_client, monkeypatch):
    c = quon_client
    _capture_email_change(monkeypatch, c.captured)
    make_active_user(c, "taken@x.de")  # exists + active
    csrf = make_active_user(c, "src@x.de")  # now logged in as src

    r = c.post("/auth/change-email/request", json={"new_email": "taken@x.de"}, headers=csrf)
    assert r.status_code == 200 and r.json()["ok"] is True
    # No token issued for a taken address -> nothing to confirm (anti-enumeration).
    assert ("change_email", "taken@x.de") not in c.captured


def test_change_email_confirm_race_conflict(quon_client, monkeypatch):
    c = quon_client
    _capture_email_change(monkeypatch, c.captured)
    csrf = make_active_user(c, "racer@x.de")

    # Request while target is free -> token issued.
    assert c.post("/auth/change-email/request", json={"new_email": "contested@x.de"}, headers=csrf).status_code == 200
    token = c.captured[("change_email", "contested@x.de")]

    # Someone else grabs the address before confirm.
    make_active_user(c, "contested@x.de")

    # Confirm now clashes -> 409, no silent overwrite.
    assert c.post("/auth/change-email/confirm", json={"token": token}).status_code == 409


def test_change_email_invalid_address_422(quon_client):
    c = quon_client
    csrf = make_active_user(c, "val@x.de")
    assert c.post("/auth/change-email/request", json={"new_email": "not-an-email"}, headers=csrf).status_code == 422


# --- helpers --------------------------------------------------------------
def _fresh_client():
    """A second TestClient on the same app + temp DB (own cookie jar)."""
    from fastapi.testclient import TestClient
    from main import app

    return TestClient(app)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))


# --- recovery rotation ------------------------------------------------------
# The old phrase is never stored (ZK), so "lost my phrase" is served by rotating
# to a new one while unlocked. Must be password-gated (a hijacked session alone
# must not brick or take over the recovery path) and atomic.


def _recovery_row(email: str) -> tuple[bytes, bytes]:
    import db

    with db.get_conn() as c:
        row = c.execute(
            "SELECT k.rec_salt, k.wrap_rec FROM user_keys k"
            " JOIN users u ON u.id = k.user_id WHERE u.email=?",
            (email,),
        ).fetchone()
    return (bytes(row["rec_salt"]), bytes(row["wrap_rec"]))


def _rotate_body(current: bytes = b"A" * 32) -> dict:
    return {
        "current_auth_token": b64(current),
        "rec_salt": b64(b"r" * 16),
        "wrap_rec": b64(b"y" * 48),
    }


def test_rotate_recovery_wrong_password_rejected_no_mutation(quon_client):
    c = quon_client
    csrf = make_active_user(c, "rr1@x.de")
    r = c.post("/auth/recovery/rotate", json=_rotate_body(current=b"Z" * 32), headers=csrf)
    assert r.status_code == 403
    # Recovery material untouched - the original phrase still works. (Recovery
    # material has no logged-in read endpoint by design; assert at the DB.)
    assert _recovery_row("rr1@x.de") == (b"R" * 16, b"X" * 48)


def test_rotate_recovery_success_swaps_only_recovery_material(quon_client):
    c = quon_client
    csrf = make_active_user(c, "rr2@x.de")
    r = c.post("/auth/recovery/rotate", json=_rotate_body(), headers=csrf)
    assert r.status_code == 200 and r.json() == {"ok": True}

    # New recovery material stored...
    assert _recovery_row("rr2@x.de") == (b"r" * 16, b"y" * 48)
    # ...password wrap and login untouched, session still alive.
    assert c.get("/auth/keymaterial").json()["wrap_pw"] == b64(b"W" * 48)
    assert c.get("/auth/me").status_code == 200


def test_rotate_recovery_requires_csrf_and_session(quon_client):
    c = quon_client
    make_active_user(c, "rr3@x.de")
    assert c.post("/auth/recovery/rotate", json=_rotate_body()).status_code == 403  # no CSRF
    c2 = _fresh_client()
    assert c2.post("/auth/recovery/rotate", json=_rotate_body()).status_code == 401  # anonymous
