"""Multi-statement auth writes are atomic (db.transaction).

register() inserts a ``users`` row and its ``user_keys`` row. If a failure lands
between them, a ``users`` row with no key material would be orphaned - and
/auth/login treats a user with no ``user_keys`` as nonexistent, so the account is
wedged forever. Wrapping the pair in db.transaction() must roll both back.
"""

from __future__ import annotations

import contextlib
import sqlite3

import db as db_mod
from conftest import register_body


class _FailOnUserKeys:
    """Connection proxy that raises on the user_keys INSERT - a crash landing
    exactly between register()'s two writes."""

    def __init__(self, conn):
        self._c = conn

    def execute(self, sql, params=()):
        if sql.strip().startswith("INSERT INTO user_keys"):
            raise sqlite3.OperationalError("simulated crash mid-register")
        return self._c.execute(sql, params)

    def __getattr__(self, name):
        return getattr(self._c, name)


def test_register_rolls_back_users_when_user_keys_write_fails(quon_client, monkeypatch):
    orig_transaction = db_mod.transaction

    @contextlib.contextmanager
    def failing_transaction():
        with orig_transaction() as conn:
            yield _FailOnUserKeys(conn)

    monkeypatch.setattr(db_mod, "transaction", failing_transaction)

    from fastapi.testclient import TestClient
    from main import app

    observer = TestClient(app, raise_server_exceptions=False)
    resp = observer.post("/auth/register", json=register_body("atomic@x.de"))
    assert resp.status_code >= 500  # the user_keys write failed

    # The users row must have rolled back with the failed user_keys row - no orphan
    # (else the account would exist but be un-loginable forever).
    monkeypatch.setattr(db_mod, "transaction", orig_transaction)
    with db_mod.get_conn() as c:
        assert c.execute("SELECT 1 FROM users WHERE email=?", ("atomic@x.de",)).fetchone() is None
