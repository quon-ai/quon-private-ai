"""Email transport selection: implicit TLS (465) vs STARTTLS (587) vs dev log.

No network: ``smtplib.SMTP_SSL`` / ``smtplib.SMTP`` are replaced with fakes that
record which transport was used and whether STARTTLS/login/send ran.
"""

from __future__ import annotations

import email_service
from config import settings


class _FakeSMTPBase:
    last = None

    def __init__(self, *args, **kwargs):
        self.starttls_called = False
        self.logged_in = False
        self.sent = False
        type(self).last = self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.starttls_called = True

    def login(self, user, password):
        self.logged_in = True

    def send_message(self, msg):
        self.sent = True


class FakeSSL(_FakeSMTPBase):
    last = None


class FakePlain(_FakeSMTPBase):
    last = None


def _patch(monkeypatch):
    FakeSSL.last = None
    FakePlain.last = None
    monkeypatch.setattr(email_service.smtplib, "SMTP_SSL", FakeSSL)
    monkeypatch.setattr(email_service.smtplib, "SMTP", FakePlain)


def test_implicit_tls_on_port_465(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "smtp.mx.cloudflare.net")
    monkeypatch.setattr(settings, "smtp_port", 465)
    monkeypatch.setattr(settings, "smtp_ssl", False)  # auto-detected from port
    monkeypatch.setattr(settings, "smtp_user", "u")
    monkeypatch.setattr(settings, "smtp_password", "p")
    _patch(monkeypatch)

    email_service.send_verification("x@y.de", "tok")

    assert FakeSSL.last is not None and FakePlain.last is None
    assert FakeSSL.last.starttls_called is False  # implicit TLS — no STARTTLS
    assert FakeSSL.last.logged_in and FakeSSL.last.sent


def test_starttls_on_port_587(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "smtp-relay.brevo.com")
    monkeypatch.setattr(settings, "smtp_port", 587)
    monkeypatch.setattr(settings, "smtp_ssl", False)
    monkeypatch.setattr(settings, "smtp_starttls", True)
    monkeypatch.setattr(settings, "smtp_user", "u")
    monkeypatch.setattr(settings, "smtp_password", "p")
    _patch(monkeypatch)

    email_service.send_verification("x@y.de", "tok")

    assert FakePlain.last is not None and FakeSSL.last is None
    assert FakePlain.last.starttls_called is True
    assert FakePlain.last.sent


def test_dev_mode_logs_without_host(monkeypatch):
    monkeypatch.setattr(settings, "smtp_host", "")
    _patch(monkeypatch)

    email_service.send_verification("x@y.de", "tok")

    assert FakeSSL.last is None and FakePlain.last is None  # nothing sent
