"""Single source of truth for QUON's PII entity types.

Contributing a NEW entity type touches exactly three places:
  1. ONE entry in ``ENTITY_TYPES`` below (placeholder + catalog description),
  2. a detector — an NER mapping (`ner._PRESIDIO_TO_QUON`), a GLiNER label
     (`gliner_detect.py`) and/or a safety-net recognizer/regex (`fallback.py`),
  3. a frontend style in ``src/lib/quonEntityStyles.ts`` (label key + colors) —
     ``tests/test_entities.py`` fails if a catalog type has no style there.

``PLACEHOLDERS`` and the ``GET /entities`` catalog both DERIVE from this
table, so the previously-scattered definitions can no longer drift.
"""

from __future__ import annotations

ENTITY_TYPES: list[dict[str, str]] = [
    {
        "type": "PERSON",
        "placeholder": "[PERSON]",
        "description": "Full or first names of people",
    },
    {
        "type": "EMAIL",
        "placeholder": "[EMAIL]",
        "description": "Email addresses",
    },
    {
        "type": "PHONE",
        "placeholder": "[TELEFON]",
        "description": "Phone and fax numbers, any format",
    },
    {
        "type": "IBAN",
        "placeholder": "[IBAN]",
        "description": "Bank account numbers (any country)",
    },
    {
        "type": "ROUTING",
        "placeholder": "[ROUTING-NR]",
        "description": "Bank routing / sort codes",
    },
    {
        "type": "FINANCIAL_AMOUNT",
        "placeholder": "[BETRAG]",
        "description": "Money amounts with currency",
    },
    {
        "type": "DATE",
        "placeholder": "[DATUM]",
        "description": "Specific dates and deadlines",
    },
    {
        "type": "PIN",
        "placeholder": "[PIN]",
        "description": "PINs, passwords, access / dial-in codes",
    },
    {
        "type": "INTERNAL_URL",
        "placeholder": "[INTERN-URL]",
        "description": "Internal URLs and API endpoints",
    },
    {
        "type": "CREDENTIAL",
        "placeholder": "[ZUGANGSDATEN]",
        "description": "Usernames, license / SSH keys, credentials",
    },
    {
        "type": "TAX_ID",
        "placeholder": "[STEUER-ID]",
        "description": "Tax numbers, VAT IDs, social security numbers",
    },
    {
        "type": "INSURANCE_ID",
        "placeholder": "[VERSICHERUNGS-ID]",
        "description": "Health insurance / policy numbers",
    },
    {
        "type": "ADDRESS",
        "placeholder": "[ADRESSE]",
        "description": "Street addresses (street + house number, postal code + city)",
    },
    {
        "type": "CUSTOM",
        "placeholder": "[GESCHÜTZT]",
        "description": "Words you marked to always redact on this device",
    },
]

# --- Derived views ----------------------------------------------------------

PLACEHOLDERS: dict[str, str] = {e["type"]: e["placeholder"] for e in ENTITY_TYPES}

# Served by GET /entities (drives the frontend legend).
ENTITY_CATALOG: list[dict[str, str]] = [
    {"type": e["type"], "placeholder": e["placeholder"], "description": e["description"]}
    for e in ENTITY_TYPES
]
