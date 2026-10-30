"""SSRF guard for user/operator-supplied provider URLs (BYOK ``base_url``).

A connection's ``base_url`` is attacker-influenced (per-user BYOK connections and
global custom connections). Without validation the server could be coerced into
requesting internal addresses — cloud metadata (169.254.169.254), loopback, or
RFC1918 hosts — i.e. SSRF, and *non-blind* via the catalog endpoint which returns
the upstream response body. We require ``https`` and reject any host that resolves
to a private / loopback / link-local / reserved / multicast address.

Set ``ALLOW_PRIVATE_PROVIDER_URLS=true`` to disable the guard for a self-hosted
deployment that points at a local provider (e.g. ``http://localhost:11434``).

Prefer ``PROVIDER_PRIVATE_HOST_ALLOWLIST`` over that switch when the goal is one
known internal endpoint (a self-hosted PII model in our own VPC): it exempts only
the hostnames the OPERATOR named, while every user-supplied BYOK url keeps the
full guard. The blanket switch would also unblock those — and a BYOK url pointed
at 169.254.169.254 on EC2 reads instance credentials.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from config import settings


class UnsafeUrlError(ValueError):
    """A provider URL is malformed or resolves to a non-public host."""


def _is_public(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def _allowlisted_hosts() -> set[str]:
    """Operator-configured hostnames exempt from the private-address check."""
    raw = settings.provider_private_host_allowlist or ""
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def validate_public_url(url: str) -> None:
    """Raise :class:`UnsafeUrlError` unless ``url`` is an ``https`` URL whose host
    resolves *only* to public IP addresses. No-op when the operator has opted into
    private provider URLs (self-host)."""
    if settings.allow_private_provider_urls:
        return
    candidate = (url or "").strip()
    if not candidate:
        raise UnsafeUrlError("Provider URL is empty.")
    parsed = urlparse(candidate)
    if parsed.scheme != "https":
        raise UnsafeUrlError("Provider URL must use https://.")
    host = parsed.hostname
    if not host:
        raise UnsafeUrlError("Provider URL has no host.")
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise UnsafeUrlError(f"Provider host does not resolve ({host}).") from exc
    ips = {info[4][0] for info in infos}
    if not ips:
        raise UnsafeUrlError(f"Provider host does not resolve ({host}).")
    # Named by the operator → may point inside the VPC. Everything else about the
    # check still applies, so a typo'd or dead host still fails loudly.
    if host.lower() in _allowlisted_hosts():
        return
    for ip in ips:
        if not _is_public(ip):
            raise UnsafeUrlError(
                "Provider URL must point to a public host — private, loopback and "
                "cloud-metadata addresses are blocked."
            )
