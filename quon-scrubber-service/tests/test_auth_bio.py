"""Biometric-unlock key endpoints (/auth/bio - WebAuthn-PRF wrap of the MK).

The server never sees the PRF secret; these tests cover the storage contract:
per-(user, credential) rows, upsert, honest 404 for revoked/unknown credentials,
strict size validation, cross-user isolation, and the enrollment cap.
"""

from conftest import b64, make_active_user

CRED = "dGVzdC1jcmVkZW50aWFsLWlk"  # opaque base64url string, as WebAuthn produces


def bio_body(cred: str = CRED, wrap: bytes = b"B" * 72, salt: bytes = b"P" * 32) -> dict:
    return {"credential_id": cred, "wrap_bio": b64(wrap), "prf_salt": b64(salt)}


def test_put_then_get_roundtrip(quon_client):
    csrf = make_active_user(quon_client, "bio@quon.local")
    r = quon_client.put("/auth/bio", json=bio_body(), headers=csrf)
    assert r.status_code == 200

    r = quon_client.get("/auth/bio", params={"credential_id": CRED})
    assert r.status_code == 200
    assert r.json() == {"wrap_bio": b64(b"B" * 72), "prf_salt": b64(b"P" * 32)}


def test_put_upserts_same_credential(quon_client):
    csrf = make_active_user(quon_client, "bio@quon.local")
    quon_client.put("/auth/bio", json=bio_body(wrap=b"1" * 72), headers=csrf)
    quon_client.put("/auth/bio", json=bio_body(wrap=b"2" * 72), headers=csrf)

    r = quon_client.get("/auth/bio", params={"credential_id": CRED})
    assert r.json()["wrap_bio"] == b64(b"2" * 72)


def test_get_unknown_credential_404(quon_client):
    make_active_user(quon_client, "bio@quon.local")
    r = quon_client.get("/auth/bio", params={"credential_id": "bm9wZQ"})
    assert r.status_code == 404


def test_delete_is_idempotent(quon_client):
    csrf = make_active_user(quon_client, "bio@quon.local")
    quon_client.put("/auth/bio", json=bio_body(), headers=csrf)

    r = quon_client.delete("/auth/bio", params={"credential_id": CRED}, headers=csrf)
    assert r.status_code == 200
    assert quon_client.get("/auth/bio", params={"credential_id": CRED}).status_code == 404
    # Second delete of the now-absent row still succeeds.
    r = quon_client.delete("/auth/bio", params={"credential_id": CRED}, headers=csrf)
    assert r.status_code == 200


def test_cross_user_isolation(quon_client):
    csrf_a = make_active_user(quon_client, "a@quon.local")
    quon_client.put("/auth/bio", json=bio_body(), headers=csrf_a)

    # User B (fresh session on the same client) must not see A's row under the
    # same credential id - the row is keyed (user_id, credential_id).
    quon_client.cookies.clear()
    make_active_user(quon_client, "b@quon.local", auth_token=b"C" * 32)
    assert quon_client.get("/auth/bio", params={"credential_id": CRED}).status_code == 404


def test_requires_session(quon_client):
    r = quon_client.get("/auth/bio", params={"credential_id": CRED})
    assert r.status_code == 401
    r = quon_client.put("/auth/bio", json=bio_body(), headers={"X-QUON-CSRF": "x"})
    assert r.status_code in (401, 403)


def test_size_validation(quon_client):
    csrf = make_active_user(quon_client, "bio@quon.local")
    # prf_salt must be exactly 32 bytes.
    r = quon_client.put("/auth/bio", json=bio_body(salt=b"P" * 16), headers=csrf)
    assert r.status_code == 422
    # wrap_bio capped at 256 bytes and must be non-empty.
    r = quon_client.put("/auth/bio", json=bio_body(wrap=b"B" * 257), headers=csrf)
    assert r.status_code == 422
    r = quon_client.put("/auth/bio", json=bio_body(wrap=b""), headers=csrf)
    assert r.status_code == 422


def test_enrollment_cap(quon_client):
    csrf = make_active_user(quon_client, "bio@quon.local")
    for i in range(10):
        r = quon_client.put("/auth/bio", json=bio_body(cred=f"cred-{i}"), headers=csrf)
        assert r.status_code == 200
    # 11th distinct credential is refused...
    r = quon_client.put("/auth/bio", json=bio_body(cred="cred-10"), headers=csrf)
    assert r.status_code == 409
    # ...but re-enrolling an existing one still works (upsert, not a new row).
    r = quon_client.put("/auth/bio", json=bio_body(cred="cred-3"), headers=csrf)
    assert r.status_code == 200


def test_get_bumps_last_used_at(quon_client):
    import db

    csrf = make_active_user(quon_client, "bio@quon.local")
    quon_client.put("/auth/bio", json=bio_body(), headers=csrf)
    with db.get_conn() as c:
        before = c.execute("SELECT last_used_at FROM user_bio_keys").fetchone()[0]
    assert before is None
    quon_client.get("/auth/bio", params={"credential_id": CRED})
    with db.get_conn() as c:
        after = c.execute("SELECT last_used_at FROM user_bio_keys").fetchone()[0]
    assert isinstance(after, int)
