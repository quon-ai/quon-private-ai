"""Resolve the effective OpenRouter key for an authenticated request.

* **Hosted** (provisioning enabled): strictly the user's provisioned sub-key - 
  no global fallback, so a user without a usable key fails closed.
* **Self-host / dev** (provisioning disabled): the single global key (``.env`` /
  runtime store) acts as BYOK for every user.

The resolved key is used both by the chat relay and by the cloud PII-extraction
path, so a user's scrubbing and chatting both bill their own $5 sub-key.
"""

from __future__ import annotations

import openrouter_provisioning as prov
import settings_store
import user_settings


def resolve_openrouter_key(user_id: str | None) -> str | None:
    # A user's own key override always wins (their choice, billed to them) - for
    # both the chat relay and the cloud PII path.
    own = user_settings.get_openrouter_key(user_id) if user_id else None
    if own:
        return own
    if prov.is_enabled():
        return prov.get_user_key_secret(user_id) if user_id else None
    return settings_store.get_openrouter_key() or None
