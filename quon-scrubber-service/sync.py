"""Zero-knowledge sync relay: opaque encrypted blobs, last-write-wins.

The server stores only ciphertext — the client encrypts each chat session with a
key derived from its Master Key, so the backend can never read a conversation.
Sync is deliberately *dumb storage*:

* ``POST /sync/push``    — upload changed blobs; LWW by the client's ``updated_at``.
* ``GET  /sync/changes`` — download everything changed since a per-user monotonic
                           ``server_seq`` (delta pull).
* ``GET  /sync/blob``    — fetch ONE blob by id (lazy pull for the ``originals``
                           chunks, which deliberately stay out of the delta loop).

All three also serve **shared projects** (shares.py): pass ``project_id`` and the
same operations run against ``shared_blobs`` — ciphertext under the shared
Project Key, membership checked against ``project_grants``, and a sequence that
is monotonic **per project** (not per user) so every member consumes one shared
delta stream. v1 sharing is read-only: only the project owner may push; readers
get a per-blob ``"forbidden"`` status. Non-members get 404 everywhere (the
non-oracle convention — see shares.py).

Conflict *merging* is out of scope: the last write (by ``updated_at``) wins per
blob. Per-chat-session granularity keeps the blast radius of a lost concurrent
edit to a single conversation.
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import db
import entitlements
import shares
from auth import User, current_active_user
from config import settings

router = APIRouter(prefix="/sync", tags=["sync"])

MAX_CHANGES = 500
MAX_BLOB_BYTES = 4 * 1024 * 1024  # 4 MiB per blob — generous for a chat session
# The one collection with a per-user total-bytes quota: encrypted original file
# bytes (chunked client-side, ids `orig:<docId>:<chunkIndex>`). Everything else
# (chat/memory/documents/projects) stays quota-free — those blobs are small.
ORIGINALS_COLLECTION = "originals"


class BlobIn(BaseModel):
    collection: str = Field(min_length=1, max_length=64)
    id: str = Field(min_length=1, max_length=128)
    ciphertext: str = ""  # base64; may be empty only when deleted=True
    content_ver: int = 1
    updated_at: int  # client-asserted epoch ms (drives LWW)
    deleted: bool = False
    # Set → this is a shared-project blob (stored in shared_blobs under the
    # project's own sequence; caller must hold the 'owner' grant to write).
    project_id: str | None = Field(default=None, max_length=128)


class PushRequest(BaseModel):
    changes: list[BlobIn] = Field(default_factory=list)


class PushResult(BaseModel):
    collection: str
    id: str
    status: str  # "accepted" | "stale" | "quota" | "forbidden"
    server_seq: int
    updated_at: int
    project_id: str | None = None  # echoes BlobIn.project_id for correlation


class PushResponse(BaseModel):
    results: list[PushResult]
    latest_seq: int  # the caller's PERSONAL stream (unchanged semantics)
    # Per-project latest seq for every shared project written to in this batch
    # (project streams are independent of latest_seq above and of each other).
    project_latest_seqs: dict[str, int] = Field(default_factory=dict)


class BlobOut(BaseModel):
    collection: str
    id: str
    ciphertext: str  # base64
    content_ver: int
    updated_at: int
    deleted: bool
    server_seq: int
    project_id: str | None = None  # set on shared-project reads


class ChangesResponse(BaseModel):
    changes: list[BlobOut]
    latest_seq: int


class OriginalsUsageResponse(BaseModel):
    used_bytes: int
    quota_bytes: int


def _latest_seq(conn, user_id: str) -> int:
    row = conn.execute(
        "SELECT MAX(server_seq) AS m FROM blobs WHERE user_id=?", (user_id,)
    ).fetchone()
    return int(row["m"] or 0)


def _latest_project_seq(conn, project_id: str) -> int:
    row = conn.execute(
        "SELECT MAX(server_seq) AS m FROM shared_blobs WHERE project_id=?", (project_id,)
    ).fetchone()
    return int(row["m"] or 0)


def _originals_used_bytes(conn, user_id: str, exclude_id: str, exclude_project_id: str = "") -> int:
    """Live ciphertext bytes charged against this user's originals quota: their
    personal ``originals`` blobs PLUS the shared ``originals`` of every project
    they OWN (shared bytes bill the owner — and since only owners can push to a
    shared project in v1, a reader can never consume someone else's quota).

    Excludes the blob about to be replaced — its old bytes are freed by the
    upsert, so they must not count against the incoming one: the personal row
    ``exclude_id`` when ``exclude_project_id`` is empty, else that project's
    row. Tombstones are excluded twice over: ``deleted=0`` here, and a tombstone
    upsert stores empty ciphertext anyway — deleting a document frees quota."""
    personal_sql = (
        "SELECT COALESCE(SUM(LENGTH(ciphertext)), 0) AS used FROM blobs"
        " WHERE user_id=? AND collection=? AND deleted=0"
    )
    personal_args: list = [user_id, ORIGINALS_COLLECTION]
    if not exclude_project_id:
        personal_sql += " AND id<>?"
        personal_args.append(exclude_id)
    shared_sql = (
        "SELECT COALESCE(SUM(LENGTH(sb.ciphertext)), 0) AS used FROM shared_blobs sb"
        " JOIN project_shares ps ON ps.project_id = sb.project_id"
        " WHERE ps.owner_user_id=? AND sb.collection=? AND sb.deleted=0"
    )
    shared_args: list = [user_id, ORIGINALS_COLLECTION]
    if exclude_project_id:
        shared_sql += " AND NOT (sb.project_id=? AND sb.id=?)"
        shared_args += [exclude_project_id, exclude_id]
    personal = int(conn.execute(personal_sql, personal_args).fetchone()["used"])
    shared = int(conn.execute(shared_sql, shared_args).fetchone()["used"])
    return personal + shared


def _blob_out(r, project_id: str | None = None, deleted: bool | None = None) -> BlobOut:
    return BlobOut(
        collection=r["collection"],
        id=r["id"],
        ciphertext=base64.b64encode(r["ciphertext"]).decode() if r["ciphertext"] else "",
        content_ver=r["content_ver"],
        updated_at=r["updated_at"],
        deleted=bool(r["deleted"]) if deleted is None else deleted,
        server_seq=r["server_seq"],
        project_id=project_id,
    )


@router.get("/changes", response_model=ChangesResponse)
async def get_changes(
    collection: str,
    since: int = 0,
    project_id: str | None = None,
    user: User = Depends(current_active_user),
) -> ChangesResponse:
    """Return all blobs in ``collection`` with ``server_seq > since`` (delta pull).

    With ``project_id``: the shared project's stream instead — any member may
    pull, ``since``/``latest_seq`` are that project's own sequence."""
    with db.get_conn() as c:
        if project_id:
            shares.require_member(c, project_id, user.id)
            rows = c.execute(
                "SELECT * FROM shared_blobs WHERE project_id=? AND collection=?"
                " AND server_seq>? ORDER BY server_seq ASC",
                (project_id, collection, since),
            ).fetchall()
            latest = _latest_project_seq(c, project_id)
        else:
            rows = c.execute(
                "SELECT * FROM blobs WHERE user_id=? AND collection=? AND server_seq>?"
                " ORDER BY server_seq ASC",
                (user.id, collection, since),
            ).fetchall()
            latest = _latest_seq(c, user.id)
    return ChangesResponse(
        changes=[_blob_out(r, project_id=project_id) for r in rows], latest_seq=latest
    )


@router.get("/blob", response_model=BlobOut)
async def get_blob(
    collection: str,
    id: str,
    project_id: str | None = None,
    user: User = Depends(current_active_user),
) -> BlobOut:
    """Fetch a single blob by id — the *lazy* counterpart to the delta pull.

    Used for the ``originals`` chunks: wiring those into ``/sync/changes`` would
    auto-download every original onto every device, so the client instead pulls
    exactly the chunks it needs when the viewer opens a document. Tombstoned
    blobs are reported as 404 (to the client, deleted == absent). With
    ``project_id``, reads the shared project's originals (any member)."""
    with db.get_conn() as c:
        if project_id:
            shares.require_member(c, project_id, user.id)
            r = c.execute(
                "SELECT * FROM shared_blobs WHERE project_id=? AND collection=? AND id=?",
                (project_id, collection, id),
            ).fetchone()
        else:
            r = c.execute(
                "SELECT * FROM blobs WHERE user_id=? AND collection=? AND id=?",
                (user.id, collection, id),
            ).fetchone()
    if r is None or r["deleted"]:
        raise HTTPException(status_code=404, detail="blob not found")
    return _blob_out(r, project_id=project_id, deleted=False)


@router.get("/originals/usage", response_model=OriginalsUsageResponse)
async def originals_usage(user: User = Depends(current_active_user)) -> OriginalsUsageResponse:
    """Live originals-quota usage for the signed-in user: personal ``originals``
    ciphertext bytes plus the shared originals of projects they OWN (the same
    accounting `_originals_used_bytes` applies at push time). Powers the
    Documents screen's storage line. Exposes only byte counts — no content."""
    with db.get_conn() as c:
        used = _originals_used_bytes(c, user.id, exclude_id="")
    return OriginalsUsageResponse(
        used_bytes=used, quota_bytes=entitlements.resolve(user.id).storage_bytes
    )


@router.post("/push", response_model=PushResponse)
async def push(body: PushRequest, user: User = Depends(current_active_user)) -> PushResponse:
    """Upsert changed blobs. Last-write-wins: a change older than the stored blob
    is rejected as ``stale`` (so the client can re-pull and reconcile).

    Blobs with ``project_id`` go to the shared project's stream. v1 sharing is
    read-only, so only the owner grant may write; anyone else — reader,
    non-member, unknown project alike (non-oracle) — gets the per-blob status
    ``"forbidden"``, mirroring "stale"/"quota" so one refused blob never fails a
    mixed batch."""
    if len(body.changes) > MAX_CHANGES:
        raise HTTPException(status_code=413, detail=f"too many changes (max {MAX_CHANGES})")

    results: list[PushResult] = []
    roles: dict[str, str | None] = {}  # per-request grant cache: project_id → role
    with db.transaction() as c:
        for ch in body.changes:
            ct = b""
            if ch.ciphertext:
                try:
                    ct = base64.b64decode(ch.ciphertext, validate=True)
                except (ValueError, TypeError) as exc:
                    raise HTTPException(
                        status_code=422, detail=f"invalid base64 ciphertext for {ch.id}"
                    ) from exc
            if len(ct) > MAX_BLOB_BYTES:
                raise HTTPException(status_code=413, detail=f"blob too large: {ch.id}")
            if not ch.deleted and not ct:
                raise HTTPException(status_code=422, detail=f"missing ciphertext for {ch.id}")

            if ch.project_id:
                if ch.project_id not in roles:
                    roles[ch.project_id] = shares.grant_role(c, ch.project_id, user.id)
                if roles[ch.project_id] != "owner":
                    results.append(
                        PushResult(
                            collection=ch.collection,
                            id=ch.id,
                            status="forbidden",
                            server_seq=0,
                            updated_at=ch.updated_at,
                            project_id=ch.project_id,
                        )
                    )
                    continue
                existing = c.execute(
                    "SELECT server_seq, updated_at FROM shared_blobs"
                    " WHERE project_id=? AND collection=? AND id=?",
                    (ch.project_id, ch.collection, ch.id),
                ).fetchone()
            else:
                existing = c.execute(
                    "SELECT server_seq, updated_at FROM blobs"
                    " WHERE user_id=? AND collection=? AND id=?",
                    (user.id, ch.collection, ch.id),
                ).fetchone()
            if existing is not None and existing["updated_at"] > ch.updated_at:
                results.append(
                    PushResult(
                        collection=ch.collection,
                        id=ch.id,
                        status="stale",
                        server_seq=existing["server_seq"],
                        updated_at=existing["updated_at"],
                        project_id=ch.project_id,
                    )
                )
                continue

            # Per-user storage quota for original-file bytes. Rejected per-blob
            # (status "quota", not an HTTP error) so the rest of the batch — and
            # the document's own text sync in other collections — is unaffected,
            # and the client can tell "over quota" apart from transient failures.
            # Shared originals bill the OWNER — who is exactly the pusher here
            # (readers were already turned away above), so `user.id` is always
            # the right account to charge.
            if ch.collection == ORIGINALS_COLLECTION and not ch.deleted:
                used = _originals_used_bytes(
                    c, user.id, ch.id, exclude_project_id=ch.project_id or ""
                )
                if used + len(ct) > entitlements.resolve(user.id).storage_bytes:
                    results.append(
                        PushResult(
                            collection=ch.collection,
                            id=ch.id,
                            status="quota",
                            server_seq=existing["server_seq"] if existing else 0,
                            updated_at=existing["updated_at"] if existing else ch.updated_at,
                            project_id=ch.project_id,
                        )
                    )
                    continue

            if ch.project_id:
                seq = db.next_project_seq(c, ch.project_id)
                c.execute(
                    "INSERT INTO shared_blobs(project_id, collection, id, ciphertext,"
                    " content_ver, updated_at, server_seq, deleted) VALUES (?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(project_id, collection, id) DO UPDATE SET"
                    " ciphertext=excluded.ciphertext, content_ver=excluded.content_ver,"
                    " updated_at=excluded.updated_at, server_seq=excluded.server_seq,"
                    " deleted=excluded.deleted",
                    (ch.project_id, ch.collection, ch.id, ct, ch.content_ver,
                     ch.updated_at, seq, 1 if ch.deleted else 0),
                )
            else:
                seq = db.next_server_seq(c, user.id)
                c.execute(
                    "INSERT INTO blobs(user_id, collection, id, ciphertext, content_ver,"
                    " updated_at, server_seq, deleted) VALUES (?,?,?,?,?,?,?,?)"
                    " ON CONFLICT(user_id, collection, id) DO UPDATE SET"
                    " ciphertext=excluded.ciphertext, content_ver=excluded.content_ver,"
                    " updated_at=excluded.updated_at, server_seq=excluded.server_seq,"
                    " deleted=excluded.deleted",
                    (user.id, ch.collection, ch.id, ct, ch.content_ver, ch.updated_at,
                     seq, 1 if ch.deleted else 0),
                )
            results.append(
                PushResult(
                    collection=ch.collection,
                    id=ch.id,
                    status="accepted",
                    server_seq=seq,
                    updated_at=ch.updated_at,
                    project_id=ch.project_id,
                )
            )
        latest = _latest_seq(c, user.id)
        project_latest = {
            pid: _latest_project_seq(c, pid)
            for pid, role in roles.items()
            if role == "owner"
        }
    return PushResponse(results=results, latest_seq=latest, project_latest_seqs=project_latest)
