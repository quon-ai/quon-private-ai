"""Regression: the change-email *confirm* UNIQUE-collision race must fail closed
as a 409, not crash into a 500.

`change_email_confirm` (auth.py) checks for an email clash and then runs
``UPDATE users SET email=?`` (both inside one ``db.transaction()``). Between the
clash SELECT and the UPDATE another account can take the target address, so the
UPDATE hits the ``UNIQUE(users.email)`` constraint. That must be caught and
returned as the same 409 the (non-racing) clash check already returns, not an
uncaught ``sqlite3.IntegrityError`` → HTTP 500.

This test deterministically lands a colliding row in that window via a thin
connection proxy, so it fails on the current code (500) and passes once the
endpoint wraps the UPDATE in a try/except mapping IntegrityError → 409.
"""

from __future__ import annotations

import contextlib

import pytest
from conftest import b64, make_active_user


def _capture_email_change(monkeypatch, captured):
    import email_service

    monkeypatch.setattr(
        email_service,
        "send_email_change",
        lambda to, token, lang=None: captured.__setitem__(("change_email", to), token),
    )


class _RaceConn:
    """Delegates to a real sqlite3 connection but, the first time it sees the
    confirm's clash-check SELECT, inserts a colliding active user *after* that
    SELECT has run — reproducing the request→confirm UNIQUE race deterministically.
    (sqlite3.Connection.execute is read-only, so we wrap rather than patch it.)"""

    _CLASH_SQL = "SELECT 1 FROM users WHERE email=? AND id !="

    def __init__(self, conn, db_mod):
        self._c = conn
        self._db = db_mod
        self._fired = False

    def execute(self, sql, params=()):
        result = self._c.execute(sql, params)
        if not self._fired and sql.strip().startswith(self._CLASH_SQL):
            self._fired = True
            self._c.execute(
                "INSERT INTO users(id, email, status, auth_verifier, auth_salt, created_at)"
                " VALUES (?,?,?,?,?,?)",
                ("intruder", "contested@x.de", "active", b"v", b"s", self._db.now_ms()),
            )
        return result

    def __getattr__(self, name):
        return getattr(self._c, name)


def test_change_email_confirm_unique_race_is_409_not_500(quon_client, monkeypatch):
    import db

    c = quon_client
    _capture_email_change(monkeypatch, c.captured)
    csrf = make_active_user(c, "racer@x.de")

    # Request the change while "contested@x.de" is free → a token is issued.
    assert (
        c.post(
            "/auth/change-email/request",
            json={"new_email": "contested@x.de"},
            headers=csrf,
        ).status_code
        == 200
    )
    token = c.captured[("change_email", "contested@x.de")]

    # Wrap the connection so the address gets taken *between* the clash check and
    # the UPDATE. change_email_confirm runs inside db.transaction(), so hook that
    # (the injected INSERT then lands in the same transaction — the confirm's own
    # UPDATE still sees it and trips UNIQUE, exactly as a committed racer would).
    orig_transaction = db.transaction

    @contextlib.contextmanager
    def racing_transaction():
        with orig_transaction() as conn:
            yield _RaceConn(conn, db)

    monkeypatch.setattr(db, "transaction", racing_transaction)

    # Observe the HTTP status a real client would see (don't re-raise the 500).
    from fastapi.testclient import TestClient
    from main import app

    observer = TestClient(app, raise_server_exceptions=False)
    resp = observer.post("/auth/change-email/confirm", json={"token": token})

    assert resp.status_code == 409, (
        "UNIQUE-collision race in change-email/confirm should fail closed as 409, "
        f"got {resp.status_code} (uncaught IntegrityError → 500)."
    )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([__file__, "-q"]))
