"""The scrub-only demo: POST /demo/scrub without an account.

Off by default (a self-hosted instance exposes nothing new), capped in length,
rate-limited per IP by the middleware and process-wide by the endpoint itself,
and reported by /health so the page can say whether it exists.
"""

from __future__ import annotations

import ratelimit
from config import settings

TEXT = "Bitte schreib an jana.beispiel@example.org, IBAN DE89 3704 0044 0532 0130 00."


def test_demo_is_off_by_default(quon_client):
    assert settings.demo_scrub_enabled is False
    assert quon_client.post("/demo/scrub", json={"text": TEXT}).status_code == 404


def test_demo_scrubs_without_a_session(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "demo_scrub_enabled", True)
    r = quon_client.post("/demo/scrub", json={"text": TEXT, "language_hint": "de"})
    assert r.status_code == 200
    body = r.json()
    assert "jana.beispiel@example.org" not in body["scrubbed"]
    assert "[EMAIL_1]" in body["scrubbed"]
    types = {e["type"] for e in body["entities"]}
    assert {"EMAIL", "IBAN"} <= types


def test_demo_caps_the_length(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "demo_scrub_enabled", True)
    monkeypatch.setattr(settings, "demo_scrub_max_chars", 50)
    assert quon_client.post("/demo/scrub", json={"text": "x" * 51}).status_code == 413
    assert quon_client.post("/demo/scrub", json={"text": "x" * 50}).status_code == 200


def test_demo_is_rate_limited_per_ip(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "demo_scrub_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(ratelimit, "_RULES", [("/demo/scrub", 2, 60)])
    monkeypatch.setattr(ratelimit, "_limiter", ratelimit._FixedWindow())
    codes = [quon_client.post("/demo/scrub", json={"text": "hallo"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]


def test_demo_has_a_process_wide_ceiling(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "demo_scrub_enabled", True)
    monkeypatch.setattr(settings, "demo_scrub_global_per_minute", 1)
    monkeypatch.setattr(ratelimit, "_global", ratelimit._FixedWindow())
    assert quon_client.post("/demo/scrub", json={"text": "hallo"}).status_code == 200
    assert quon_client.post("/demo/scrub", json={"text": "hallo"}).status_code == 503


def test_health_reports_the_demo(quon_client, monkeypatch):
    monkeypatch.setattr(settings, "demo_scrub_enabled", True)
    monkeypatch.setattr(settings, "demo_scrub_max_chars", 1234)
    monkeypatch.setattr(settings, "demo_contact_url", "https://example.org/waitlist")
    monkeypatch.setattr(settings, "demo_contact_email", "hello@example.org")
    h = quon_client.get("/health").json()
    assert h["demo_scrub_enabled"] is True
    assert h["demo_scrub_max_chars"] == 1234
    assert h["demo_contact_url"] == "https://example.org/waitlist"
    assert h["demo_contact_email"] == "hello@example.org"
