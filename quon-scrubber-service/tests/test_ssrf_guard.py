"""SSRF guard for provider base_urls (net_guard.validate_public_url)."""

from __future__ import annotations

import pytest

from config import settings
from net_guard import UnsafeUrlError, validate_public_url


@pytest.fixture(autouse=True)
def _guard_on(monkeypatch):
    monkeypatch.setattr(settings, "allow_private_provider_urls", False)


@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/v1",  # loopback
        "https://[::1]/v1",  # IPv6 loopback
        "https://169.254.169.254/latest/meta-data",  # cloud metadata
        "https://10.0.0.5/v1",  # RFC1918
        "https://192.168.1.10/v1",  # RFC1918
        "https://0.0.0.0/v1",  # unspecified
    ],
)
def test_blocks_internal_hosts(url):
    with pytest.raises(UnsafeUrlError):
        validate_public_url(url)


def test_blocks_non_https_and_empty():
    with pytest.raises(UnsafeUrlError):
        validate_public_url("http://93.184.216.34/v1")  # public IP but plaintext http
    with pytest.raises(UnsafeUrlError):
        validate_public_url("")


def test_allows_public_https():
    # public IP literal -> no DNS, no raise
    validate_public_url("https://93.184.216.34/v1")


def test_opt_out_disables_guard(monkeypatch):
    monkeypatch.setattr(settings, "allow_private_provider_urls", True)
    validate_public_url("http://127.0.0.1:11434/v1")  # self-host opt-out -> allowed


def test_connection_store_rejects_internal_url():
    """The guard fires at the store layer (before any persistence)."""
    import settings_store

    with pytest.raises(UnsafeUrlError):
        settings_store.upsert_custom_connection(
            "c1", label="x", base_url="https://169.254.169.254/v1", models=[], api_key="k"
        )


def test_relay_revalidates_byok_url_at_request_time(monkeypatch):
    """chat_complete must re-validate a user (BYOK) base_url on every call so a
    host rebound to loopback after save fails closed as a 400, not an SSRF POST."""
    import asyncio

    import provider
    import settings_store
    from models import ChatTurn

    monkeypatch.setattr(settings_store, "get_openrouter_key", lambda: "k")
    with pytest.raises(provider.ProviderError) as exc:
        asyncio.run(
            provider.chat_complete(
                "some/model",
                [ChatTurn(role="user", content="hi")],
                base_url="https://169.254.169.254/v1",
            )
        )
    assert exc.value.status == 400


# --- operator allow-list (PROVIDER_PRIVATE_HOST_ALLOWLIST) -----------------
# The narrow alternative to switching the guard off wholesale: one self-hosted
# PII endpoint inside the VPC is reachable, every other private target stays
# blocked. The negative cases below are the point - an allow-list that leaks
# past its own entries is worse than none, because it reads as protection.
def _allow(monkeypatch, value):
    monkeypatch.setattr(settings, "provider_private_host_allowlist", value)


def test_allowlisted_host_may_resolve_private(monkeypatch):
    _allow(monkeypatch, "pii.internal.example")
    monkeypatch.setattr(
        "net_guard.socket.getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("10.0.3.14", 443))],
    )
    validate_public_url("https://pii.internal.example/v1")


def test_allowlist_does_not_leak_to_other_private_hosts(monkeypatch):
    """The entry exempts that hostname, not private addressing in general."""
    _allow(monkeypatch, "pii.internal.example")
    with pytest.raises(UnsafeUrlError):
        validate_public_url("https://169.254.169.254/latest/meta-data")
    with pytest.raises(UnsafeUrlError):
        validate_public_url("https://10.0.0.5/v1")


def test_allowlist_is_exact_not_suffix(monkeypatch):
    """No wildcards: an attacker-registered `evil-pii.internal.example` or a
    subdomain of an entry must not inherit the exemption."""
    _allow(monkeypatch, "pii.internal.example")
    monkeypatch.setattr(
        "net_guard.socket.getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("10.0.3.14", 443))],
    )
    for host in ("evil-pii.internal.example", "sub.pii.internal.example"):
        with pytest.raises(UnsafeUrlError):
            validate_public_url(f"https://{host}/v1")


def test_allowlist_still_requires_https(monkeypatch):
    _allow(monkeypatch, "pii.internal.example")
    with pytest.raises(UnsafeUrlError):
        validate_public_url("http://pii.internal.example/v1")


def test_allowlist_still_requires_the_host_to_resolve(monkeypatch):
    """A typo'd entry must fail loudly rather than silently pass the check."""
    _allow(monkeypatch, "pii.internal.example")
    def _boom(*a, **k):
        raise OSError("NXDOMAIN")
    monkeypatch.setattr("net_guard.socket.getaddrinfo", _boom)
    with pytest.raises(UnsafeUrlError):
        validate_public_url("https://pii.internal.example/v1")


def test_allowlist_parsing_is_forgiving_of_spacing_and_case(monkeypatch):
    _allow(monkeypatch, " PII.Internal.Example ,, other.host ")
    monkeypatch.setattr(
        "net_guard.socket.getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("10.0.3.14", 443))],
    )
    validate_public_url("https://pii.internal.example/v1")
    validate_public_url("https://other.host/v1")


def test_empty_allowlist_changes_nothing(monkeypatch):
    _allow(monkeypatch, "")
    with pytest.raises(UnsafeUrlError):
        validate_public_url("https://10.0.0.5/v1")
