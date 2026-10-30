"""Single source of truth for QUON's PII entity types.

Contributing a NEW entity type touches exactly three places:
  1. ONE entry in ``ENTITY_TYPES`` below (placeholder + catalog description +
     optional ``llm_hint`` for the cloud-extraction prompt),
  2. a detector — an NER mapping (`ner._PRESIDIO_TO_QUON`), a safety-net
     recognizer/regex (`fallback.py`), and/or the ``llm_hint``,
  3. a frontend style in ``src/lib/quonEntityStyles.ts`` (label key + colors) —
     ``tests/test_entities.py`` fails if a catalog type has no style there.

``PLACEHOLDERS``, the ``GET /entities`` catalog and the LLM prompt's entity
list all DERIVE from this table, so the previously-scattered definitions can
no longer drift. The derived LLM prompt is golden-tested byte-for-byte against
the wording the detection corpus was evaluated with — extending the table adds
lines, it never rewrites existing ones.

``llm_hint`` may span lines; continuation lines must start with two spaces
(matching the prompt's hanging indent). ``None`` = the type is not requested
from the LLM (e.g. CUSTOM, which is the client-side always-redact list).
"""

from __future__ import annotations

ENTITY_TYPES: list[dict[str, str | None]] = [
    {
        "type": "PERSON",
        "placeholder": "[PERSON]",
        "description": "Full or first names of people",
        "llm_hint": "Full names, first names when clearly a person",
    },
    {
        "type": "EMAIL",
        "placeholder": "[EMAIL]",
        "description": "Email addresses",
        "llm_hint": "Any email address",
    },
    {
        "type": "PHONE",
        "placeholder": "[TELEFON]",
        "description": "Phone and fax numbers, any format",
        "llm_hint": "Phone numbers, fax numbers, any format",
    },
    {
        "type": "IBAN",
        "placeholder": "[IBAN]",
        "description": "Bank account numbers (any country)",
        "llm_hint": "Bank account numbers (any country format)",
    },
    {
        "type": "ROUTING",
        "placeholder": "[ROUTING-NR]",
        "description": "Bank routing / sort codes",
        "llm_hint": "Bank routing/sort codes",
    },
    {
        "type": "FINANCIAL_AMOUNT",
        "placeholder": "[BETRAG]",
        "description": "Money amounts with currency",
        "llm_hint": "Money with currency symbol or word",
    },
    {
        "type": "DATE",
        "placeholder": "[DATUM]",
        "description": "Specific dates and deadlines",
        "llm_hint": 'Specific calendar dates only (e.g. "15.03.2025", "March 3, 2025",\n'
        '  "3. März"). NOT durations/time-spans and NOT relative dates.',
    },
    {
        "type": "PIN",
        "placeholder": "[PIN]",
        "description": "PINs, passwords, access / dial-in codes",
        "llm_hint": "PINs, passwords, access codes, dial-in codes",
    },
    {
        "type": "INTERNAL_URL",
        "placeholder": "[INTERN-URL]",
        "description": "Internal URLs and API endpoints",
        "llm_hint": "Internal system URLs, API endpoints\n  (NOT public websites like google.com)",
    },
    {
        "type": "CREDENTIAL",
        "placeholder": "[ZUGANGSDATEN]",
        "description": "Usernames, license / SSH keys, credentials",
        "llm_hint": "Usernames, license keys, SSH keys,\n  system credentials",
    },
    {
        "type": "TAX_ID",
        "placeholder": "[STEUER-ID]",
        "description": "Tax numbers, VAT IDs, social security numbers",
        "llm_hint": "Tax numbers, VAT IDs, social security numbers",
    },
    {
        "type": "INSURANCE_ID",
        "placeholder": "[VERSICHERUNGS-ID]",
        "description": "Health insurance / policy numbers",
        "llm_hint": "Health insurance numbers, policy numbers",
    },
    {
        "type": "ADDRESS",
        "placeholder": "[ADRESSE]",
        "description": "Street addresses (street + house number, postal code + city)",
        "llm_hint": "Postal/street addresses: a street name with a house number\n"
        '  ("Bahnhofstraße 12", "Rehbergplatz 5a"), or a postal code with a city\n'
        '  ("12345 Berlin"). NOT a bare city or country on its own.',
    },
    {
        "type": "CUSTOM",
        "placeholder": "[GESCHÜTZT]",
        "description": "Words you marked to always redact on this device",
        "llm_hint": None,  # client-side always-redact list — never asked of the LLM
    },
]

# --- Derived views ----------------------------------------------------------

PLACEHOLDERS: dict[str, str] = {e["type"]: e["placeholder"] for e in ENTITY_TYPES}  # type: ignore[misc]

# Served by GET /entities (drives the frontend legend).
ENTITY_CATALOG: list[dict[str, str]] = [
    {"type": e["type"], "placeholder": e["placeholder"], "description": e["description"]}  # type: ignore[dict-item]
    for e in ENTITY_TYPES
]


def llm_entity_lines() -> str:
    """The "You must find" bullet list of the LLM extraction prompt, derived
    from the table (types with an ``llm_hint`` only)."""
    return "\n".join(f"- {e['type']}: {e['llm_hint']}" for e in ENTITY_TYPES if e["llm_hint"])
