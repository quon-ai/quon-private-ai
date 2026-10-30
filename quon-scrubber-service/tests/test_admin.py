"""Admin foundation + API: role bootstrap, access control, invites,
entitlements, suspension, audit. All metadata-level — no content access."""

from __future__ import annotations

from conftest import make_active_user, register_body


def _admin_and_user(c):
    """First account = admin (fresh instance bootstrap), second = plain user.
    Returns (admin_csrf, user_csrf). The client's cookie jar ends logged in as
    the SECOND (plain) user; re-login as admin via login() when needed."""
    admin_csrf = make_active_user(c, "admin@x.de", b"A" * 32)
    user_csrf = make_active_user(c, "user@x.de", b"B" * 32)
    return admin_csrf, user_csrf


def _login(c, email: str, auth_token: bytes) -> dict:
    from conftest import b64

    r = c.post("/auth/login", json={"email": email, "auth_token": b64(auth_token)})
    assert r.status_code == 200
    return {"X-QUON-CSRF": c.cookies.get("quon_csrf")}


def _user_id(c, email: str) -> str:
    import db

    with db.get_conn() as conn:
        return conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone()["id"]


# --- role bootstrap ---------------------------------------------------------


def test_first_account_becomes_admin_second_is_user(quon_client):
    c = quon_client
    _admin_and_user(c)
    import db

    with db.get_conn() as conn:
        roles = dict(conn.execute("SELECT email, role FROM users").fetchall())
    assert roles == {"admin@x.de": "admin", "user@x.de": "user"}


def test_me_reports_role(quon_client):
    c = quon_client
    _admin_and_user(c)
    _login(c, "admin@x.de", b"A" * 32)
    assert c.get("/auth/me").json()["role"] == "admin"
    _login(c, "user@x.de", b"B" * 32)
    assert c.get("/auth/me").json()["role"] == "user"


# --- access control ---------------------------------------------------------


def test_non_admin_gets_403_everywhere(quon_client):
    c = quon_client
    _admin_and_user(c)  # leaves the client logged in as the plain user
    csrf = _login(c, "user@x.de", b"B" * 32)
    assert c.get("/admin/users").status_code == 403
    assert c.get("/admin/stats").status_code == 403
    assert c.post("/admin/invites", json={}, headers=csrf).status_code == 403


def test_admin_session_works_and_token_break_glass(quon_client, monkeypatch):
    c = quon_client
    _admin_and_user(c)
    csrf = _login(c, "admin@x.de", b"A" * 32)
    users = c.get("/admin/users", headers=csrf).json()
    assert {u["email"] for u in users} == {"admin@x.de", "user@x.de"}

    # Break-glass: ADMIN_TOKEN bearer works with no session at all.
    from config import settings

    monkeypatch.setattr(settings, "admin_token", "tok-123")
    c.cookies.clear()
    r = c.get("/admin/users", headers={"Authorization": "Bearer tok-123"})
    assert r.status_code == 200
    r = c.get("/admin/users", headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 403


# --- suspend / role / resend ------------------------------------------------


def test_suspend_blocks_login_and_api_and_reactivate(quon_client):
    c = quon_client
    _admin_and_user(c)
    uid = _user_id(c, "user@x.de")
    csrf = _login(c, "admin@x.de", b"A" * 32)
    r = c.post(f"/admin/users/{uid}/status", json={"status": "suspended"}, headers=csrf)
    assert r.status_code == 200

    # Suspended: login rejected; any leftover session is gone (deleted on suspend).
    from conftest import b64

    r = c.post("/auth/login", json={"email": "user@x.de", "auth_token": b64(b"B" * 32)})
    assert r.status_code == 403

    # Re-activate → login works again.
    csrf = _login(c, "admin@x.de", b"A" * 32)
    c.post(f"/admin/users/{uid}/status", json={"status": "active"}, headers=csrf)
    r = c.post("/auth/login", json={"email": "user@x.de", "auth_token": b64(b"B" * 32)})
    assert r.status_code == 200


def test_admin_cannot_suspend_or_demote_self(quon_client):
    c = quon_client
    _admin_and_user(c)
    admin_id = _user_id(c, "admin@x.de")
    csrf = _login(c, "admin@x.de", b"A" * 32)
    r = c.post(f"/admin/users/{admin_id}/status", json={"status": "suspended"}, headers=csrf)
    assert r.status_code == 409
    r = c.post(f"/admin/users/{admin_id}/role", json={"role": "user"}, headers=csrf)
    assert r.status_code == 409


def test_promote_then_demote_other_user(quon_client):
    c = quon_client
    _admin_and_user(c)
    uid = _user_id(c, "user@x.de")
    csrf = _login(c, "admin@x.de", b"A" * 32)
    assert c.post(f"/admin/users/{uid}/role", json={"role": "admin"}, headers=csrf).status_code == 200
    users = {u["email"]: u["role"] for u in c.get("/admin/users", headers=csrf).json()}
    assert users["user@x.de"] == "admin"
    assert c.post(f"/admin/users/{uid}/role", json={"role": "user"}, headers=csrf).status_code == 200


# --- invites ----------------------------------------------------------------


def test_invite_lifecycle_single_use(quon_client, monkeypatch):
    from config import settings

    c = quon_client
    _admin_and_user(c)
    csrf = _login(c, "admin@x.de", b"A" * 32)
    r = c.post("/admin/invites", json={"note": "für Anna"}, headers=csrf)
    assert r.status_code == 201
    code = r.json()["code"]
    assert code  # plaintext only on create
    assert all(i["code"] is None for i in c.get("/admin/invites", headers=csrf).json())

    # Gate on: static code required — the single-use invite is accepted instead.
    monkeypatch.setattr(settings, "signup_invite_code", "static-beta")
    body = register_body("anna@x.de", b"C" * 32) | {"invite_code": code}
    assert c.post("/auth/register", json=body).status_code == 201

    # Single-use: the same code is now rejected.
    body = register_body("bob@x.de", b"D" * 32) | {"invite_code": code}
    assert c.post("/auth/register", json=body).status_code == 403

    # The static code still works in parallel.
    body = register_body("bob@x.de", b"D" * 32) | {"invite_code": "static-beta"}
    assert c.post("/auth/register", json=body).status_code == 201


def test_invite_expiry_and_revoke(quon_client, monkeypatch):
    from config import settings

    import db

    c = quon_client
    _admin_and_user(c)
    csrf = _login(c, "admin@x.de", b"A" * 32)
    expired = c.post("/admin/invites", json={"note": "old"}, headers=csrf).json()
    with db.get_conn() as conn:
        conn.execute("UPDATE invites SET expires_at=1 WHERE id=?", (expired["id"],))
    monkeypatch.setattr(settings, "signup_invite_code", "static-beta")
    body = register_body("late@x.de", b"E" * 32) | {"invite_code": expired["code"]}
    assert c.post("/auth/register", json=body).status_code == 403

    open_inv = c.post("/admin/invites", json={"note": "revoke me"}, headers=csrf).json()
    assert c.delete(f"/admin/invites/{open_inv['id']}", headers=csrf).status_code == 200
    body = register_body("late@x.de", b"E" * 32) | {"invite_code": open_inv["code"]}
    assert c.post("/auth/register", json=body).status_code == 403


# --- entitlements -----------------------------------------------------------


def test_entitlements_resolve_default_and_override(quon_client):
    import entitlements
    from config import settings

    c = quon_client
    _admin_and_user(c)
    uid = _user_id(c, "user@x.de")
    e = entitlements.resolve(uid)
    assert e.budget_usd == settings.openrouter_user_limit_usd
    assert e.storage_bytes == settings.originals_quota_bytes
    assert not e.overridden

    csrf = _login(c, "admin@x.de", b"A" * 32)
    r = c.put(
        f"/admin/users/{uid}/entitlements",
        json={"budget_usd": 20.0, "storage_bytes": 500 * 1024 * 1024},
        headers=csrf,
    )
    assert r.status_code == 200
    e = entitlements.resolve(uid)
    assert e.budget_usd == 20.0 and e.storage_bytes == 500 * 1024 * 1024 and e.overridden

    # Clearing both fields returns the user to instance defaults.
    c.put(f"/admin/users/{uid}/entitlements", json={}, headers=csrf)
    assert not entitlements.resolve(uid).overridden


def test_originals_usage_reflects_storage_override(quon_client):
    c = quon_client
    _admin_and_user(c)
    uid = _user_id(c, "user@x.de")
    admin_csrf = _login(c, "admin@x.de", b"A" * 32)
    c.put(
        f"/admin/users/{uid}/entitlements",
        json={"storage_bytes": 1234},
        headers=admin_csrf,
    )
    _login(c, "user@x.de", b"B" * 32)
    usage = c.get("/sync/originals/usage").json()
    assert usage["quota_bytes"] == 1234


# --- stats + audit ----------------------------------------------------------


def test_stats_and_audit_trail(quon_client):
    c = quon_client
    _admin_and_user(c)
    uid = _user_id(c, "user@x.de")
    csrf = _login(c, "admin@x.de", b"A" * 32)
    c.post(f"/admin/users/{uid}/status", json={"status": "suspended"}, headers=csrf)
    c.post("/admin/invites", json={"note": "n"}, headers=csrf)

    stats = c.get("/admin/stats", headers=csrf).json()
    assert stats["users_total"] == 2
    assert stats["users_suspended"] == 1
    assert stats["invites_open"] == 1

    audit = c.get("/admin/audit", headers=csrf).json()
    actions = [a["action"] for a in audit]
    assert "user.suspended" in actions and "invite.create" in actions
    admin_id = _user_id(c, "admin@x.de")
    assert all(a["actor"] == admin_id for a in audit)


# --- delete -----------------------------------------------------------------


def test_admin_delete_user_cascades_and_audits(quon_client):
    import db

    c = quon_client
    _admin_and_user(c)
    uid = _user_id(c, "user@x.de")
    csrf = _login(c, "admin@x.de", b"A" * 32)
    assert c.delete(f"/admin/users/{uid}", headers=csrf).status_code == 200

    with db.get_conn() as conn:
        assert conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone() is None
        assert conn.execute("SELECT 1 FROM user_keys WHERE user_id=?", (uid,)).fetchone() is None
        assert conn.execute("SELECT 1 FROM sessions WHERE user_id=?", (uid,)).fetchone() is None
    from conftest import b64

    r = c.post("/auth/login", json={"email": "user@x.de", "auth_token": b64(b"B" * 32)})
    assert r.status_code == 401  # account gone

    actions = [a["action"] for a in c.get("/admin/audit", headers=csrf).json()]
    assert "user.delete" in actions


def test_admin_cannot_delete_self(quon_client):
    c = quon_client
    _admin_and_user(c)
    admin_id = _user_id(c, "admin@x.de")
    csrf = _login(c, "admin@x.de", b"A" * 32)
    assert c.delete(f"/admin/users/{admin_id}", headers=csrf).status_code == 409


# --- durable "last active" ---------------------------------------------------


def test_last_active_survives_logout(quon_client):
    """Reported 2026-08-07 (screenshot: a user showing "—"): the admin table
    derived "last active" from live session rows, and logout DELETEs the
    session — so the users who tidily log out were the ones losing their
    date. It now lives on the user row."""
    c = quon_client
    _admin_and_user(c)  # leaves the client logged in as user@x.de

    # The user does something authenticated, then logs out.
    assert c.get("/auth/me").status_code == 200
    csrf = {"X-QUON-CSRF": c.cookies.get("quon_csrf")}
    assert c.post("/auth/logout", headers=csrf).status_code == 200

    # Old behavior: no sessions → last_seen NULL → "—". Now: still there.
    admin = _login(c, "admin@x.de", b"A" * 32)
    users = c.get("/admin/users", headers=admin).json()
    row = next(u for u in users if u["email"] == "user@x.de")
    assert row["last_seen"] is not None, "logout must not erase the activity date"


def test_last_active_write_is_throttled(quon_client):
    """One users-row write per 5 minutes, not per request — the per-request
    write stays on the session row only."""
    import db

    c = quon_client
    _admin_and_user(c)
    assert c.get("/auth/me").status_code == 200
    uid = _user_id(c, "user@x.de")
    with db.get_conn() as conn:
        first = conn.execute(
            "SELECT last_active_at FROM users WHERE id=?", (uid,)
        ).fetchone()["last_active_at"]
    assert first is not None
    # A second request within the throttle window must not bump the value.
    assert c.get("/auth/me").status_code == 200
    with db.get_conn() as conn:
        second = conn.execute(
            "SELECT last_active_at FROM users WHERE id=?", (uid,)
        ).fetchone()["last_active_at"]
    assert second == first
