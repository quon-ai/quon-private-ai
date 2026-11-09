"""DB housekeeping: auth.sweep_expired() removes dead rows, keeps live ones.

The sweeper is what keeps `sessions` and `email_tokens` from growing without
bound on a long-running instance (SQLite-hardening work); expiry alone never
deletes anything.
"""

from __future__ import annotations

import auth
import db
from conftest import make_active_user


def _counts(c) -> tuple[int, int]:
    s = c.execute("SELECT COUNT(*) AS n FROM sessions").fetchone()["n"]
    t = c.execute("SELECT COUNT(*) AS n FROM email_tokens").fetchone()["n"]
    return s, t


def test_sweep_removes_expired_and_keeps_valid(quon_client):
    c = quon_client
    make_active_user(c, "sweep@x.de")  # leaves one live session + one USED verify token

    now = db.now_ms()
    with db.get_conn() as conn:
        # An expired session and an expired (unused) email token.
        conn.execute(
            "INSERT INTO sessions(id, user_id, token_hash, csrf_hash, created_at,"
            " expires_at, last_seen, user_agent)"
            " SELECT 'dead-session', user_id, token_hash, csrf_hash, created_at,"
            " ?, last_seen, user_agent FROM sessions LIMIT 1",
            (now - 1000,),
        )
        conn.execute(
            "INSERT INTO email_tokens(id, user_id, purpose, token_hash, expires_at)"
            " SELECT 'dead-token', user_id, 'reset', token_hash, ? FROM email_tokens LIMIT 1",
            (now - 1000,),
        )
        before_sessions, before_tokens = _counts(conn)

    sessions_deleted, tokens_deleted = auth.sweep_expired()

    # The expired session and both dead tokens go (the make_active_user verify
    # token is used -> also swept); the live session stays.
    assert sessions_deleted == 1
    assert tokens_deleted == 2
    with db.get_conn() as conn:
        after_sessions, after_tokens = _counts(conn)
        assert after_sessions == before_sessions - 1
        assert after_tokens == before_tokens - 2
        assert conn.execute("SELECT 1 FROM sessions WHERE id='dead-session'").fetchone() is None

    # The surviving session must still authenticate.
    assert c.get("/auth/me").status_code == 200


def test_sweep_is_idempotent(quon_client):
    make_active_user(quon_client, "sweep2@x.de")
    auth.sweep_expired()
    assert auth.sweep_expired() == (0, 0)


def test_connection_pragmas(quon_client):
    """The hardening pragmas are actually in effect on every connection.
    (quon_client points database_path at a throwaway tmp DB.)"""
    with db.get_conn() as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert conn.execute("PRAGMA synchronous").fetchone()[0] == 1  # NORMAL
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
        assert conn.execute("PRAGMA journal_size_limit").fetchone()[0] == 67108864
