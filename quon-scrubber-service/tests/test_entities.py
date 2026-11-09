"""Entity-type registry (entities.py) - the single source of truth.

Guards two things: (1) the derived views stay consistent, (2) cross-tier
drift: every catalog type must have a presentation style in the frontend
(src/lib/quonEntityStyles.ts)."""

from __future__ import annotations

import re
from pathlib import Path

import entities

def test_placeholders_and_catalog_derive_from_the_same_table():
    types = [e["type"] for e in entities.ENTITY_TYPES]
    assert len(types) == len(set(types)), "duplicate entity type"
    assert set(entities.PLACEHOLDERS) == set(types)
    assert [c["type"] for c in entities.ENTITY_CATALOG] == types
    for c in entities.ENTITY_CATALOG:
        assert c["placeholder"] == entities.PLACEHOLDERS[c["type"]]
        assert c["description"]


def test_every_catalog_type_has_a_frontend_style():
    """Cross-tier drift guard: a new entity type without a color/label in
    quonEntityStyles.ts would render unstyled in the chat legend."""
    styles_ts = (
        Path(__file__).resolve().parents[2] / "src" / "lib" / "quonEntityStyles.ts"
    ).read_text("utf-8")
    style_keys = set(re.findall(r"^\s{2}([A-Z_]+):\s*\{", styles_ts, re.MULTILINE))
    missing = {e["type"] for e in entities.ENTITY_TYPES} - style_keys
    assert not missing, f"entity types without a frontend style: {sorted(missing)}"
