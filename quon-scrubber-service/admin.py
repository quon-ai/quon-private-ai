"""Operator admin API — metadata-level user management, never content.

Auth: a session whose account has ``role='admin'`` (normal cookie+CSRF path,
so all admin endpoints inherit session expiry, CSRF and rate limits), OR the
``ADMIN_TOKEN`` bearer as break-glass (CLI/bootstrap on instances that predate
the role column). Every mutation is written to ``admin_audit``.

The zero-knowledge model is untouched: everything served here is metadata the
server necessarily has (email, status, byte counts, budgets) — content stays
ciphertext. There is deliberately no admin password reset that preserves data
(impossible by design: the Master Key derives from the user's password) and no
impersonation.
"""

from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

import crypto_server as crypto
import db
import entitlements
from config import settings

router = APIRouter()

INVITE_DEFAULT_TTL_HOURS = 14 * 24
AUDIT_PAGE_MAX = 200


# --- auth ------------------------------------------------------------------


async def require_admin_actor(
    request: Request, authorization: str = Header(default="")
) -> str:
    """Resolve the acting admin: session user with role=admin (preferred) or
    the ADMIN_TOKEN bearer ('token'). 403 otherwise."""
    # Break-glass token path first — header-authenticated, no cookie involved,
    # hence not CSRF-able. Needed to bootstrap the first admin on an existing
    # instance and as CLI fallback.
    token = settings.admin_token.strip()
    presented = authorization.removeprefix("Bearer ").strip()
    if token and presented and secrets.compare_digest(presented, token):
        return "token"

    # Session path: full cookie+CSRF pipeline via auth.current_user.
    import auth  # late import — auth imports config early; avoid cycles at module load

    try:
        user = await auth.current_user(request)
    except HTTPException:
        raise HTTPException(status_code=403, detail="forbidden")
    if user.status != "active" or user.role != "admin":
        raise HTTPException(status_code=403, detail="forbidden")
    return user.id


def _audit(actor: str, action: str, target: str = "", detail: str = "") -> None:
    with db.get_conn() as c:
        c.execute(
            "INSERT INTO admin_audit(id, actor, action, target, detail, created_at)"
            " VALUES (?,?,?,?,?,?)",
            (str(uuid.uuid4()), actor, action, target, detail[:500], db.now_ms()),
        )


# --- models ----------------------------------------------------------------


class AdminUser(BaseModel):
    id: str
    email: str
    status: str
    role: str
    created_at: int
    activated_at: int | None = None
    last_seen: int | None = None
    storage_bytes: int = 0
    provisioned: bool = False
    key_disabled: bool = False
    limit_usd: float | None = None
    # Spent so far against the included budget (the operator's request: see how
    # much credit each account has used, not only the cap).
    usage_usd: float | None = None
    budget_override_usd: float | None = None
    storage_override_bytes: int | None = None


class StatusUpdate(BaseModel):
    status: str  # 'active' | 'suspended'


class RoleUpdate(BaseModel):
    role: str  # 'user' | 'admin'


class EntitlementsUpdate(BaseModel):
    budget_usd: float | None = Field(default=None, ge=0, le=10_000)
    storage_bytes: int | None = Field(default=None, ge=0, le=1024**4)


class InviteCreate(BaseModel):
    note: str = ""
    ttl_hours: int = Field(default=INVITE_DEFAULT_TTL_HOURS, ge=1, le=365 * 24)


class InviteInfo(BaseModel):
    id: str
    note: str
    created_at: int
    expires_at: int
    used_at: int | None = None
    # plaintext code — ONLY set on the create response (hash-stored otherwise)
    code: str | None = None


class AdminStats(BaseModel):
    users_total: int
    users_active: int
    users_pending: int
    users_suspended: int
    storage_bytes_total: int
    invites_open: int


class AuditEntry(BaseModel):
    actor: str
    action: str
    target: str
    detail: str
    created_at: int


# --- users -----------------------------------------------------------------


@router.get("/admin/users", response_model=list[AdminUser])
async def list_users(actor: str = Depends(require_admin_actor)) -> list[AdminUser]:
    with db.get_conn() as c:
        rows = c.execute(
            """
            SELECT u.id, u.email, u.status, u.role, u.created_at, u.activated_at,
                   COALESCE(u.last_active_at,
                     (SELECT MAX(s.last_seen) FROM sessions s WHERE s.user_id=u.id)) AS last_seen,
                   (SELECT COALESCE(SUM(LENGTH(b.ciphertext)),0) FROM blobs b
                     WHERE b.user_id=u.id AND b.deleted=0) +
                   (SELECT COALESCE(SUM(LENGTH(sb.ciphertext)),0) FROM shared_blobs sb
                     JOIN project_shares ps ON ps.project_id=sb.project_id
                     WHERE ps.owner_user_id=u.id AND sb.deleted=0) AS storage_bytes,
                   k.or_hash IS NOT NULL AS provisioned,
                   COALESCE(k.disabled,0) AS key_disabled,
                   k.limit_usd AS limit_usd,
                   k.usage_usd AS usage_usd,
                   e.budget_usd AS budget_override_usd,
                   e.storage_bytes AS storage_override_bytes
              FROM users u
              LEFT JOIN user_or_keys k ON k.user_id=u.id
              LEFT JOIN user_entitlements e ON e.user_id=u.id
             ORDER BY u.created_at ASC
            """
        ).fetchall()
    return [
        AdminUser(
            id=r["id"], email=r["email"], status=r["status"], role=r["role"],
            created_at=r["created_at"], activated_at=r["activated_at"],
            last_seen=r["last_seen"], storage_bytes=int(r["storage_bytes"] or 0),
            provisioned=bool(r["provisioned"]), key_disabled=bool(r["key_disabled"]),
            limit_usd=r["limit_usd"], usage_usd=r["usage_usd"],
            budget_override_usd=r["budget_override_usd"],
            storage_override_bytes=r["storage_override_bytes"],
        )
        for r in rows
    ]


def _load_user(c, user_id: str):
    row = c.execute(
        "SELECT id, email, status, role FROM users WHERE id=?", (user_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="unknown user")
    return row


@router.post("/admin/users/{user_id}/status")
async def set_status(
    user_id: str, body: StatusUpdate, actor: str = Depends(require_admin_actor)
) -> dict:
    """Suspend (block login + API, keep all data) or re-activate an account."""
    if body.status not in ("active", "suspended"):
        raise HTTPException(status_code=422, detail="status must be active|suspended")
    if actor == user_id:
        raise HTTPException(status_code=409, detail="you cannot suspend yourself")
    with db.get_conn() as c:
        row = _load_user(c, user_id)
        if row["status"] == "pending" and body.status == "active":
            raise HTTPException(
                status_code=409, detail="pending accounts activate via email verification"
            )
        c.execute("UPDATE users SET status=? WHERE id=?", (body.status, user_id))
        if body.status == "suspended":
            # Kill live sessions so the block is immediate, not next-request.
            c.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
    _audit(actor, f"user.{body.status}", user_id, row["email"])
    return {"ok": True, "user_id": user_id, "status": body.status}


@router.post("/admin/users/{user_id}/role")
async def set_role(
    user_id: str, body: RoleUpdate, actor: str = Depends(require_admin_actor)
) -> dict:
    """Promote/demote. Guard: an admin cannot demote themselves (lockout)."""
    if body.role not in ("user", "admin"):
        raise HTTPException(status_code=422, detail="role must be user|admin")
    if actor == user_id and body.role != "admin":
        raise HTTPException(status_code=409, detail="you cannot demote yourself")
    with db.get_conn() as c:
        row = _load_user(c, user_id)
        c.execute("UPDATE users SET role=? WHERE id=?", (body.role, user_id))
    _audit(actor, f"user.role.{body.role}", user_id, row["email"])
    return {"ok": True, "user_id": user_id, "role": body.role}


@router.post("/admin/users/{user_id}/resend-verification")
async def resend_verification(
    user_id: str, actor: str = Depends(require_admin_actor)
) -> dict:
    import auth

    with db.get_conn() as c:
        row = c.execute(
            "SELECT id, email, status, ui_language FROM users WHERE id=?", (user_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="unknown user")
    if row["status"] != "pending":
        raise HTTPException(status_code=409, detail="account is not pending")
    auth._issue_email_token(user_id, row["email"], "verify", row["ui_language"])
    _audit(actor, "user.resend_verification", user_id, row["email"])
    return {"ok": True}


@router.put("/admin/users/{user_id}/entitlements")
async def set_entitlements(
    user_id: str, body: EntitlementsUpdate, actor: str = Depends(require_admin_actor)
) -> dict:
    """Set per-user budget/storage overrides (None field = instance default).
    A changed budget is pushed to the provisioned OpenRouter sub-key at once."""
    import account
    import openrouter_provisioning as prov

    with db.get_conn() as c:
        row = _load_user(c, user_id)
    entitlements.set_overrides(
        user_id, budget_usd=body.budget_usd, storage_bytes=body.storage_bytes
    )
    resolved = entitlements.resolve(user_id)
    with db.get_conn() as c:
        krow = c.execute(
            "SELECT or_hash FROM user_or_keys WHERE user_id=?", (user_id,)
        ).fetchone()
    if krow is not None:
        await prov.set_limit(krow["or_hash"], resolved.budget_usd)
        with db.get_conn() as c:
            c.execute(
                "UPDATE user_or_keys SET limit_usd=?, updated_at=? WHERE user_id=?",
                (resolved.budget_usd, db.now_ms(), user_id),
            )
        account._usage_cache.pop(user_id, None)
    _audit(
        actor, "user.entitlements", user_id,
        f"{row['email']}: budget={body.budget_usd} storage={body.storage_bytes}",
    )
    return {
        "ok": True,
        "user_id": user_id,
        "budget_usd": resolved.budget_usd,
        "storage_bytes": resolved.storage_bytes,
    }


@router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, actor: str = Depends(require_admin_actor)) -> dict:
    """Permanently delete an account and ALL its data (irrecoverable — the
    content is ciphertext only the user's keys could open, so there is nothing
    to export or restore). Best-effort revokes the OpenRouter sub-key first;
    the users-row delete then FK-cascades every dependent row (keys, sessions,
    tokens, blobs, sub-key, settings, entitlements, MCP servers). Admins delete
    their OWN account via the normal self-service flow (password-verified) —
    not here (self-guard)."""
    import openrouter_provisioning as prov

    if actor == user_id:
        raise HTTPException(status_code=409, detail="delete your own account via Settings")
    with db.get_conn() as c:
        row = _load_user(c, user_id)
    if prov.is_enabled():
        with db.get_conn() as c:
            krow = c.execute(
                "SELECT or_hash FROM user_or_keys WHERE user_id=?", (user_id,)
            ).fetchone()
        if krow is not None:
            try:
                await prov.delete_key(krow["or_hash"])
            except prov.ProvisioningError:
                pass  # never block deletion on the provider being reachable
    with db.get_conn() as c:
        c.execute("DELETE FROM users WHERE id=?", (user_id,))
    _audit(actor, "user.delete", user_id, row["email"])
    return {"ok": True, "user_id": user_id}


# --- invites ---------------------------------------------------------------


@router.post("/admin/invites", response_model=InviteInfo, status_code=201)
async def create_invite(
    body: InviteCreate, actor: str = Depends(require_admin_actor)
) -> InviteInfo:
    code = secrets.token_urlsafe(12)
    invite_id = str(uuid.uuid4())
    now = db.now_ms()
    expires = now + body.ttl_hours * 3600 * 1000
    with db.get_conn() as c:
        c.execute(
            "INSERT INTO invites(id, code_hash, note, created_by, created_at, expires_at)"
            " VALUES (?,?,?,?,?,?)",
            (invite_id, crypto.sha256(code.encode()), body.note.strip()[:200], actor,
             now, expires),
        )
    _audit(actor, "invite.create", invite_id, body.note.strip()[:200])
    return InviteInfo(
        id=invite_id, note=body.note.strip()[:200], created_at=now,
        expires_at=expires, code=code,
    )


@router.get("/admin/invites", response_model=list[InviteInfo])
async def list_invites(actor: str = Depends(require_admin_actor)) -> list[InviteInfo]:
    with db.get_conn() as c:
        rows = c.execute(
            "SELECT id, note, created_at, expires_at, used_at FROM invites"
            " ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
    return [
        InviteInfo(
            id=r["id"], note=r["note"], created_at=r["created_at"],
            expires_at=r["expires_at"], used_at=r["used_at"],
        )
        for r in rows
    ]


@router.delete("/admin/invites/{invite_id}")
async def revoke_invite(invite_id: str, actor: str = Depends(require_admin_actor)) -> dict:
    with db.get_conn() as c:
        cur = c.execute(
            "DELETE FROM invites WHERE id=? AND used_at IS NULL", (invite_id,)
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="unknown or already used invite")
    _audit(actor, "invite.revoke", invite_id)
    return {"ok": True}


# --- stats + audit ---------------------------------------------------------


@router.get("/admin/stats", response_model=AdminStats)
async def stats(actor: str = Depends(require_admin_actor)) -> AdminStats:
    with db.get_conn() as c:
        by_status = dict(
            c.execute("SELECT status, COUNT(*) FROM users GROUP BY status").fetchall()
        )
        storage = c.execute(
            "SELECT COALESCE(SUM(LENGTH(ciphertext)),0) FROM blobs WHERE deleted=0"
        ).fetchone()[0]
        shared = c.execute(
            "SELECT COALESCE(SUM(LENGTH(ciphertext)),0) FROM shared_blobs WHERE deleted=0"
        ).fetchone()[0]
        invites_open = c.execute(
            "SELECT COUNT(*) FROM invites WHERE used_at IS NULL AND expires_at > ?",
            (db.now_ms(),),
        ).fetchone()[0]
    return AdminStats(
        users_total=sum(by_status.values()),
        users_active=by_status.get("active", 0),
        users_pending=by_status.get("pending", 0),
        users_suspended=by_status.get("suspended", 0),
        storage_bytes_total=int(storage) + int(shared),
        invites_open=invites_open,
    )


@router.get("/admin/audit", response_model=list[AuditEntry])
async def audit_log(
    limit: int = 100, actor: str = Depends(require_admin_actor)
) -> list[AuditEntry]:
    limit = max(1, min(limit, AUDIT_PAGE_MAX))
    with db.get_conn() as c:
        rows = c.execute(
            "SELECT actor, action, target, detail, created_at FROM admin_audit"
            " ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [AuditEntry(**dict(r)) for r in rows]
