"""Account-bound UI language: register-time capture, /auth/me exposure, the
PUT /auth/ui-language endpoint, and email-language selection."""

from conftest import make_active_user, register_body


def test_me_defaults_null_language(quon_client):
    make_active_user(quon_client, "lang@quon.local")
    assert quon_client.get("/auth/me").json()["ui_language"] is None


def test_register_captures_language_and_me_returns_it(quon_client):
    body = register_body("de-user@quon.local")
    body["language"] = "de"
    quon_client.post("/auth/register", json=body)
    token = quon_client.captured["de-user@quon.local"]
    quon_client.post("/auth/verify", json={"token": token})
    assert quon_client.get("/auth/me").json()["ui_language"] == "de"


def test_put_ui_language_roundtrip(quon_client):
    csrf = make_active_user(quon_client, "lang@quon.local")
    r = quon_client.put("/auth/ui-language", json={"language": "en"}, headers=csrf)
    assert r.status_code == 200 and r.json()["language"] == "en"
    assert quon_client.get("/auth/me").json()["ui_language"] == "en"
    # switch back
    quon_client.put("/auth/ui-language", json={"language": "de"}, headers=csrf)
    assert quon_client.get("/auth/me").json()["ui_language"] == "de"


def test_put_rejects_bad_language(quon_client):
    csrf = make_active_user(quon_client, "lang@quon.local")
    assert quon_client.put("/auth/ui-language", json={"language": "fr"}, headers=csrf).status_code == 422


def test_put_requires_session(quon_client):
    assert quon_client.put("/auth/ui-language", json={"language": "en"}).status_code in (401, 403)


def test_login_returns_language(quon_client):
    body = register_body("en-user@quon.local", auth_token=b"E" * 32)
    body["language"] = "en"
    quon_client.post("/auth/register", json=body)
    quon_client.post("/auth/verify", json={"token": quon_client.captured["en-user@quon.local"]})
    quon_client.cookies.clear()
    from conftest import b64

    r = quon_client.post(
        "/auth/login", json={"email": "en-user@quon.local", "auth_token": b64(b"E" * 32)}
    )
    assert r.status_code == 200 and r.json()["user"]["ui_language"] == "en"


def test_verification_email_language_flows_from_register(quon_client):
    body = register_body("de-mail@quon.local")
    body["language"] = "de"
    quon_client.post("/auth/register", json=body)
    # The register→_issue_email_token→send_verification chain forwards the chosen
    # language (conftest records the lang arg the send received).
    assert quon_client.captured_lang["de-mail@quon.local"] == "de"


def test_email_templates_are_bilingual():
    """send_verification picks the DE vs EN subject; unknown → German default."""
    import email_service

    sent: list = []
    orig = email_service._send
    email_service._send = lambda to, subject, text: sent.append(subject)
    try:
        email_service.send_verification("x@y.z", "tok", "en")
        email_service.send_verification("x@y.z", "tok", "de")
        email_service.send_verification("x@y.z", "tok", None)
    finally:
        email_service._send = orig
    assert sent[0] == "Verify your QUON account"
    assert sent[1] == "Bestätige dein QUON-Konto"
    assert sent[2] == "Bestätige dein QUON-Konto"  # None → German default
