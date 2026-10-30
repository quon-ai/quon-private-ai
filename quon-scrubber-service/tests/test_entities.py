"""Entity-type registry (entities.py) — the single source of truth.

Guards three things: (1) the derived LLM prompt stays byte-identical to the
wording the detection corpus was evaluated with (a contribution may ADD types,
never silently rewrite existing lines), (2) the derived views stay consistent,
(3) cross-tier drift: every catalog type must have a presentation style in the
frontend (src/lib/quonEntityStyles.ts)."""

from __future__ import annotations

import re
from pathlib import Path

import entities

# The exact prompt the corpus/ratchet was measured against (pre-registry
# literal). If you intentionally change a hint, re-run the corpus eval and
# update this golden alongside — never let it drift silently.
GOLDEN_SYSTEM_PROMPT = """You are a PII (Personally Identifiable Information)
detection engine. Your only job is to find PII in text
and return a JSON array.

You must find:
- PERSON: Full names, first names when clearly a person
- EMAIL: Any email address
- PHONE: Phone numbers, fax numbers, any format
- IBAN: Bank account numbers (any country format)
- ROUTING: Bank routing/sort codes
- FINANCIAL_AMOUNT: Money with currency symbol or word
- DATE: Specific calendar dates only (e.g. "15.03.2025", "March 3, 2025",
  "3. März"). NOT durations/time-spans and NOT relative dates.
- PIN: PINs, passwords, access codes, dial-in codes
- INTERNAL_URL: Internal system URLs, API endpoints
  (NOT public websites like google.com)
- CREDENTIAL: Usernames, license keys, SSH keys,
  system credentials
- TAX_ID: Tax numbers, VAT IDs, social security numbers
- INSURANCE_ID: Health insurance numbers, policy numbers"""


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
