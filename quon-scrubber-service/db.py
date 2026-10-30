"""SQLite foundation for QUON's multi-user, sync, and key-management features.

A deliberately small layer on top of the stdlib ``sqlite3`` module — no ORM, so
it stays light enough for a Raspberry Pi / Synology NAS. Provides:

- :func:`connect` / :func:`get_conn` / :func:`transaction` — connection helpers
  (WAL mode, foreign keys on, sensible busy timeout).
- :func:`init_db` — a tiny forward-only migration runner that applies every
  ``migrations/*.sql`` file in filename order, tracking applied versions in a
  ``schema_migrations`` table (idempotent; safe to call on every startup).
- :func:`now_ms` / :func:`next_server_seq` — small shared utilities.

Feature modules (auth, sync, provisioning) own their own SQL against the
connection objects handed out here.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from config import settings

logger = logging.getLogger("quon.db")

_MIGRATIONS_DIR = Path(__file__).parent / "migrations"
_init_lock = threading.Lock()
_initialized = False


def now_ms() -> int:
    """Current time as epoch milliseconds (the unit used by every time column)."""
    return int(time.time() * 1000)


def _db_path() -> Path:
    """Resolve the database file path. Relative paths are anchored to this
    service directory so the cwd does not matter."""
    raw = Path(settings.database_path)
    return raw if raw.is_absolute() else (Path(__file__).parent / raw)


def connect() -> sqlite3.Connection:
    """Open a new autocommit connection with QUON's standard pragmas.

    ``isolation_level=None`` puts the connection in autocommit mode; use
    :func:`transaction` to group multiple statements atomically.
    """
    conn = sqlite3.connect(
        _db_path(),
        isolation_level=None,
        check_same_thread=False,
        timeout=5.0,
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    # WAL + NORMAL is the recommended pairing: commits stop fsync-ing the WAL on
    # every write (a large multi-user write-throughput win) while staying
    # crash-safe — only an OS/power failure can lose the *most recent* commits,
    # never corrupt the database. FULL's per-commit fsync is the single biggest
    # SQLite write bottleneck under concurrent users.
    conn.execute("PRAGMA synchronous=NORMAL")
    # Keep a long-running service's WAL from growing unbounded between
    # checkpoints (e.g. after a burst of large blob pushes): truncate it back
    # to ≤64 MiB at the next checkpoint.
    conn.execute("PRAGMA journal_size_limit=67108864")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    """Short-lived autocommit connection — open one per logical operation."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Run a block atomically: ``BEGIN`` … ``COMMIT`` (``ROLLBACK`` on error)."""
    conn = connect()
    try:
        conn.execute("BEGIN")
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def _applied_versions(conn: sqlite3.Connection) -> set[str]:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"
    )
    return {row["version"] for row in conn.execute("SELECT version FROM schema_migrations")}


def init_db() -> None:
    """Apply any unapplied ``migrations/*.sql`` in filename order.

    Forward-only and idempotent: each file runs once and is recorded in
    ``schema_migrations``. Migrations use ``CREATE TABLE IF NOT EXISTS`` so a
    partially-applied file can be re-run safely.
    """
    global _initialized
    with _init_lock:
        if _initialized:
            return
        conn = connect()
        try:
            applied = _applied_versions(conn)
            for path in sorted(_MIGRATIONS_DIR.glob("*.sql")):
                version = path.stem  # e.g. "0001_init"
                if version in applied:
                    continue
                logger.info("applying migration %s", version)
                conn.executescript(path.read_text("utf-8"))
                conn.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (version, now_ms()),
                )
            _initialized = True
        finally:
            conn.close()


def next_server_seq(conn: sqlite3.Connection, user_id: str) -> int:
    """Allocate the next per-user monotonic sync sequence number.

    Must be called inside a :func:`transaction` so the read-modify-write of
    ``sync_meta`` is atomic against concurrent pushes from the same user.
    """
    row = conn.execute(
        "SELECT next_seq FROM sync_meta WHERE user_id = ?", (user_id,)
    ).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO sync_meta(user_id, next_seq) VALUES (?, ?)", (user_id, 2)
        )
        return 1
    seq = int(row["next_seq"])
    conn.execute(
        "UPDATE sync_meta SET next_seq = ? WHERE user_id = ?", (seq + 1, user_id)
    )
    return seq


def next_project_seq(conn: sqlite3.Connection, project_id: str) -> int:
    """Allocate the next per-PROJECT monotonic sync sequence number.

    Twin of :func:`next_server_seq` for shared projects (see shares.py): each
    shared project has its own independent sequence, so every member's delta
    cursor is per-project and unaffected by their personal sync stream. Must be
    called inside a :func:`transaction` for the same atomicity reason.
    """
    row = conn.execute(
        "SELECT next_seq FROM shared_sync_meta WHERE project_id = ?", (project_id,)
    ).fetchone()
    if row is None:
        conn.execute(
            "INSERT INTO shared_sync_meta(project_id, next_seq) VALUES (?, ?)", (project_id, 2)
        )
        return 1
    seq = int(row["next_seq"])
    conn.execute(
        "UPDATE shared_sync_meta SET next_seq = ? WHERE project_id = ?", (seq + 1, project_id)
    )
    return seq
