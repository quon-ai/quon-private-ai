"""Shared helpers for the QUON evaluation corpus and quality-suite grading.

Normalises legacy string tokens and explicit ``{value, type}`` specs, infers
entity types for untyped tokens, and defines the policy taxonomy used to split
strict-private vs public-content metrics in reports.
"""

from __future__ import annotations

import re
from typing import Literal, TypedDict

Policy = Literal["strict_private", "public_ok", "amount_debate", "unmarked_secret"]
#: "unmarked_secret" - a secret that carries no marker of being one: no vendor
#: prefix ("sk-...", "ghp_...", "AKIA..."), no NAME=value assignment, nothing but a
#: high-entropy string sitting in a sentence. Declared out of scope, and the
#: reasoning is about the data, not about our detector:
#: "P@ss5248word" is not distinguishable from a product code, an order reference
#: or a model name without a marker, so any rule that caught it would be guessing,
#: and would fire on ordinary text. A MARKED secret stays fully in scope and is
#: measured normally. Reported separately rather than deleted, so the boundary is
#: always visible and can be revisited.
DEFAULT_POLICY: Policy = "strict_private"

# Token input: plain string (legacy) or explicit typed dict.
TokenInput = str | dict[str, str]


class NormalizedToken(TypedDict):
    value: str
    type: str


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PHONE_RE = re.compile(r"^[\d\s()+\-./]+$")
_IBAN_RE = re.compile(r"^(?:IBAN\s+)?[A-Z]{2}\d{2}[\s\d]+$", re.I)
_ROUTING_RE = re.compile(r"^\d{9}$")
_CREDIT_CARD_RE = re.compile(r"^\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}$")
_URL_RE = re.compile(r"^https?://", re.I)
_INTERNAL_URL_RE = re.compile(r"\.(intern|internal|local)(?:\.[a-z]+)?/", re.I)
_INSURANCE_RE = re.compile(r"^(?:VN-|KV-|BCB-|MRN\s|A\d{3})", re.I)
_TAX_ID_RE = re.compile(r"^\d{2}[\s/\-]?\d{3}[\s/\-]?\d{3}[\s/\-]?\d{3}$|^\d{3}-\d{2}-\d{4}$")
_PIN_RE = re.compile(r"^\d{4,8}$")
_CREDENTIAL_RE = re.compile(r"[!@#$%^&*]|^sk-[a-z]|^test-key|^P@ss|^Xy#|^API_KEY", re.I)
_AMOUNT_RE = re.compile(
    r"[€$£]|(?:\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?)\s*(?:€|\$|£|EUR|USD|GBP|CHF|Mio|Million|billion)",
    re.I,
)
_DATE_RE = re.compile(
    r"\d{1,2}[\./]\d{1,2}[\./]\d{2,4}|"
    r"(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|"
    r"January|February|March|April|May|June|July|August|September|October|November|December|"
    r"Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
    r"[\s\d,]*\d{0,4}",
    re.I,
)


def infer_entity_type(value: str) -> str:
    """Best-effort entity label for a ``must_anonymize`` token (legacy strings)."""
    v = value.strip()
    if not v:
        return "OTHER"
    if _EMAIL_RE.match(v):
        return "EMAIL"
    if _URL_RE.search(v) or _INTERNAL_URL_RE.search(v):
        return "URL"
    if _IBAN_RE.match(v) or (v.upper().startswith(("DE", "GB")) and any(c.isdigit() for c in v)):
        if len(re.sub(r"\s", "", v)) >= 15:
            return "IBAN"
    if _ROUTING_RE.match(re.sub(r"\s", "", v)):
        return "ROUTING"
    if _CREDIT_CARD_RE.match(re.sub(r"\s", "", v)):
        return "CREDIT_CARD"
    if _INSURANCE_RE.match(v):
        return "INSURANCE_ID"
    if _TAX_ID_RE.match(v) or "SSN" in v.upper():
        return "TAX_ID"
    if _CREDENTIAL_RE.search(v):
        return "CREDENTIAL"
    if _PIN_RE.match(v) and len(v) <= 8:
        return "PIN"
    if _PHONE_RE.match(v) and sum(c.isdigit() for c in v) >= 6:
        return "PHONE"
    if _AMOUNT_RE.search(v):
        return "AMOUNT"
    if _DATE_RE.search(v):
        return "DATE"
    return "PERSON"


def normalize_tokens(items: list[TokenInput]) -> list[NormalizedToken]:
    """Unify string and ``{value, type}`` token specs."""
    out: list[NormalizedToken] = []
    for item in items:
        if isinstance(item, str):
            out.append({"value": item, "type": infer_entity_type(item)})
        else:
            value = item["value"].strip()
            etype = item.get("type") or infer_entity_type(value)
            out.append({"value": value, "type": etype})
    return out


def token_values(items: list[TokenInput]) -> list[str]:
    """Plain value list for substring grading (backward compatible)."""
    return [t["value"] for t in normalize_tokens(items)]
