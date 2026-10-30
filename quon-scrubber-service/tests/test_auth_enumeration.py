"""Account-enumeration resistance for the auth endpoints.

Three oracles closed and locked in here:
  * /auth/kdf     — dummy params for unknown emails must have the SAME key set
                    as real accounts (the old dummy leaked via extra keys), and
                    the dummy salt must be deterministic per email.
  * /auth/login   — unknown email and wrong password must return the identical
                    status + detail (the Argon2 timing is equalized via a dummy
                    verification; asserted structurally, not by clock).
  * /auth/register — an already-active email must look exactly like a fresh
                    signup (201 pending, one email), never a 409.
"""

from __future__ import annotations

import email_service
from conftest import b64, make_active_user, register_body


def test_kdf_shape_identical_for_known_and_unknown(quon_client):
    c = quon_client
    make_active_user(c, "shape@x.de")

    known = c.get("/auth/kdf", params={"email": "shape@x.de"})
    unknown = c.get("/auth/kdf", params={"email": "ghost@x.de"})
    assert known.status_code == unknown.status_code == 200
    # The JSON key set of kdf_params must not distinguish real from dummy.
    assert set(known.json()["kdf_params"].keys()) == set(unknown.json()["kdf_params"].keys())

    # Dummy salt is deterministic per email (repeat lookups can't average it out)...
    again = c.get("/auth/kdf", params={"email": "ghost@x.de"})
    assert again.json()["kdf_salt"] == unknown.json()["kdf_salt"]
    # ...but differs between different unknown emails (not a constant tell either).
    other = c.get("/auth/kdf", params={"email": "ghost2@x.de"})
    assert other.json()["kdf_salt"] != unknown.json()["kdf_salt"]


def test_login_unknown_email_and_wrong_password_are_uniform(quon_client):
    c = quon_client
    make_active_user(c, "login@x.de")
    c.post("/auth/logout", headers={"X-QUON-CSRF": c.cookies.get("quon_csrf")})

    unknown = c.post("/auth/login", json={"email": "ghost@x.de", "auth_token": b64(b"A" * 32)})
    wrong_pw = c.post("/auth/login", json={"email": "login@x.de", "auth_token": b64(b"B" * 32)})

    assert unknown.status_code == 401
    assert unknown.json()["detail"] == "invalid email or password"
    assert wrong_pw.status_code == unknown.status_code
    assert wrong_pw.json()["detail"] == unknown.json()["detail"]


def test_register_active_account_fakes_success(quon_client, monkeypatch):
    c = quon_client
    make_active_user(c, "dup@x.de")  # original credentials: authToken b"A"*32
    c.post("/auth/logout", headers={"X-QUON-CSRF": c.cookies.get("quon_csrf")})

    notices: list[str] = []
    monkeypatch.setattr(email_service, "send_already_registered", notices.append)
    # Forget the original verify token so we can assert none is (re)issued.
    c.captured.pop("dup@x.de", None)

    # Attacker re-registers the address with DIFFERENT credentials.
    r = c.post("/auth/register", json=register_body("dup@x.de", auth_token=b"Z" * 32))
    assert r.status_code == 201 and r.json()["status"] == "pending"

    # Exactly one "already registered" notice, and NO verify token was created.
    assert notices == ["dup@x.de"]
    assert "dup@x.de" not in c.captured

    # The account was not touched: the original password still logs in...
    ok = c.post("/auth/login", json={"email": "dup@x.de", "auth_token": b64(b"A" * 32)})
    assert ok.status_code == 200
    assert ok.json()["key_material"]["wrap_pw"] == b64(b"W" * 48)
    # ...and the attacker's credentials do not.
    c.post("/auth/logout", headers={"X-QUON-CSRF": c.cookies.get("quon_csrf")})
    bad = c.post("/auth/login", json={"email": "dup@x.de", "auth_token": b64(b"Z" * 32)})
    assert bad.status_code == 401
