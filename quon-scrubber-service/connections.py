"""Chat provider connections.

The built-in **OpenRouter** connection (billed per-user via provisioned sub-keys,
or the global key for self-host) plus any number of user-added **OpenAI-compatible**
BYOK providers (OpenAI, Anthropic's OpenAI-compat endpoint, Groq, Together, local
Ollama/LM-Studio, …). This module decides which models are offered to the client
and resolves each chat to the right ``(base_url, api_key)``.

Keys live server-side only (the runtime store / per-user sub-keys) and are never
returned to the browser — the same trust model as the existing OpenRouter key.
"""

from __future__ import annotations

import re

import key_resolver
import region
import settings_store
import user_connections
from config import settings
from models import ChatModelInfo, ConnectionInfo

OPENROUTER_ID = "openrouter"

# OpenRouter models exposed until the user picks from the catalog.
# Order matters: the client's model-validity fallback picks the FIRST enabled
# entry, so the intended default (Sonnet) must lead. "~vendor/…-latest" are
# OpenRouter's floating latest-aliases — the catalog stays current without
# per-release edits.
_DEFAULT_OPENROUTER_MODELS = [
    "~anthropic/claude-sonnet-latest",
    "~anthropic/claude-opus-latest",
    "~google/gemini-flash-latest",
    "mistralai/mistral-large",
    "~openai/gpt-latest",
    "openrouter/fusion",
    # Image generation (#79): a cheap image-output model in the default
    # catalog. NB: a live box's runtime_settings.json overrides this list —
    # adding it there (Settings → models) is a deploy step, not automatic.
    "google/gemini-2.5-flash-image",
]


def is_image_output_slug(slug: str) -> bool:
    """OpenRouter's image-output models follow one naming convention
    (`…-image`, `…-image-preview`, `…-image-mini`, `…-image-2`); the public
    catalog confirms it (architecture.output_modalities ∋ "image"). The name
    rule is what the client can rely on offline, so it is the source of truth
    here — a wrong positive only costs a `modalities` field the model ignores."""
    return bool(re.search(r"(^|/)[^/]*-image(-|$)", slug.lstrip("~")))


def _openrouter_models() -> list[str]:
    return settings_store.get_openrouter_models() or _DEFAULT_OPENROUTER_MODELS


def openrouter_slugs() -> list[str]:
    """The OpenRouter catalog as configured (runtime override, else default)."""
    return list(_openrouter_models())


def list_connections(user_id: str | None = None) -> list[ConnectionInfo]:
    """All connections visible to ``user_id``, secrets stripped (for GET /settings).

    Global connections (OpenRouter + operator-configured customs) plus, when a
    user is given, that user's own BYOK connections.
    """
    out = [
        ConnectionInfo(
            id=OPENROUTER_ID,
            label="OpenRouter",
            kind="openrouter",
            base_url=settings.openrouter_base_url,
            models=_openrouter_models(),
            key_configured=settings_store.is_configured(),
            builtin=True,
            owner="global",
        )
    ]
    for c in settings_store.get_custom_connections():
        out.append(
            ConnectionInfo(
                id=c["id"],
                label=c.get("label") or c["id"],
                kind="openai",
                base_url=c.get("base_url", ""),
                models=c.get("models", []),
                key_configured=bool(c.get("api_key")),
                builtin=False,
                owner="global",
            )
        )
    if user_id:
        for c in user_connections.list_for_user(user_id):
            out.append(
                ConnectionInfo(
                    id=c["id"],
                    label=c["label"],
                    kind="openai",
                    base_url=c["base_url"],
                    models=c["models"],
                    key_configured=c["key_configured"],
                    builtin=False,
                    owner="user",
                )
            )
    return out


def chat_catalog(user_id: str | None = None) -> list[ChatModelInfo]:
    """Flat model list for the client dropdown — union across all connections.
    Models the user has disabled (their own list, else the global default) are
    marked disabled."""
    import user_settings

    disabled_ids = user_settings.resolve_disabled_ids(user_id)
    out: list[ChatModelInfo] = []
    for conn in list_connections(user_id):
        for slug in conn.models:
            # Strict EU routing: a model the EU domain does not serve is not
            # offered at all (region.py). Unknown stays visible — the request
            # fails closed upstream, with a worded error.
            if conn.id == OPENROUTER_ID and region.available(slug) is False:
                continue
            label = slug if conn.id == OPENROUTER_ID else f"{slug} · {conn.label}"
            mid = f"{conn.id}::{slug}"
            out.append(
                ChatModelInfo(
                    id=mid,
                    label=label,
                    connection_id=conn.id,
                    model=slug,
                    disabled=not conn.key_configured or mid in disabled_ids or slug in disabled_ids,
                    image_output=is_image_output_slug(slug),
                )
            )
    return out


def resolve_for_chat(connection_id: str | None, user_id: str | None) -> tuple[str, str] | None:
    """``(base_url, api_key)`` for a chat request, or None if unusable.

    OpenRouter uses the per-user resolved key (provisioned sub-key, or global for
    self-host); a custom connection uses its own stored key.
    """
    cid = connection_id or OPENROUTER_ID
    if cid == OPENROUTER_ID:
        key = key_resolver.resolve_openrouter_key(user_id)
        return (settings.openrouter_base_url, key) if key else None
    # The user's own BYOK connection wins over a global custom of the same id.
    if user_id:
        resolved = user_connections.resolve_key(user_id, cid)
        if resolved:
            return resolved
    conn = settings_store.get_custom_connection(cid)
    if not conn:
        return None
    base_url, key = conn.get("base_url"), conn.get("api_key")
    return (base_url, key) if (base_url and key) else None


def resolve_catalog(connection_id: str | None, user_id: str | None) -> tuple[str, str] | None:
    """``(base_url, api_key)`` for a catalog (/models) listing. OpenRouter uses the
    GLOBAL key; a custom connection uses its own key (per-user first, then global)."""
    cid = connection_id or OPENROUTER_ID
    if cid == OPENROUTER_ID:
        key = settings_store.get_openrouter_key()
        return (settings.openrouter_base_url, key) if key else None
    if user_id:
        resolved = user_connections.resolve_key(user_id, cid)
        if resolved:
            return resolved
    conn = settings_store.get_custom_connection(cid)
    if not conn:
        return None
    base_url, key = conn.get("base_url"), conn.get("api_key")
    return (base_url, key) if (base_url and key) else None
