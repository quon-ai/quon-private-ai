"""Shared Projects v1: identity keys, share/invite/accept lifecycle, grant
checks on shared sync, per-project seq isolation, owner quota, revoke/leave/
unshare. Companion to test_sync.py (personal sync stays covered there)."""

from __future__ import annotations

import base64

from conftest import b64, make_active_user

AUTH = b"A" * 32  # make_active_user's default auth token - lets us re-login


def _login(client, email):
    """Switch the TestClient's session to an existing user (one cookie jar)."""
    client.cookies.clear()
    r = client.post("/auth/login", json={"email": email, "auth_token": b64(AUTH)})
    assert r.status_code == 200
    return {"X-QUON-CSRF": client.cookies.get("quon_csrf")}


def _identity(client, headers, pub: bytes = b"P" * 32):
    return client.post(
        "/auth/identity",
        json={"identity_pub": b64(pub), "identity_priv_wrapped": b64(b"W" * 72)},
        headers=headers,
    )


def _share(client, headers, project_id="p1"):
    return client.post(
        "/shares", json={"project_id": project_id, "sealed_pk": b64(b"S" * 80)}, headers=headers
    )


def _invite(client, headers, project_id="p1"):
    return client.post(f"/shares/{project_id}/invites", headers=headers)


def _accept(client, headers, token):
    return client.post(
        "/shares/accept", json={"token": token, "sealed_pk": b64(b"B" * 80)}, headers=headers
    )


def _push(client, headers, changes):
    return client.post("/sync/push", json={"changes": changes}, headers=headers)


def _blob(pid, id_, payload: bytes, updated_at=100, collection="memory", deleted=False):
    return {
        "project_id": pid,
        "collection": collection,
        "id": id_,
        "ciphertext": b64(payload) if payload else "",
        "updated_at": updated_at,
        "deleted": deleted,
    }


def _shared_project(c, owner="own@x.de", reader="rdr@x.de", pid="p1"):
    """Owner shares `pid`, reader accepts an invite. Leaves the client logged in
    as the READER; use `_login(c, owner)` to act as the owner again."""
    h_o = make_active_user(c, owner)
    assert _share(c, h_o, pid).status_code == 201
    token = _invite(c, h_o, pid).json()["token"]
    h_r = make_active_user(c, reader)
    r = _accept(c, h_r, token)
    assert r.status_code == 200
    assert r.json() == {"project_id": pid, "role": "reader"}
    return h_r


# --- identity keypair -------------------------------------------------------


def test_identity_set_once_and_threaded_through(quon_client):
    c = quon_client
    h = make_active_user(c, "id1@x.de")

    # Fresh accounts report no identity on /auth/me.
    me = c.get("/auth/me").json()
    assert me["identity_pub"] is None and me["identity_priv_wrapped"] is None

    r = _identity(c, h)
    assert r.status_code == 200
    assert base64.b64decode(r.json()["identity_pub"]) == b"P" * 32

    # Set-once: a second attempt (even with the same session) is a 409.
    assert _identity(c, h, pub=b"Q" * 32).status_code == 409

    # Threaded through /auth/me and the login response.
    me = c.get("/auth/me").json()
    assert base64.b64decode(me["identity_pub"]) == b"P" * 32
    assert base64.b64decode(me["identity_priv_wrapped"]) == b"W" * 72
    login_user = c.post(
        "/auth/login", json={"email": "id1@x.de", "auth_token": b64(AUTH)}
    ).json()["user"]
    assert base64.b64decode(login_user["identity_pub"]) == b"P" * 32


def test_identity_pub_must_be_32_bytes(quon_client):
    c = quon_client
    h = make_active_user(c, "id2@x.de")
    r = c.post(
        "/auth/identity",
        json={"identity_pub": b64(b"short"), "identity_priv_wrapped": b64(b"W" * 72)},
        headers=h,
    )
    assert r.status_code == 422


# --- share / invite / accept -------------------------------------------------


def test_share_create_and_duplicate_409(quon_client):
    c = quon_client
    h = make_active_user(c, "sh1@x.de")
    assert _share(c, h).status_code == 201
    assert _share(c, h).status_code == 409

    shares = c.get("/shares").json()["shares"]
    assert shares == [
        {
            "project_id": "p1",
            "role": "owner",
            "owner": True,
            "member_count": 1,
            "created_at": shares[0]["created_at"],
            # the caller's own grant ciphertext - fresh devices restore the PK from it
            "sealed_pk": b64(b"S" * 80),
        }
    ]


def test_invite_accept_happy_path(quon_client):
    c = quon_client
    _shared_project(c)  # logged in as reader

    mine = c.get("/shares").json()["shares"]
    assert len(mine) == 1
    assert mine[0]["role"] == "reader" and mine[0]["owner"] is False
    assert mine[0]["member_count"] == 2

    # Any member sees the member list (emails included - accepted v1 scope).
    members = c.get("/shares/p1/members").json()["members"]
    assert {(m["email"], m["role"]) for m in members} == {
        ("own@x.de", "owner"),
        ("rdr@x.de", "reader"),
    }


def test_invite_owner_only(quon_client):
    c = quon_client
    _shared_project(c)  # reader session
    assert _invite(c, {"X-QUON-CSRF": c.cookies.get("quon_csrf")}).status_code == 403

    make_active_user(c, "outsider@x.de")
    h_out = {"X-QUON-CSRF": c.cookies.get("quon_csrf")}
    # Non-member: 404 (never reveals the project exists), same for a made-up id.
    assert _invite(c, h_out, "p1").status_code == 404
    assert _invite(c, h_out, "no-such-project").status_code == 404


def test_invite_cap(quon_client):
    c = quon_client
    h = make_active_user(c, "cap@x.de")
    _share(c, h)
    for _ in range(10):
        assert _invite(c, h).status_code == 200
    assert _invite(c, h).status_code == 409


def test_accept_token_single_use(quon_client):
    c = quon_client
    h_o = make_active_user(c, "su-own@x.de")
    _share(c, h_o)
    token = _invite(c, h_o).json()["token"]

    h_b = make_active_user(c, "su-b@x.de")
    assert _accept(c, h_b, token).status_code == 200

    h_c = make_active_user(c, "su-c@x.de")
    assert _accept(c, h_c, token).status_code == 400


def test_accept_consumes_token_even_for_existing_member(quon_client):
    c = quon_client
    h_o = make_active_user(c, "im-own@x.de")
    _share(c, h_o)
    t1 = _invite(c, h_o).json()["token"]
    t2 = _invite(c, h_o).json()["token"]

    h_b = make_active_user(c, "im-b@x.de")
    assert _accept(c, h_b, t1).json()["role"] == "reader"
    # Second accept by the same member: 200 with the existing role...
    assert _accept(c, h_b, t2).json() == {"project_id": "p1", "role": "reader"}
    # ...but the token is consumed regardless.
    h_c = make_active_user(c, "im-c@x.de")
    assert _accept(c, h_c, t2).status_code == 400


def test_accept_expired_token(quon_client, monkeypatch):
    import shares as shares_mod

    monkeypatch.setattr(shares_mod, "INVITE_TTL_MS", -1000)
    c = quon_client
    h_o = make_active_user(c, "exp-own@x.de")
    _share(c, h_o)
    token = _invite(c, h_o).json()["token"]

    h_b = make_active_user(c, "exp-b@x.de")
    assert _accept(c, h_b, token).status_code == 400


def test_accept_bad_tokens_are_uniform_400(quon_client):
    c = quon_client
    h_o = make_active_user(c, "bt-own@x.de")
    _share(c, h_o)
    real = _invite(c, h_o).json()["token"]
    real_id = real.split(".")[0]

    h_b = make_active_user(c, "bt-b@x.de")
    responses = [
        _accept(c, h_b, "garbage-without-dot"),
        _accept(c, h_b, "nonexistent-id.some-secret"),
        _accept(c, h_b, f"{real_id}.wrong-secret"),  # valid id, wrong secret
    ]
    # Uniform failure - no oracle about ids, secrets, or project existence.
    assert {r.status_code for r in responses} == {400}
    assert len({r.json()["detail"] for r in responses}) == 1


# --- grant checks on shared sync ---------------------------------------------


def test_changes_and_blob_require_grant(quon_client):
    c = quon_client
    _shared_project(c)
    h_o = _login(c, "own@x.de")
    r = _push(c, h_o, [_blob("p1", "m1", b"shared-cipher")])
    assert r.json()["results"][0]["status"] == "accepted"

    # Members (owner and reader) can pull.
    assert c.get("/sync/changes", params={"collection": "memory", "project_id": "p1"}).status_code == 200
    _login(c, "rdr@x.de")
    got = c.get("/sync/changes", params={"collection": "memory", "project_id": "p1"}).json()
    assert base64.b64decode(got["changes"][0]["ciphertext"]) == b"shared-cipher"
    assert got["changes"][0]["project_id"] == "p1"
    r = c.get("/sync/blob", params={"collection": "memory", "id": "m1", "project_id": "p1"})
    assert r.status_code == 200

    # Non-members get 404 on both - indistinguishable from a nonexistent project.
    make_active_user(c, "nm@x.de")
    for pid in ("p1", "no-such-project"):
        assert (
            c.get("/sync/changes", params={"collection": "memory", "project_id": pid}).status_code
            == 404
        )
        assert (
            c.get(
                "/sync/blob", params={"collection": "memory", "id": "m1", "project_id": pid}
            ).status_code
            == 404
        )


def test_members_list_only_for_members(quon_client):
    c = quon_client
    _shared_project(c)
    make_active_user(c, "nosy@x.de")
    assert c.get("/shares/p1/members").status_code == 404


def test_reader_push_forbidden_in_mixed_batch(quon_client):
    c = quon_client
    h_r = _shared_project(c)  # logged in as reader
    r = _push(
        c,
        h_r,
        [
            {"collection": "chat", "id": "own1", "ciphertext": b64(b"mine"), "updated_at": 100},
            _blob("p1", "m1", b"nope"),
        ],
    )
    assert r.status_code == 200
    personal, shared = r.json()["results"]
    assert personal["status"] == "accepted" and personal["project_id"] is None
    assert shared["status"] == "forbidden" and shared["project_id"] == "p1"
    # Non-member / unknown project pushes look exactly the same (non-oracle).
    make_active_user(c, "np@x.de")
    h_n = {"X-QUON-CSRF": c.cookies.get("quon_csrf")}
    r = _push(c, h_n, [_blob("p1", "m1", b"x"), _blob("ghost", "m1", b"x")])
    assert [x["status"] for x in r.json()["results"]] == ["forbidden", "forbidden"]


def test_shared_lww_and_tombstone(quon_client):
    c = quon_client
    _shared_project(c)
    h_o = _login(c, "own@x.de")
    _push(c, h_o, [_blob("p1", "m1", b"v1", updated_at=200)])
    stale = _push(c, h_o, [_blob("p1", "m1", b"old", updated_at=150)])
    assert stale.json()["results"][0]["status"] == "stale"
    _push(c, h_o, [_blob("p1", "m1", b"", updated_at=300, deleted=True)])

    delta = c.get(
        "/sync/changes", params={"collection": "memory", "project_id": "p1", "since": 1}
    ).json()
    assert delta["changes"][-1]["deleted"] is True
    assert (
        c.get(
            "/sync/blob", params={"collection": "memory", "id": "m1", "project_id": "p1"}
        ).status_code
        == 404
    )


# --- per-project sequence isolation -------------------------------------------


def test_per_project_seq_isolation(quon_client):
    c = quon_client
    h = make_active_user(c, "seq@x.de")
    _share(c, h, "pA")
    _share(c, h, "pB")

    # Personal blob first - bumps the PERSONAL stream only.
    _push(c, h, [{"collection": "chat", "id": "c1", "ciphertext": b64(b"x"), "updated_at": 1}])

    r = _push(c, h, [_blob("pA", "a1", b"a"), _blob("pB", "b1", b"b"), _blob("pA", "a2", b"a2")])
    body = r.json()
    seqs = {(x["project_id"], x["id"]): x["server_seq"] for x in body["results"]}
    # Each project's sequence starts at 1 and advances independently.
    assert seqs[("pA", "a1")] == 1 and seqs[("pA", "a2")] == 2
    assert seqs[("pB", "b1")] == 1
    assert body["project_latest_seqs"] == {"pA": 2, "pB": 1}
    assert body["latest_seq"] == 1  # personal stream untouched by shared writes

    a = c.get("/sync/changes", params={"collection": "memory", "project_id": "pA"}).json()
    b = c.get("/sync/changes", params={"collection": "memory", "project_id": "pB"}).json()
    assert a["latest_seq"] == 2 and b["latest_seq"] == 1
    assert {x["id"] for x in a["changes"]} == {"a1", "a2"}
    assert {x["id"] for x in b["changes"]} == {"b1"}


# --- owner quota for shared originals -----------------------------------------


def test_shared_originals_count_against_owner_quota(quon_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "originals_quota_bytes", 100)
    c = quon_client
    h = make_active_user(c, "q@x.de")
    _share(c, h)

    r = _push(c, h, [_blob("p1", "orig:d1:0", b"S" * 60, collection="originals")])
    assert r.json()["results"][0]["status"] == "accepted"

    # Personal push now sees the 60 shared bytes -> 60 + 60 > 100 -> quota.
    r = _push(
        c,
        h,
        [{"collection": "originals", "id": "orig:d2:0", "ciphertext": b64(b"P" * 60), "updated_at": 100}],
    )
    assert r.json()["results"][0]["status"] == "quota"

    # And the other way around: a second shared original also hits the cap...
    r = _push(c, h, [_blob("p1", "orig:d3:0", b"S" * 60, collection="originals")])
    assert r.json()["results"][0]["status"] == "quota"
    # ...while replacing the existing shared chunk (old bytes freed) fits.
    r = _push(c, h, [_blob("p1", "orig:d1:0", b"T" * 90, collection="originals", updated_at=200)])
    assert r.json()["results"][0]["status"] == "accepted"


# --- revoke / leave / unshare ---------------------------------------------------


def test_owner_revokes_member(quon_client):
    c = quon_client
    _shared_project(c)
    reader_id = c.get("/auth/me").json()["id"]
    h_o = _login(c, "own@x.de")
    owner_id = c.get("/auth/me").json()["id"]

    assert c.delete(f"/shares/p1/members/{owner_id}", headers=h_o).status_code == 409
    assert c.delete(f"/shares/p1/members/{reader_id}", headers=h_o).json() == {"ok": True}
    assert c.delete(f"/shares/p1/members/{reader_id}", headers=h_o).status_code == 404

    _login(c, "rdr@x.de")
    assert c.get("/shares").json()["shares"] == []
    assert (
        c.get("/sync/changes", params={"collection": "memory", "project_id": "p1"}).status_code
        == 404
    )


def test_reader_leaves_owner_cannot(quon_client):
    c = quon_client
    h_r = _shared_project(c)
    assert c.post("/shares/p1/leave", headers=h_r).json() == {"ok": True}
    assert (
        c.get("/sync/changes", params={"collection": "memory", "project_id": "p1"}).status_code
        == 404
    )
    h_o = _login(c, "own@x.de")
    assert c.post("/shares/p1/leave", headers=h_o).status_code == 409


def test_unshare_cascades(quon_client):
    c = quon_client
    _shared_project(c)
    h_o = _login(c, "own@x.de")
    _push(c, h_o, [_blob("p1", "m1", b"cipher")])

    assert c.delete("/shares/p1", headers=h_o).json() == {"ok": True}

    # Reader's grant is gone.
    _login(c, "rdr@x.de")
    assert c.get("/shares").json()["shares"] == []
    assert (
        c.get("/sync/changes", params={"collection": "memory", "project_id": "p1"}).status_code
        == 404
    )

    # Re-sharing the same project id starts from a clean slate: no old blobs,
    # fresh membership, and the per-project sequence restarts at 1 (the old
    # shared_blobs / shared_sync_meta rows were cascaded away).
    h_o = _login(c, "own@x.de")
    assert _share(c, h_o).status_code == 201
    assert c.get("/shares").json()["shares"][0]["member_count"] == 1
    got = c.get("/sync/changes", params={"collection": "memory", "project_id": "p1"}).json()
    assert got["changes"] == [] and got["latest_seq"] == 0
    r = _push(c, h_o, [_blob("p1", "m2", b"new")])
    assert r.json()["results"][0]["server_seq"] == 1


def test_unshared_reader_push_becomes_forbidden(quon_client):
    c = quon_client
    _shared_project(c)
    h_o = _login(c, "own@x.de")
    assert c.delete("/shares/p1", headers=h_o).json() == {"ok": True}
    # Even the former owner can no longer push to the dead project stream.
    r = _push(c, h_o, [_blob("p1", "m1", b"x")])
    assert r.json()["results"][0]["status"] == "forbidden"
