"""Shared Projects v1: read-only, zero-knowledge sharing of one project's
Memory/Documents/instruction between accounts on the same instance.

Trust model (the server stays dumb ciphertext storage, exactly like sync.py):

* Every shared project has a client-generated random **Project Key (PK)**; all
  of its blobs (``shared_blobs``) are encrypted under it in the browser.
* The server NEVER sees the PK. Each member's grant row carries ``sealed_pk`` —
  the PK sealed (libsodium sealed box) to that member's OWN X25519 identity
  pubkey (``users.identity_pub``, set via ``POST /auth/identity``). The owner
  submits their copy at share time, a reader theirs at accept time; both are
  opaque bytes here.
* Invites are out-of-band capability links: the server stores only
  ``sha256(secret)`` of a one-time token (wire format ``<id>.<secret>``, same
  pattern as email_tokens); the PK itself travels in the invite link's URL
  FRAGMENT, which never reaches the server. There is deliberately NO email
  lookup anywhere in this module — the server learns who the invitee is only
  at accept time (keeps the closed account-enumeration oracles closed).
* v1 is read-only for members (role ``reader``; only the ``owner`` pushes) and
  **revoke does not rotate the PK**: a removed member keeps whatever ciphertext
  and PK it already pulled. Revoking (or unsharing) stops access going
  *forward*; it is not retroactive. PK rotation + re-encrypt is v2 — the UI
  must say this clearly.

Non-oracle convention: anything a NON-member asks about a project answers
404 "project not found" — never 403 — so outsiders cannot probe whether a
project id exists or is shared. 403 is reserved for members whose ROLE is
insufficient (e.g. a reader minting invites); members already know the project
exists. /sync/push mirrors this with a per-blob "forbidden" status (sync.py).
"""

from __future__ import annotations

import base64
import secrets
import sqlite3
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import crypto_server as crypto
import db
from auth import User, current_active_user

router = APIRouter(prefix="/shares", tags=["shares"])

INVITE_TTL_MS = 7 * 24 * 3600 * 1000  # one-time invite links live a week
MAX_OPEN_INVITES = 10  # per project; "open" = neither used nor expired
# A sealed box of a 32-byte PK is ~80 bytes; the cap just bounds abuse.
MAX_SEALED_PK_BYTES = 512


# --- (de)serialization helpers ---------------------------------------------
def _decode_sealed_pk(value: str) -> bytes:
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="invalid base64 in 'sealed_pk'") from exc
    if not raw or len(raw) > MAX_SEALED_PK_BYTES:
        raise HTTPException(status_code=422, detail="sealed_pk size out of range")
    return raw


# --- request / response models ---------------------------------------------
class CreateShareRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=128)
    sealed_pk: str  # base64; the PK sealed to the CALLER's own identity_pub


class ShareInfo(BaseModel):
    project_id: str
    role: str  # "owner" | "reader"
    owner: bool
    member_count: int
    created_at: int
    # The caller's OWN grant ciphertext (base64) — the PK sealed to their
    # identity_pub. This is what lets a fresh device restore the project key
    # without any out-of-band material: unseal with the identity private key.
    sealed_pk: str


class SharesResponse(BaseModel):
    shares: list[ShareInfo]


class InviteResponse(BaseModel):
    token: str  # "<id>.<secret>" — hand to the invitee OUT OF BAND (with the
    # PK in the link fragment); shown exactly once, the server keeps only a hash
    expires_at: int


class AcceptRequest(BaseModel):
    token: str
    sealed_pk: str  # base64; the PK (from the link fragment) re-sealed by the
    # invitee's client to its OWN identity_pub


class AcceptResponse(BaseModel):
    project_id: str
    role: str


class MemberInfo(BaseModel):
    user_id: str
    email: str  # members already collaborate on the project — exposing member
    # emails TO members is accepted v1 scope (never anything about non-members)
    role: str
    granted_at: int


class MembersResponse(BaseModel):
    members: list[MemberInfo]


# --- grant helpers (also used by sync.py) -----------------------------------
def grant_role(conn, project_id: str, user_id: str) -> str | None:
    """The user's role in a shared project, or None — deliberately the same
    None for "not shared" and "not a member" (non-oracle)."""
    row = conn.execute(
        "SELECT role FROM project_grants WHERE project_id=? AND user_id=?",
        (project_id, user_id),
    ).fetchone()
    return row["role"] if row is not None else None


def require_member(conn, project_id: str, user_id: str) -> str:
    """The caller's role, or 404 — non-members must not learn the project exists."""
    role = grant_role(conn, project_id, user_id)
    if role is None:
        raise HTTPException(status_code=404, detail="project not found")
    return role


def _require_owner(conn, project_id: str, user_id: str) -> None:
    if require_member(conn, project_id, user_id) != "owner":
        raise HTTPException(status_code=403, detail="owner role required")


# --- endpoints ---------------------------------------------------------------
@router.post("", response_model=ShareInfo, status_code=201)
async def create_share(
    body: CreateShareRequest, user: User = Depends(current_active_user)
) -> ShareInfo:
    """Turn one of the caller's projects into a shared project.

    Records the share (owner = caller) plus the owner's own grant with their
    ``sealed_pk``. The project's content arrives separately: the client
    re-encrypts existing items under the PK and pushes them via
    ``/sync/push`` with ``project_id`` set. 409 when already shared."""
    sealed = _decode_sealed_pk(body.sealed_pk)
    now = db.now_ms()
    try:
        with db.transaction() as c:
            if c.execute(
                "SELECT 1 FROM project_shares WHERE project_id=?", (body.project_id,)
            ).fetchone():
                raise HTTPException(status_code=409, detail="project already shared")
            c.execute(
                "INSERT INTO project_shares(project_id, owner_user_id, created_at)"
                " VALUES (?,?,?)",
                (body.project_id, user.id, now),
            )
            c.execute(
                "INSERT INTO project_grants(project_id, user_id, role, sealed_pk, granted_at)"
                " VALUES (?,?,?,?,?)",
                (body.project_id, user.id, "owner", sealed, now),
            )
    except sqlite3.IntegrityError:
        # Lost a create race for the same project_id (PK on project_shares).
        raise HTTPException(status_code=409, detail="project already shared")
    return ShareInfo(
        project_id=body.project_id,
        role="owner",
        owner=True,
        member_count=1,
        created_at=now,
        sealed_pk=body.sealed_pk,
    )


@router.get("", response_model=SharesResponse)
async def list_shares(user: User = Depends(current_active_user)) -> SharesResponse:
    """Every shared project the caller is a member of (own shares included)."""
    with db.get_conn() as c:
        rows = c.execute(
            "SELECT g.project_id, g.role, g.sealed_pk, ps.created_at,"
            " (SELECT COUNT(*) FROM project_grants g2 WHERE g2.project_id=g.project_id)"
            "  AS member_count"
            " FROM project_grants g JOIN project_shares ps ON ps.project_id=g.project_id"
            " WHERE g.user_id=? ORDER BY ps.created_at ASC",
            (user.id,),
        ).fetchall()
    return SharesResponse(
        shares=[
            ShareInfo(
                project_id=r["project_id"],
                role=r["role"],
                owner=r["role"] == "owner",
                member_count=r["member_count"],
                created_at=r["created_at"],
                sealed_pk=base64.b64encode(r["sealed_pk"]).decode(),
            )
            for r in rows
        ]
    )


@router.post("/{project_id}/invites", response_model=InviteResponse)
async def create_invite(
    project_id: str, user: User = Depends(current_active_user)
) -> InviteResponse:
    """Mint a one-time invite token (owner only). The response is the only time
    the secret exists server-side in the clear — only its hash is stored."""
    now = db.now_ms()
    exp = now + INVITE_TTL_MS
    secret = secrets.token_urlsafe(32)
    invite_id = uuid.uuid4().hex
    with db.transaction() as c:
        _require_owner(c, project_id, user.id)
        open_count = c.execute(
            "SELECT COUNT(*) AS n FROM share_invites"
            " WHERE project_id=? AND used_at IS NULL AND expires_at > ?",
            (project_id, now),
        ).fetchone()["n"]
        if open_count >= MAX_OPEN_INVITES:
            raise HTTPException(
                status_code=409, detail=f"too many open invites (max {MAX_OPEN_INVITES})"
            )
        c.execute(
            "INSERT INTO share_invites(id, project_id, token_hash, created_at, expires_at)"
            " VALUES (?,?,?,?,?)",
            (invite_id, project_id, crypto.sha256(secret.encode()), now, exp),
        )
    return InviteResponse(token=f"{invite_id}.{secret}", expires_at=exp)


@router.post("/accept", response_model=AcceptResponse)
async def accept_invite(
    body: AcceptRequest, user: User = Depends(current_active_user)
) -> AcceptResponse:
    """Redeem a one-time invite token → reader grant for the caller.

    The caller submits the PK re-sealed to their OWN pubkey (their client got
    the PK from the invite link's fragment — it never touches the server).
    Every failure mode is the same 400 (no oracle about which part failed or
    whether the project exists). Idempotent-ish: when the caller already has a
    grant the existing role is returned — but the token is still consumed."""
    token_id, _, secret = body.token.partition(".")
    if not token_id or not secret:
        raise HTTPException(status_code=400, detail="invalid or expired invite")
    sealed = _decode_sealed_pk(body.sealed_pk)
    now = db.now_ms()
    with db.transaction() as c:
        row = c.execute("SELECT * FROM share_invites WHERE id=?", (token_id,)).fetchone()
        if (
            row is None
            or row["used_at"] is not None
            or row["expires_at"] < now
            or not crypto.hash_matches(secret.encode(), row["token_hash"])
        ):
            raise HTTPException(status_code=400, detail="invalid or expired invite")
        project_id = row["project_id"]
        c.execute("UPDATE share_invites SET used_at=? WHERE id=?", (now, token_id))
        existing = grant_role(c, project_id, user.id)
        if existing is not None:
            return AcceptResponse(project_id=project_id, role=existing)
        c.execute(
            "INSERT INTO project_grants(project_id, user_id, role, sealed_pk, granted_at)"
            " VALUES (?,?,?,?,?)",
            (project_id, user.id, "reader", sealed, now),
        )
    return AcceptResponse(project_id=project_id, role="reader")


@router.get("/{project_id}/members", response_model=MembersResponse)
async def list_members(
    project_id: str, user: User = Depends(current_active_user)
) -> MembersResponse:
    """Member list (any member may look; non-members get the usual 404)."""
    with db.get_conn() as c:
        require_member(c, project_id, user.id)
        rows = c.execute(
            "SELECT g.user_id, u.email, g.role, g.granted_at"
            " FROM project_grants g JOIN users u ON u.id=g.user_id"
            " WHERE g.project_id=? ORDER BY g.granted_at ASC",
            (project_id,),
        ).fetchall()
    return MembersResponse(
        members=[
            MemberInfo(
                user_id=r["user_id"], email=r["email"], role=r["role"],
                granted_at=r["granted_at"],
            )
            for r in rows
        ]
    )


@router.delete("/{project_id}/members/{member_id}")
async def remove_member(
    project_id: str, member_id: str, user: User = Depends(current_active_user)
) -> dict:
    """Owner revokes a member's grant. Access-revocation only: the removed
    member keeps the ciphertext + PK it already pulled (no PK rotation in v1)."""
    with db.transaction() as c:
        _require_owner(c, project_id, user.id)
        if member_id == user.id:
            raise HTTPException(
                status_code=409, detail="owner cannot remove themselves — delete the share"
            )
        removed = c.execute(
            "DELETE FROM project_grants WHERE project_id=? AND user_id=?",
            (project_id, member_id),
        ).rowcount
    if not removed:
        raise HTTPException(status_code=404, detail="member not found")
    return {"ok": True}


@router.post("/{project_id}/leave")
async def leave_share(project_id: str, user: User = Depends(current_active_user)) -> dict:
    """A reader drops their own grant. The owner cannot leave — they delete the
    whole share instead (there is no ownership transfer in v1)."""
    with db.transaction() as c:
        role = require_member(c, project_id, user.id)
        if role == "owner":
            raise HTTPException(
                status_code=409, detail="owner cannot leave — delete the share instead"
            )
        c.execute(
            "DELETE FROM project_grants WHERE project_id=? AND user_id=?",
            (project_id, user.id),
        )
    return {"ok": True}


@router.delete("/{project_id}")
async def delete_share(project_id: str, user: User = Depends(current_active_user)) -> dict:
    """Unshare entirely (owner only): drops the share row, and FK cascades take
    the grants, open invites, shared blobs and the seq counter with it. The
    owner's own copy lives in their personal collections and is untouched;
    former members keep whatever they already pulled (documented v1 limit —
    revocation is not retroactive without PK rotation)."""
    with db.transaction() as c:
        _require_owner(c, project_id, user.id)
        c.execute("DELETE FROM project_shares WHERE project_id=?", (project_id,))
    return {"ok": True}
