"""Authentication: accounts, email verification, sessions, CSRF.

Zero-knowledge by construction - the server only ever receives:
  * ``authToken``        - a high-entropy value the client derives from the
                           password; stored only as a salted Argon2id verifier.
  * ``wrap_pw``/``wrap_rec`` - the Master Key doubly wrapped (password + recovery
                           phrase). The server cannot unwrap either.
  * ``kdf_salt``/``kdf_params``/``rec_salt`` - public KDF parameters.

It never sees the password, the recovery phrase, or the Master Key. Login returns
the password-wrapped Master Key so the client can unlock it locally.

Sessions are opaque: the httpOnly ``quon_session`` cookie carries
``<id>.<secret>`` and the DB stores only ``sha256(secret)``. A readable
``quon_csrf`` cookie carries a CSRF token that the SPA echoes in the
``X-QUON-CSRF`` header on unsafe requests; the server checks it against the
session's stored ``csrf_hash`` (double-submit + server binding).
"""

from __future__ import annotations

import base64
import json
import logging
import re
import secrets
import sqlite3
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

import crypto_server as crypto
import db
import email_service
import openrouter_provisioning
from config import settings

logger = logging.getLogger("quon.auth")

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_COOKIE = "quon_csrf"
CSRF_HEADER = "x-quon-csrf"


# --- (de)serialization helpers -------------------------------------------
def _b64d(value: str, field: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid base64 in '{field}'") from exc


def _b64e(value: bytes) -> str:
    return base64.b64encode(value).decode("ascii")


def _identity_fields(row) -> dict:
    """The b64 identity-key columns from a ``users`` row, for MeResponse
    (both None until the client has called POST /auth/identity)."""
    pub, priv = row["identity_pub"], row["identity_priv_wrapped"]
    return {
        "identity_pub": _b64e(pub) if pub else None,
        "identity_priv_wrapped": _b64e(priv) if priv else None,
    }


# --- request / response models -------------------------------------------
def _norm_lang(value: str | None) -> str | None:
    """'de'/'en' or None - the only accepted UI-language values."""
    return value if value in ("de", "en") else None


class RegisterRequest(BaseModel):
    email: str
    invite_code: str = ""  # required only when settings.signup_invite_code is set
    terms_version: str = ""  # accepted Nutzungsvereinbarung version (src/lib/legal.ts)
    language: str = ""  # chosen UI language 'de'|'en' (stored + used for the verify email)
    auth_token: str  # base64, high-entropy, derived client-side from password
    kdf_salt: str  # base64
    kdf_params: dict  # {alg, ops, mem, v} - the client's DEFAULT_KDF shape
    wrap_pw: str  # base64, nonce||secretbox(MK) under password-derived key
    rec_salt: str  # base64
    wrap_rec: str  # base64, nonce||secretbox(MK) under recovery-derived key


class LoginRequest(BaseModel):
    email: str
    auth_token: str  # base64


class VerifyRequest(BaseModel):
    token: str


class KeyMaterial(BaseModel):
    wrap_pw: str
    kdf_salt: str
    kdf_params: dict


class KdfResponse(BaseModel):
    kdf_salt: str
    kdf_params: dict


class MeResponse(BaseModel):
    id: str
    email: str
    status: str
    # 'user' | 'admin' - gates the /admin UI client-side (server re-checks on
    # every admin endpoint). Defaults 'user' so fake-success/anti-enumeration
    # responses never leak anything.
    role: str = "user"
    # True exactly once: the account was verified but has never yet driven the
    # client onboarding flow to completion/skip. Flipped False the moment
    # /auth/verify activates the account (see verify() below) - that is the one
    # unambiguous server-observable "brand new" event; defaults False so every
    # other response site (register/login/me/reset/change-*) is unaffected.
    onboarding_pending: bool = False
    # Shared-projects identity keypair (X25519, client-generated; see
    # POST /auth/identity). b64, or None until the client sets it. Populated on
    # login and /auth/me - the two session (re)establishment points - and by
    # /auth/identity itself; every other response site defaults to None.
    identity_pub: str | None = None
    identity_priv_wrapped: str | None = None
    # Account UI language 'de'|'en', or None when the account has no explicit
    # choice yet (client then keeps its device preference). Populated on login
    # and /auth/me (the boot sites); defaults None elsewhere.
    ui_language: str | None = None


class AuthResult(BaseModel):
    user: MeResponse
    key_material: KeyMaterial


# --- session user --------------------------------------------------------
@dataclass
class User:
    id: str
    email: str
    status: str
    session_id: str
    role: str = "user"


# Anti-enumeration dummy KDF params for unknown emails. Must mirror the client's
# DEFAULT_KDF shape in src/lib/crypto/quonCrypto.ts exactly (same keys, same
# values) - a differing key set would let /auth/kdf reveal whether an account
# exists.
_DEFAULT_KDF_PARAMS = {"alg": "argon2id", "ops": 3, "mem": 67108864, "v": 1}

# Lazily-initialized dummy Argon2 material so login burns the same KDF cost for
# unknown emails as for known ones (anti timing-oracle).
_DUMMY_SALT: bytes | None = None
_DUMMY_VERIFIER: bytes | None = None


def _dummy_verify(auth_token: bytes) -> None:
    """Run a full Argon2 verification against throwaway material, ignoring the
    result. Called on the unknown-email login path so its response time matches
    the wrong-password path (which does a real verification)."""
    global _DUMMY_SALT, _DUMMY_VERIFIER
    if _DUMMY_SALT is None or _DUMMY_VERIFIER is None:
        _DUMMY_SALT = crypto.new_salt()
        _DUMMY_VERIFIER = crypto.argon2_verifier(b"quon-dummy-login", _DUMMY_SALT)
    crypto.verify_auth_token(auth_token, _DUMMY_SALT, _DUMMY_VERIFIER)


# --- maintenance -----------------------------------------------------------
def sweep_expired() -> tuple[int, int]:
    """Delete expired sessions and spent/expired email tokens.

    Nothing functional depends on this - expiry is always re-checked at use - 
    but without it both tables grow forever (every login is a session row,
    every signup/reset an email token). Called periodically from the app
    lifespan. Returns ``(sessions_deleted, tokens_deleted)`` for logging.
    """
    now = db.now_ms()
    with db.get_conn() as c:
        sessions = c.execute("DELETE FROM sessions WHERE expires_at < ?", (now,)).rowcount
        tokens = c.execute(
            "DELETE FROM email_tokens WHERE expires_at < ? OR used_at IS NOT NULL", (now,)
        ).rowcount
        # Shared-project invites follow the same single-use/expiry lifecycle as
        # email tokens - sweep them together (counted with `tokens`).
        tokens += c.execute(
            "DELETE FROM share_invites WHERE expires_at < ? OR used_at IS NOT NULL", (now,)
        ).rowcount
        # Refresh the query planner's statistics after bulk deletes (no-op when
        # there is nothing to do; recommended by SQLite for long-running apps).
        c.execute("PRAGMA optimize")
    return sessions, tokens


# --- session helpers ------------------------------------------------------
def _set_session_cookies(response: Response, cookie_value: str, csrf: str) -> None:
    max_age = settings.session_ttl_hours * 3600
    common = {
        "max_age": max_age,
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_samesite,
        "path": "/",
    }
    if settings.cookie_domain:
        common["domain"] = settings.cookie_domain
    response.set_cookie(settings.cookie_name, cookie_value, httponly=True, **common)
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, **common)


def _clear_session_cookies(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")


def _create_session(user_id: str, user_agent: str) -> tuple[str, str]:
    """Create a session row; return (cookie_value, csrf_token)."""
    sid = uuid.uuid4().hex
    secret = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    now = db.now_ms()
    exp = now + settings.session_ttl_hours * 3600 * 1000
    with db.get_conn() as c:
        c.execute(
            "INSERT INTO sessions(id, user_id, token_hash, csrf_hash, created_at,"
            " expires_at, last_seen, user_agent) VALUES (?,?,?,?,?,?,?,?)",
            (sid, user_id, crypto.sha256(secret.encode()), crypto.sha256(csrf.encode()),
             now, exp, now, user_agent[:256]),
        )
    return f"{sid}.{secret}", csrf


# --- auth dependency ------------------------------------------------------
async def current_user(request: Request) -> User:
    """Resolve the authenticated user from the session cookie.

    Enforces CSRF (header must match the session's csrf binding) on unsafe
    methods. Raises 401 when unauthenticated, 403 on CSRF failure.
    """
    raw = request.cookies.get(settings.cookie_name, "")
    sid, _, secret = raw.partition(".")
    if not sid or not secret:
        raise HTTPException(status_code=401, detail="not authenticated")

    with db.get_conn() as c:
        row = c.execute("SELECT * FROM sessions WHERE id = ?", (sid,)).fetchone()
        if row is None or not crypto.hash_matches(secret.encode(), row["token_hash"]):
            raise HTTPException(status_code=401, detail="invalid session")
        if row["expires_at"] < db.now_ms():
            c.execute("DELETE FROM sessions WHERE id = ?", (sid,))
            raise HTTPException(status_code=401, detail="session expired")

        if request.method in _UNSAFE_METHODS:
            presented = request.headers.get(CSRF_HEADER, "")
            if not presented or not crypto.hash_matches(presented.encode(), row["csrf_hash"]):
                raise HTTPException(status_code=403, detail="missing or invalid CSRF token")

        urow = c.execute(
            "SELECT id, email, status, role FROM users WHERE id = ?", (row["user_id"],)
        ).fetchone()
        if urow is None:
            raise HTTPException(status_code=401, detail="account no longer exists")
        now = db.now_ms()
        c.execute("UPDATE sessions SET last_seen = ? WHERE id = ?", (now, sid))
        # Durable per-user activity: survives logout/expiry (which DELETE the
        # session rows the admin table used to derive "last active" from).
        # Throttled to one write per 5 min so this doesn't double the write
        # load of every request.
        c.execute(
            "UPDATE users SET last_active_at = ? WHERE id = ?"
            " AND (last_active_at IS NULL OR last_active_at < ?)",
            (now, row["user_id"], now - 300_000),
        )

    return User(
        id=urow["id"], email=urow["email"], status=urow["status"], session_id=sid,
        role=urow["role"],
    )


async def current_active_user(user: User = Depends(current_user)) -> User:
    """Like :func:`current_user` but requires an activated account."""
    if user.status != "active":
        raise HTTPException(status_code=403, detail="account not activated")
    return user


async def current_user_optional(request: Request) -> User | None:
    """Resolve the active user if there's a valid session, else None (no raise).

    For endpoints that work unauthenticated but enrich their response for a
    logged-in user (e.g. include the user's own provider connections)."""
    try:
        user = await current_user(request)
    except HTTPException:
        return None
    return user if user.status == "active" else None


# --- endpoints ------------------------------------------------------------
@router.get("/kdf", response_model=KdfResponse)
async def get_kdf(email: str) -> KdfResponse:
    """KDF salt + params for an email (needed to derive authToken at login).

    Returns a deterministic *dummy* salt for unknown emails so the endpoint does
    not reveal whether an account exists.
    """
    normalized = email.strip().lower()
    # Compute the dummy salt unconditionally so known/unknown emails take the
    # same code path work-wise (no timing tell before the DB branch).
    pepper = settings.quon_server_secret or "quon-enum-pepper"
    dummy = crypto.hmac_sha256(pepper, normalized)[: crypto.SALT_BYTES]
    with db.get_conn() as c:
        row = c.execute(
            "SELECT k.kdf_salt AS s, k.kdf_params AS p FROM users u"
            " JOIN user_keys k ON k.user_id = u.id WHERE u.email = ?",
            (normalized,),
        ).fetchone()
    if row is not None:
        return KdfResponse(kdf_salt=_b64e(row["s"]), kdf_params=json.loads(row["p"]))
    return KdfResponse(kdf_salt=_b64e(dummy), kdf_params=_DEFAULT_KDF_PARAMS)


def _consume_single_use_invite(code: str) -> bool:
    """Atomically consume an unused, unexpired single-use invite. Returns False
    for unknown/used/expired codes (constant-shape: one indexed lookup)."""
    if not code:
        return False
    code_hash = crypto.sha256(code.encode())
    now = db.now_ms()
    with db.get_conn() as c:
        cur = c.execute(
            "UPDATE invites SET used_at=? WHERE code_hash=? AND used_at IS NULL"
            " AND expires_at > ?",
            (now, code_hash, now),
        )
        return cur.rowcount == 1


@router.post("/register", response_model=MeResponse, status_code=201)
async def register(body: RegisterRequest) -> MeResponse:
    """Create a pending account + store wrapped key material; send verify email."""
    # Closed-beta gate: when a static invite code is configured, registration
    # requires it - OR a valid single-use invite (admin-issued, invites table).
    # The single-use invite is validated + consumed up front, before any email
    # branching, so a consumed invite can't be probed to learn whether an email
    # was already registered (anti-enumeration parity across all branches).
    required_code = settings.signup_invite_code
    if required_code:
        presented = body.invite_code.strip()
        if not secrets.compare_digest(presented, required_code):
            if not _consume_single_use_invite(presented):
                raise HTTPException(status_code=403, detail="Invalid invite code.")

    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="invalid email address")

    auth_token = _b64d(body.auth_token, "auth_token")
    kdf_salt = _b64d(body.kdf_salt, "kdf_salt")
    wrap_pw = _b64d(body.wrap_pw, "wrap_pw")
    rec_salt = _b64d(body.rec_salt, "rec_salt")
    wrap_rec = _b64d(body.wrap_rec, "wrap_rec")

    user_id = str(uuid.uuid4())
    auth_salt = crypto.new_salt()
    verifier = crypto.argon2_verifier(auth_token, auth_salt)
    now = db.now_ms()
    # Record which Nutzungsvereinbarung the user accepted (proof of consent =
    # version + timestamp). The checkbox in the client gates the request; here we
    # just persist what was accepted. Empty version -> no acceptance recorded.
    terms_version = body.terms_version.strip() or None
    terms_at = now if terms_version else None
    lang = _norm_lang(body.language)  # chosen UI language, stored + used for the verify email

    # transaction(): the users + user_keys writes must land together - a crash or
    # race between them would orphan a users row with no key material, wedging the
    # account (login treats it as nonexistent). BEGIN is deferred, so the early
    # anti-enumeration return below holds no write lock.
    with db.transaction() as c:
        existing = c.execute("SELECT id, status FROM users WHERE email = ?", (email,)).fetchone()
        if existing is not None:
            # Anti-enumeration: an already-ACTIVE account must be indistinguishable
            # from a fresh signup. Touch nothing (no user/key rows, no verify
            # token); notify the real owner instead, and return a fake pending
            # response - like a fresh signup, exactly one email goes out.
            if existing["status"] == "active":
                if not settings.email_verification_required:
                    # No verification => no inbox to notify and no fake-pending
                    # dance; the honest answer is the useful one here.
                    raise HTTPException(status_code=409, detail="An account with this email already exists.")
                email_service.send_already_registered(email)
                return MeResponse(id=str(uuid.uuid4()), email=email, status="pending")
            # Allow re-sending verification for a still-pending signup - in the
            # MAIL flow only. Without verification, replacing the credentials
            # would hand the pending account (and its role) to whoever asks.
            if not settings.email_verification_required:
                raise HTTPException(status_code=409, detail="An account with this email already exists.")
            user_id = existing["id"]
            c.execute(
                "UPDATE users SET auth_verifier=?, auth_salt=?, created_at=?,"
                " terms_version=?, terms_accepted_at=?, ui_language=? WHERE id=?",
                (verifier, auth_salt, now, terms_version, terms_at, lang, user_id),
            )
            c.execute(
                "UPDATE user_keys SET kdf=?, kdf_params=?, kdf_salt=?, wrap_pw=?,"
                " rec_salt=?, wrap_rec=?, updated_at=? WHERE user_id=?",
                ("argon2id", json.dumps(body.kdf_params), kdf_salt, wrap_pw,
                 rec_salt, wrap_rec, now, user_id),
            )
        else:
            # Self-hoster bootstrap: the very first account on a fresh instance
            # is the operator - it gets the admin role. Everyone after is 'user'
            # (promotion via the ADMIN_TOKEN break-glass or an existing admin).
            any_user = c.execute("SELECT 1 FROM users LIMIT 1").fetchone()
            role = "user" if any_user else "admin"
            c.execute(
                "INSERT INTO users(id, email, status, auth_verifier, auth_salt, created_at,"
                " onboarding_pending, terms_version, terms_accepted_at, ui_language, role)"
                " VALUES (?,?,?,?,?,?,1,?,?,?,?)",
                (user_id, email, "pending", verifier, auth_salt, now, terms_version, terms_at,
                 lang, role),
            )
            c.execute(
                "INSERT INTO user_keys(user_id, kdf, kdf_params, kdf_salt, wrap_pw,"
                " rec_salt, wrap_rec, updated_at) VALUES (?,?,?,?,?,?,?,?)",
                (user_id, "argon2id", json.dumps(body.kdf_params), kdf_salt, wrap_pw,
                 rec_salt, wrap_rec, now),
            )

    if settings.email_verification_required:
        _issue_email_token(user_id, email, "verify", lang)
        return MeResponse(id=user_id, email=email, status="pending")
    return await _activate_without_verification(user_id, email)


async def _activate_without_verification(user_id: str, email: str) -> MeResponse:
    """EMAIL_VERIFICATION=auto without SMTP, or "off": do what /auth/verify
    would have done, minus the token - provision first (fails closed, exactly
    like verify), then activate. No session is started: the client holds the
    password and signs in, which is also what derives its keys."""
    if openrouter_provisioning.is_enabled():
        try:
            await openrouter_provisioning.ensure_user_key(user_id)
        except openrouter_provisioning.ProvisioningError as exc:
            logger.error("provisioning failed for user %s: %s", user_id, exc)
            # The row was created a moment ago by this request; without a
            # verify step there is no way to finish it later, and a retry
            # would hit "already exists". Remove it so the retry can succeed.
            with db.transaction() as c:
                c.execute("DELETE FROM user_keys WHERE user_id=?", (user_id,))
                c.execute("DELETE FROM users WHERE id=? AND status='pending'", (user_id,))
            raise HTTPException(
                status_code=502, detail="could not provision your AI access — please retry"
            ) from exc
    now = db.now_ms()
    with db.transaction() as c:
        was_pending = c.execute(
            "SELECT onboarding_pending FROM users WHERE id=?", (user_id,)
        ).fetchone()["onboarding_pending"]
        c.execute(
            "UPDATE users SET status='active', activated_at=?, onboarding_pending=0"
            " WHERE id=? AND status='pending'",
            (now, user_id),
        )
        urow = c.execute("SELECT role FROM users WHERE id=?", (user_id,)).fetchone()
    return MeResponse(
        id=user_id, email=email, status="active", role=urow["role"],
        onboarding_pending=bool(was_pending),
    )


def _issue_email_token(user_id: str, email: str, purpose: str, lang: str | None = None) -> None:
    """Create a single-use email token and send the corresponding message.

    ``lang`` sets the email language; when None (reset/change flows) the target
    account's stored ``ui_language`` is used, falling back to the default.
    """
    if lang is None:
        with db.get_conn() as c:
            urow = c.execute("SELECT ui_language FROM users WHERE id=?", (user_id,)).fetchone()
        lang = _norm_lang(urow["ui_language"]) if urow is not None else None
    token = secrets.token_urlsafe(32)
    token_id = uuid.uuid4().hex
    exp = db.now_ms() + settings.email_token_ttl_hours * 3600 * 1000
    with db.transaction() as c:  # DELETE + INSERT are one logical replace
        c.execute("DELETE FROM email_tokens WHERE user_id=? AND purpose=?", (user_id, purpose))
        c.execute(
            "INSERT INTO email_tokens(id, user_id, purpose, token_hash, expires_at)"
            " VALUES (?,?,?,?,?)",
            (token_id, user_id, purpose, crypto.sha256(token.encode()), exp),
        )
    # Embed the token id so verification is an indexed lookup, not a table scan.
    wire = f"{token_id}.{token}"
    if purpose == "verify":
        email_service.send_verification(email, wire, lang)
    else:
        email_service.send_password_reset(email, wire, lang)


@router.post("/verify")
async def verify(body: VerifyRequest, request: Request, response: Response) -> MeResponse:
    """Confirm an email token, synchronously provision the user's OpenRouter
    sub-key (must succeed), then activate the account and start a session.

    Fails closed: if provisioning is enabled and the API call fails, the token is
    not consumed and the account stays ``pending`` - so an account never goes
    active without a usable key. Self-hosted QUON Home (no provisioning key)
    skips provisioning and uses BYOK instead.
    """
    token_id, _, secret = body.token.partition(".")
    if not token_id or not secret:
        raise HTTPException(status_code=400, detail="malformed token")

    now = db.now_ms()
    with db.get_conn() as c:
        row = c.execute(
            "SELECT * FROM email_tokens WHERE id=? AND purpose='verify'", (token_id,)
        ).fetchone()
        if (
            row is None
            or row["used_at"] is not None
            or row["expires_at"] < now
            or not crypto.hash_matches(secret.encode(), row["token_hash"])
        ):
            raise HTTPException(status_code=400, detail="invalid or expired token")
        user_id = row["user_id"]

    # Synchronous provisioning before activation (network call, outside the DB
    # connection). On failure the token stays unused so the user can retry.
    try:
        await openrouter_provisioning.ensure_user_key(user_id)
    except openrouter_provisioning.ProvisioningError as exc:
        logger.error("provisioning failed for user %s: %s", user_id, exc)
        raise HTTPException(
            status_code=502, detail="could not provision your AI access — please retry"
        ) from exc

    # transaction(): consuming the token and activating the account must be
    # atomic - a crash between them would burn the token while leaving the account
    # pending, so the user could never verify (token used, account not active).
    with db.transaction() as c:
        consumed = c.execute(
            "UPDATE email_tokens SET used_at=? WHERE id=? AND used_at IS NULL",
            (db.now_ms(), token_id),
        ).rowcount
        if not consumed:
            raise HTTPException(status_code=400, detail="invalid or expired token")
        # Read onboarding eligibility before clearing it: this response is the one
        # unambiguous, server-observable "brand new account" signal the client
        # gets (register() itself returns before the account can ever reach
        # `ready`). Cleared in the same statement so it is reported at most once,
        # regardless of which device/tab calls /auth/verify.
        was_pending = c.execute(
            "SELECT onboarding_pending FROM users WHERE id=?", (user_id,)
        ).fetchone()["onboarding_pending"]
        c.execute(
            "UPDATE users SET status='active', activated_at=?, onboarding_pending=0"
            " WHERE id=? AND status='pending'",
            (db.now_ms(), user_id),
        )
        urow = c.execute("SELECT id, email, status, role FROM users WHERE id=?", (user_id,)).fetchone()

    cookie_value, csrf = _create_session(user_id, request.headers.get("user-agent", ""))
    _set_session_cookies(response, cookie_value, csrf)
    return MeResponse(
        id=urow["id"],
        email=urow["email"],
        status=urow["status"],
        role=urow["role"],
        onboarding_pending=bool(was_pending),
    )


@router.post("/login", response_model=AuthResult)
async def login(body: LoginRequest, request: Request, response: Response) -> AuthResult:
    """Verify the authToken, start a session, and return the wrapped Master Key."""
    email = body.email.strip().lower()
    auth_token = _b64d(body.auth_token, "auth_token")

    with db.get_conn() as c:
        urow = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        krow = (
            c.execute("SELECT * FROM user_keys WHERE user_id=?", (urow["id"],)).fetchone()
            if urow
            else None
        )

    if urow is None or krow is None:
        # Anti timing-oracle: burn the same Argon2 cost as a real verification so
        # unknown emails don't answer measurably faster than wrong passwords.
        _dummy_verify(auth_token)
        raise HTTPException(status_code=401, detail="invalid email or password")
    if not crypto.verify_auth_token(auth_token, urow["auth_salt"], urow["auth_verifier"]):
        raise HTTPException(status_code=401, detail="invalid email or password")
    if urow["status"] == "pending":
        raise HTTPException(status_code=403, detail="email not verified")
    if urow["status"] == "suspended":
        raise HTTPException(status_code=403, detail="account suspended")

    cookie_value, csrf = _create_session(urow["id"], request.headers.get("user-agent", ""))
    _set_session_cookies(response, cookie_value, csrf)
    return AuthResult(
        user=MeResponse(
            id=urow["id"], email=urow["email"], status=urow["status"],
            role=urow["role"],
            ui_language=_norm_lang(urow["ui_language"]),
            **_identity_fields(urow),
        ),
        key_material=KeyMaterial(
            wrap_pw=_b64e(krow["wrap_pw"]),
            kdf_salt=_b64e(krow["kdf_salt"]),
            kdf_params=json.loads(krow["kdf_params"]),
        ),
    )


@router.post("/logout")
async def logout(response: Response, user: User = Depends(current_user)) -> dict:
    with db.get_conn() as c:
        c.execute("DELETE FROM sessions WHERE id=?", (user.session_id,))
    _clear_session_cookies(response)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(current_user)) -> MeResponse:
    with db.get_conn() as c:
        row = c.execute(
            "SELECT identity_pub, identity_priv_wrapped, ui_language FROM users WHERE id=?",
            (user.id,),
        ).fetchone()
    fields = _identity_fields(row) if row is not None else {}
    ui_language = _norm_lang(row["ui_language"]) if row is not None else None
    return MeResponse(
        id=user.id, email=user.email, status=user.status, role=user.role,
        ui_language=ui_language, **fields
    )


# --- shared-projects identity keypair --------------------------------------
class IdentityRequest(BaseModel):
    identity_pub: str  # base64 X25519 public key (exactly 32 bytes)
    identity_priv_wrapped: str  # base64; wrapped client-side under the Master Key


@router.post("/identity", response_model=MeResponse)
async def set_identity(
    body: IdentityRequest, user: User = Depends(current_active_user)
) -> MeResponse:
    """Store the account's client-generated X25519 identity keypair (set-once).

    Used by Shared Projects (shares.py): a member seals Project Keys to their
    own ``identity_pub``; ``identity_priv_wrapped`` is opaque to the server
    (wrapped under the Master Key client-side, CTX "quonidk0") and is stored
    only so the user's other devices can unwrap it. Set-once - 409 when already
    set - so a stolen session cannot swap in an attacker pubkey to intercept
    future grants (rotation would need re-sealing every grant; v2). Existing
    accounts backfill lazily on first use of sharing; new registrations may call
    this right after verify.
    """
    pub = _b64d(body.identity_pub, "identity_pub")
    priv = _b64d(body.identity_priv_wrapped, "identity_priv_wrapped")
    if len(pub) != 32:
        raise HTTPException(status_code=422, detail="identity_pub must be 32 bytes (X25519)")
    if not priv or len(priv) > 512:
        raise HTTPException(status_code=422, detail="identity_priv_wrapped size out of range")
    with db.get_conn() as c:
        updated = c.execute(
            "UPDATE users SET identity_pub=?, identity_priv_wrapped=?"
            " WHERE id=? AND identity_pub IS NULL",
            (pub, priv, user.id),
        ).rowcount
    if not updated:
        raise HTTPException(status_code=409, detail="identity key already set")
    return MeResponse(
        id=user.id,
        email=user.email,
        status=user.status,
        identity_pub=body.identity_pub,
        identity_priv_wrapped=body.identity_priv_wrapped,
    )


@router.get("/keymaterial", response_model=KeyMaterial)
async def keymaterial(user: User = Depends(current_user)) -> KeyMaterial:
    """The password-wrapped Master Key + KDF params, to unlock on this device."""
    with db.get_conn() as c:
        krow = c.execute("SELECT * FROM user_keys WHERE user_id=?", (user.id,)).fetchone()
    if krow is None:
        raise HTTPException(status_code=404, detail="no key material")
    return KeyMaterial(
        wrap_pw=_b64e(krow["wrap_pw"]),
        kdf_salt=_b64e(krow["kdf_salt"]),
        kdf_params=json.loads(krow["kdf_params"]),
    )


# --- UI language preference ------------------------------------------------
class UiLanguageRequest(BaseModel):
    language: str  # 'de' | 'en'


@router.put("/ui-language")
async def set_ui_language(
    body: UiLanguageRequest, user: User = Depends(current_active_user)
) -> dict:
    """Persist the account's UI language so it follows the user to new devices."""
    lang = _norm_lang(body.language)
    if lang is None:
        raise HTTPException(status_code=422, detail="language must be 'de' or 'en'")
    with db.get_conn() as c:
        c.execute("UPDATE users SET ui_language=? WHERE id=?", (lang, user.id))
    return {"ok": True, "language": lang}


# --- biometric unlock (WebAuthn PRF) ---------------------------------------
# A third wrap of the Master Key, parallel to wrap_pw/wrap_rec: the client
# derives the wrap key from a WebAuthn PRF output that never leaves the
# device's secure hardware, so wrap_bio is opaque here (zero-knowledge holds).
# Deliberately no server-side WebAuthn assertion verification in v1: the valid
# session cookie is the authentication factor (same trust as /auth/keymaterial,
# which hands out the password wrap on the same condition); the PRF ceremony is
# purely a key-RELEASE mechanism on the device. credential_id is the base64url
# string WebAuthn natively produces - stored as opaque TEXT, never decoded.
_BIO_MAX_CREDENTIALS = 10  # row-spam guard; ~one per device is the real-world shape


class BioKeyPut(BaseModel):
    credential_id: str = Field(min_length=1, max_length=1400)
    wrap_bio: str  # base64; nonce||secretbox(MK) under the PRF-derived key
    prf_salt: str  # base64; 32 bytes, public PRF eval input


class BioKeyMaterial(BaseModel):
    wrap_bio: str
    prf_salt: str


@router.put("/bio")
async def bio_put(body: BioKeyPut, user: User = Depends(current_active_user)) -> dict:
    """Enroll (or re-enroll) this device's biometric wrap of the Master Key."""
    wrap_bio = _b64d(body.wrap_bio, "wrap_bio")
    prf_salt = _b64d(body.prf_salt, "prf_salt")
    if not wrap_bio or len(wrap_bio) > 256:
        raise HTTPException(status_code=422, detail="wrap_bio size out of range")
    if len(prf_salt) != 32:
        raise HTTPException(status_code=422, detail="prf_salt must be 32 bytes")
    now = db.now_ms()
    with db.get_conn() as c:
        count = c.execute(
            "SELECT COUNT(*) AS n FROM user_bio_keys WHERE user_id=? AND credential_id<>?",
            (user.id, body.credential_id),
        ).fetchone()["n"]
        if count >= _BIO_MAX_CREDENTIALS:
            raise HTTPException(status_code=409, detail="too many enrolled devices")
        c.execute(
            "INSERT INTO user_bio_keys (user_id, credential_id, wrap_bio, prf_salt, created_at)"
            " VALUES (?,?,?,?,?)"
            " ON CONFLICT(user_id, credential_id) DO UPDATE SET"
            " wrap_bio=excluded.wrap_bio, prf_salt=excluded.prf_salt,"
            " created_at=excluded.created_at, last_used_at=NULL",
            (user.id, body.credential_id, wrap_bio, prf_salt, now),
        )
    return {"ok": True}


@router.get("/bio", response_model=BioKeyMaterial)
async def bio_get(credential_id: str, user: User = Depends(current_user)) -> BioKeyMaterial:
    """The biometric-wrapped Master Key for one enrolled credential.

    ``current_user`` (not active) on purpose: this serves the *locked* state,
    exactly like /auth/keymaterial above. 404 = revoked/never enrolled - the
    client clears its local marker and falls back to the password.
    """
    with db.get_conn() as c:
        row = c.execute(
            "SELECT wrap_bio, prf_salt FROM user_bio_keys WHERE user_id=? AND credential_id=?",
            (user.id, credential_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="not enrolled")
        c.execute(
            "UPDATE user_bio_keys SET last_used_at=? WHERE user_id=? AND credential_id=?",
            (db.now_ms(), user.id, credential_id),
        )
    return BioKeyMaterial(wrap_bio=_b64e(row["wrap_bio"]), prf_salt=_b64e(row["prf_salt"]))


@router.delete("/bio")
async def bio_delete(credential_id: str, user: User = Depends(current_user)) -> dict:
    """Turn biometric unlock off for one credential. Idempotent."""
    with db.get_conn() as c:
        c.execute(
            "DELETE FROM user_bio_keys WHERE user_id=? AND credential_id=?",
            (user.id, credential_id),
        )
    return {"ok": True}


# --- recovery / password reset -------------------------------------------
# Gated by an email 'reset' token (proves email control). The recovery phrase
# never reaches the server: the client uses it locally to unwrap the Master Key,
# then re-wraps it under the new password and submits the new material. The
# recovery wrap (wrap_rec/rec_salt) is unchanged, so the phrase keeps working.
class ResetRequestBody(BaseModel):
    email: str


class ResetMaterialResponse(BaseModel):
    rec_salt: str
    wrap_rec: str
    kdf_params: dict


class ResetPasswordRequest(BaseModel):
    token: str
    auth_token: str
    kdf_salt: str
    kdf_params: dict
    wrap_pw: str


def _validate_reset_token(token: str, consume: bool) -> str:
    token_id, _, secret = token.partition(".")
    if not token_id or not secret:
        raise HTTPException(status_code=400, detail="malformed token")
    now = db.now_ms()
    with db.get_conn() as c:
        row = c.execute(
            "SELECT * FROM email_tokens WHERE id=? AND purpose='reset'", (token_id,)
        ).fetchone()
        if (
            row is None
            or row["used_at"] is not None
            or row["expires_at"] < now
            or not crypto.hash_matches(secret.encode(), row["token_hash"])
        ):
            raise HTTPException(status_code=400, detail="invalid or expired token")
        if consume:
            c.execute("UPDATE email_tokens SET used_at=? WHERE id=?", (now, token_id))
        return row["user_id"]


@router.post("/reset/request")
async def reset_request(body: ResetRequestBody) -> dict:
    """Send a recovery link. Always 200 (no account enumeration)."""
    email = body.email.strip().lower()
    with db.get_conn() as c:
        row = c.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()
    if row is not None:
        _issue_email_token(row["id"], email, "reset")
    return {"ok": True}


@router.get("/reset/material", response_model=ResetMaterialResponse)
async def reset_material(token: str) -> ResetMaterialResponse:
    """Return the recovery-wrapped Master Key material so the client can unwrap it
    with the recovery phrase. Does not consume the token."""
    user_id = _validate_reset_token(token, consume=False)
    with db.get_conn() as c:
        krow = c.execute(
            "SELECT rec_salt, wrap_rec, kdf_params FROM user_keys WHERE user_id=?", (user_id,)
        ).fetchone()
    if krow is None:
        raise HTTPException(status_code=404, detail="no key material")
    return ResetMaterialResponse(
        rec_salt=_b64e(krow["rec_salt"]),
        wrap_rec=_b64e(krow["wrap_rec"]),
        kdf_params=json.loads(krow["kdf_params"]),
    )


@router.post("/reset-password", response_model=MeResponse)
async def reset_password(body: ResetPasswordRequest) -> MeResponse:
    """Set new password material (verifier + password-wrap). Consumes the token
    and invalidates existing sessions."""
    user_id = _validate_reset_token(body.token, consume=True)
    auth_token = _b64d(body.auth_token, "auth_token")
    kdf_salt = _b64d(body.kdf_salt, "kdf_salt")
    wrap_pw = _b64d(body.wrap_pw, "wrap_pw")
    auth_salt = crypto.new_salt()
    verifier = crypto.argon2_verifier(auth_token, auth_salt)
    now = db.now_ms()
    # transaction(): the verifier and the password-wrap must update together - a
    # partial write (new verifier, old wrap) would leave the account's synced data
    # undecryptable.
    with db.transaction() as c:
        c.execute(
            "UPDATE users SET auth_verifier=?, auth_salt=? WHERE id=?",
            (verifier, auth_salt, user_id),
        )
        c.execute(
            "UPDATE user_keys SET kdf_salt=?, kdf_params=?, wrap_pw=?, updated_at=? WHERE user_id=?",
            (kdf_salt, json.dumps(body.kdf_params), wrap_pw, now, user_id),
        )
        c.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
        urow = c.execute("SELECT id, email, status, role FROM users WHERE id=?", (user_id,)).fetchone()
    return MeResponse(id=urow["id"], email=urow["email"], status=urow["status"], role=urow["role"])


# --- account self-service: change email / password, delete ----------------
# All three require the CURRENT password (an authToken derived from it), never a
# session cookie alone - a stolen session must not be able to take over or destroy
# the account. Zero-knowledge holds: change-password re-wraps the Master Key
# client-side (server sees only the new wrap), so synced data stays decryptable
# and the recovery phrase keeps working.
class ChangeEmailRequest(BaseModel):
    new_email: str


class ChangePasswordRequest(BaseModel):
    current_auth_token: str  # proves the current password
    auth_token: str  # new password material (same shape as register/reset)
    kdf_salt: str
    kdf_params: dict
    wrap_pw: str  # MK re-wrapped under the new password (MK itself unchanged)


class RotateRecoveryRequest(BaseModel):
    # The OLD phrase is deliberately unrecoverable (never stored - the ZK point),
    # so "I lost my recovery phrase" is served by ROTATION: the unlocked client
    # generates a fresh mnemonic and re-wraps the (unchanged) Master Key under it.
    current_auth_token: str  # proves the current password (not just a cookie - 
    # a hijacked session without the password must not be able to brick or
    # take over the recovery path; same posture as change-password)
    rec_salt: str  # base64, fresh salt for the new phrase's Argon2id derivation
    wrap_rec: str  # base64, MK wrapped under the new phrase-derived key. The
    # client must derive with the account's STORED kdf_params (single column
    # shared with the password wrap) or a later recovery would derive wrongly.


class DeleteAccountRequest(BaseModel):
    auth_token: str  # proves the current password


def _verify_current_password(user_id: str, auth_token_b64: str) -> bool:
    """True when ``auth_token`` proves the user's current password (matches the
    stored Argon2id verifier)."""
    at = _b64d(auth_token_b64, "auth_token")
    with db.get_conn() as c:
        u = c.execute(
            "SELECT auth_verifier, auth_salt FROM users WHERE id=?", (user_id,)
        ).fetchone()
    if u is None:
        return False
    return crypto.verify_auth_token(at, u["auth_salt"], u["auth_verifier"])


def _issue_change_email_token(user_id: str, new_email: str) -> None:
    """Single-use token for confirming an email change; the link goes to the new
    address (proves the user controls it before we switch)."""
    token = secrets.token_urlsafe(32)
    token_id = uuid.uuid4().hex
    exp = db.now_ms() + settings.email_token_ttl_hours * 3600 * 1000
    with db.transaction() as c:  # DELETE + INSERT are one logical replace
        c.execute("DELETE FROM email_tokens WHERE user_id=? AND purpose='change_email'", (user_id,))
        c.execute(
            "INSERT INTO email_tokens(id, user_id, purpose, token_hash, expires_at, new_email)"
            " VALUES (?,?,?,?,?,?)",
            (token_id, user_id, "change_email", crypto.sha256(token.encode()), exp, new_email),
        )
        lrow = c.execute("SELECT ui_language FROM users WHERE id=?", (user_id,)).fetchone()
    lang = _norm_lang(lrow["ui_language"]) if lrow is not None else None
    email_service.send_email_change(new_email, f"{token_id}.{token}", lang)


@router.post("/change-email/request")
async def change_email_request(
    body: ChangeEmailRequest, user: User = Depends(current_active_user)
) -> dict:
    """Start an email change. Always returns ``{ok:true}`` - it never reveals
    whether the target address is already taken. A confirmation link is sent to
    the new address; the account email changes only once that link is confirmed."""
    new_email = body.new_email.strip().lower()
    if not _EMAIL_RE.match(new_email):
        raise HTTPException(status_code=422, detail="invalid email address")
    # No-op when it's already the current address. Skip the send if the address is
    # held by an ACTIVE account - but don't reveal that (still return ok).
    if new_email != user.email:
        with db.get_conn() as c:
            taken = c.execute(
                "SELECT 1 FROM users WHERE email=? AND status='active'", (new_email,)
            ).fetchone()
        if taken is None:
            _issue_change_email_token(user.id, new_email)
    return {"ok": True}


@router.post("/change-email/confirm", response_model=MeResponse)
async def change_email_confirm(body: VerifyRequest) -> MeResponse:
    """Confirm an email change from the link sent to the new address. Token-
    authenticated (no session needed); re-checks uniqueness to close the race
    between request and confirm."""
    token_id, _, secret = body.token.partition(".")
    if not token_id or not secret:
        raise HTTPException(status_code=400, detail="malformed token")
    now = db.now_ms()
    # transaction(): change the email and consume its token together - else a
    # crash between them leaves a spent-looking address change with a still-live
    # token (or vice versa).
    with db.transaction() as c:
        row = c.execute(
            "SELECT * FROM email_tokens WHERE id=? AND purpose='change_email'", (token_id,)
        ).fetchone()
        if (
            row is None
            or row["used_at"] is not None
            or row["expires_at"] < now
            or not crypto.hash_matches(secret.encode(), row["token_hash"])
        ):
            raise HTTPException(status_code=400, detail="invalid or expired token")
        new_email = row["new_email"]
        # Race re-check: another account may have taken it since the request.
        clash = c.execute(
            "SELECT 1 FROM users WHERE email=? AND id != ?", (new_email, row["user_id"])
        ).fetchone()
        if clash is not None:
            raise HTTPException(status_code=409, detail="email already registered")
        try:
            c.execute("UPDATE users SET email=? WHERE id=?", (new_email, row["user_id"]))
        except sqlite3.IntegrityError:
            # Another account took the address between the clash check and this
            # UPDATE (UNIQUE(users.email)); fail closed as 409, not a 500.
            raise HTTPException(status_code=409, detail="email already registered")
        c.execute("UPDATE email_tokens SET used_at=? WHERE id=?", (now, token_id))
        urow = c.execute(
            "SELECT id, email, status, role FROM users WHERE id=?", (row["user_id"],)
        ).fetchone()
    return MeResponse(id=urow["id"], email=urow["email"], status=urow["status"], role=urow["role"])


@router.post("/change-password", response_model=MeResponse)
async def change_password(
    body: ChangePasswordRequest, user: User = Depends(current_active_user)
) -> MeResponse:
    """Change the password: verify the CURRENT password, then store new material
    (fresh verifier + password-wrap). The Master Key is unchanged (re-wrapped
    client-side) so synced data stays decryptable and the recovery phrase keeps
    working. Every other session is invalidated; the caller stays logged in."""
    if not _verify_current_password(user.id, body.current_auth_token):
        raise HTTPException(status_code=403, detail="current password is incorrect")
    auth_token = _b64d(body.auth_token, "auth_token")
    kdf_salt = _b64d(body.kdf_salt, "kdf_salt")
    wrap_pw = _b64d(body.wrap_pw, "wrap_pw")
    auth_salt = crypto.new_salt()
    verifier = crypto.argon2_verifier(auth_token, auth_salt)
    now = db.now_ms()
    # transaction(): verifier + password-wrap must land together (a partial write
    # would leave synced data undecryptable - same reason as reset_password).
    with db.transaction() as c:
        c.execute(
            "UPDATE users SET auth_verifier=?, auth_salt=? WHERE id=?",
            (verifier, auth_salt, user.id),
        )
        c.execute(
            "UPDATE user_keys SET kdf_salt=?, kdf_params=?, wrap_pw=?, updated_at=? WHERE user_id=?",
            (kdf_salt, json.dumps(body.kdf_params), wrap_pw, now, user.id),
        )
        # Keep the caller's session; drop every other session for this user.
        c.execute("DELETE FROM sessions WHERE user_id=? AND id != ?", (user.id, user.session_id))
    return MeResponse(id=user.id, email=user.email, status=user.status)


@router.post("/recovery/rotate")
async def rotate_recovery(
    body: RotateRecoveryRequest, user: User = Depends(current_active_user)
) -> dict:
    """Replace the recovery wrap with one for a new phrase (the old phrase stops
    working immediately). The Master Key, password wrap and sessions are all
    untouched - this only swaps rec_salt + wrap_rec, atomically."""
    if not _verify_current_password(user.id, body.current_auth_token):
        raise HTTPException(status_code=403, detail="current password is incorrect")
    rec_salt = _b64d(body.rec_salt, "rec_salt")
    wrap_rec = _b64d(body.wrap_rec, "wrap_rec")
    now = db.now_ms()
    with db.transaction() as c:
        updated = c.execute(
            "UPDATE user_keys SET rec_salt=?, wrap_rec=?, updated_at=? WHERE user_id=?",
            (rec_salt, wrap_rec, now, user.id),
        ).rowcount
        if updated != 1:
            # No key row (should be impossible for an active account) - refuse
            # rather than silently succeeding with nothing rotated.
            raise HTTPException(status_code=409, detail="no key material for this account")
    return {"ok": True}


@router.post("/delete-account")
async def delete_account(
    body: DeleteAccountRequest,
    response: Response,
    user: User = Depends(current_active_user),
) -> dict:
    """Permanently delete the account after verifying the password. Best-effort
    revokes the OpenRouter sub-key first, then cascades away every user row
    (keys, sessions, tokens, blobs, sub-key, sync meta) and clears cookies."""
    if not _verify_current_password(user.id, body.auth_token):
        raise HTTPException(status_code=403, detail="password is incorrect")
    # Revoke the per-user sub-key first - best-effort; never block deletion on the
    # provider being reachable.
    if openrouter_provisioning.is_enabled():
        with db.get_conn() as c:
            krow = c.execute(
                "SELECT or_hash FROM user_or_keys WHERE user_id=?", (user.id,)
            ).fetchone()
        if krow is not None:
            try:
                await openrouter_provisioning.delete_key(krow["or_hash"])
            except openrouter_provisioning.ProvisioningError as exc:
                logger.warning("sub-key revoke failed during delete for %s: %s", user.id, exc)
    # FK cascade (PRAGMA foreign_keys=ON per connection) removes all dependent rows.
    with db.get_conn() as c:
        c.execute("DELETE FROM users WHERE id=?", (user.id,))
    _clear_session_cookies(response)
    return {"ok": True}
