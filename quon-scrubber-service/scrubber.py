"""Core scrubbing logic: locate LLM/fallback entities and pseudonymize them.

The actual string replacement is delegated to Presidio Anonymizer, which is
used *only* for deterministic, position-based replacement (no detection).
"""

from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
import time

from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig, RecognizerResult

import fallback
import ner
from config import settings
from models import Entity, ScrubMetadata, ScrubOptions, ScrubResponse
from ner_gazetteer import INTERROGATIVES

logger = logging.getLogger("quon.scrubber")

# --- Placeholder mapping + catalog ---------------------------------------
# Single source of truth: entities.py (ENTITY_TYPES). Re-exported here so
# existing importers (main.py, tests) keep working. Contributing a new entity
# type: see entities.py's module docstring.
from entities import ENTITY_CATALOG, PLACEHOLDERS  # noqa: F401  (re-export)

_GENERIC_PLACEHOLDER = "[PII]"

# Short, underscore-free labels for the "indexed" style: [PERSON_1], [AMOUNT_2] …
# (kept regex-simple — [A-Z]+_\d+ — so the client can re-index and re-hydrate.)
INDEXED_LABELS: dict[str, str] = {
    "PERSON": "PERSON",
    "EMAIL": "EMAIL",
    "PHONE": "PHONE",
    "IBAN": "IBAN",
    "ROUTING": "ROUTING",
    "FINANCIAL_AMOUNT": "AMOUNT",
    "DATE": "DATE",
    "PIN": "PIN",
    "INTERNAL_URL": "URL",
    "CREDENTIAL": "CRED",
    "TAX_ID": "TAXID",
    "INSURANCE_ID": "INSID",
    "ADDRESS": "ADDR",
    "CUSTOM": "CUSTOM",
}

# German-language signal tokens for the lightweight "auto" language heuristic.
#
# The original list was skewed toward formal/business-email register ("sehr
# geehrte", "betreff", "gehalt", "rechnung", "vertrag"...) and scored 0 on an
# ordinary casual German QUESTION with no business vocabulary (e.g. "Welcher
# Supermarkt kommt an den Rehbergplatz in bad kleinfeld") -> detect_language
# fell through to its "de == 0 and en == 0 -> en" default -> the ENGLISH spaCy
# model ran on German text and mislabeled the unfamiliar capitalized compound
# "Rehbergplatz" as PERSON. Broadened below to cover conversational register:
# interrogatives (reusing ner_gazetteer.INTERROGATIVES, the same closed class
# used by the PERSON-guard fix in 657a605), case-inflected articles, common
# unambiguous conjugated verbs, conjunctions/adverbs, negation, and personal
# pronouns.
#
# Deliberately EXCLUDED even though they are valid German words: "an"/"in"/
# "um"/"am" (collide with the English indefinite article / common English
# words), "hat" (collides with the English noun "hat"), "also" (collides with
# the English adverb "also"), "war" (collides with the English noun "war"),
# and — from ner_gazetteer.INTERROGATIVES itself — "was" (collides with the
# English past tense of "be": "It was a great day" scored a false German hit
# until this was caught by the corpus eval's before/after diff on an
# unrelated TAX_ID slice, see test_detect_language_excluded_english_collision_
# words_not_added). Every word below was checked individually against a
# battery of neutral English sentences (see test_scrubber.py's casual-English
# regression battery) to confirm it does not fire on ordinary English prose.
_ENGLISH_COLLISION_INTERROGATIVES = frozenset({"was"})
_GERMAN_HINTS = re.compile(
    r"\b(der|die|das|den|dem|des|und|oder|nicht|mit|für|von|bei|wird|sind|"
    r"eine?n?|einem|einer|eines|"
    r"ich|bitte|sehr|geehrte[rn]?|freundlichen|grüßen|herr|frau|sie|ihre[rn]?|"
    r"betreff|kontakt|gehalt|betrag|rechnung|vertrag|"
    r"kommt|ist|kann|soll|muss|möchte|geht|macht|gibt|wäre|könnte|würde|hätte|"
    r"dass|wenn|weil|obwohl|auch|noch|schon|doch|aber|nur|immer|hier|dort|"
    r"jetzt|dann|kein|keine|keinen|nie|mich|dich|mir|dir|uns|euch|"
    # TRANSLITERATED register (2026-09-04): scraped web text and old exports
    # write ue/oe/ae/ss for umlauts and ß — "Ruhige Finca im Suedwesten ..."
    # carries plenty of German evidence, but the umlaut shortcut cannot see it
    # and none of the umlauted words above can match their ASCII forms, so the
    # whole page fell through to "de == 0 and en == 0 -> en" and the ENGLISH
    # model invented PERSONs out of capitalised German noun phrases (the
    # read_url E2E caught it). Two batches, every word individually vetted as
    # not-an-English-token like the rest of this list: the ASCII forms of words
    # already trusted above, plus casual calendar/quantity vocabulary that
    # umlaut-free listings and chat actually contain ("tag" is EXCLUDED — the
    # English word — only its plural forms are safe; "april"/"mai"/"august"/
    # "september"/"november" collide with English month spellings and stay
    # out).
    r"fuer|ueber|gruessen?|moechte|waere|koennte|wuerde|haette|muessen|"
    r"koennen|duerfen|grosse[rns]?|strasse|heisst|schoene?[rns]?|spaeter|"
    r"zurueck|natuerlich|"
    r"zwei|drei|vier|wochen?|monate?n?|jahren?|tagen?|frei|vor|nach|seit|"
    r"gegen|ohne|gerne|ganz|"
    r"montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|"
    r"januar|februar|maerz|juni|juli|oktober|dezember|"
    + "|".join(
        sorted(
            t.replace(" ", r"\s+")
            for t in INTERROGATIVES
            if t not in _ENGLISH_COLLISION_INTERROGATIVES
        )
    )
    + r")\b",
    re.IGNORECASE,
)
_UMLAUTS = re.compile(r"[äöüßÄÖÜ]")
# Broadened SYMMETRICALLY with _GERMAN_HINTS above (same casual-register fix,
# opposite direction): the original list was likewise formal/business-skewed, so
# a short casual ENGLISH sentence often scored 0 English hits — and once the
# German list gained words that double as English tokens ("den" the room, "Dann"
# as a name, "mir"/"Mir" the station), a 1-hit-each tie flipped such sentences to
# "de" (the tie-break favors German). The wrong-language model then MISSES real
# English names ("Kim and Dann met at noon" → de model → no entities → the names
# LEAK), which for a privacy gateway is worse than a false positive. Every word
# below is common casual English and NOT a German word ("will" is deliberately
# absent — "ich will" — as are "war"/"was"/"hat"/"also", which are excluded on
# the German side for the mirror-image reason).
_ENGLISH_HINTS = re.compile(
    r"\b(the|and|or|not|with|for|from|please|dear|best|regards|kind|"
    r"your|invoice|contract|amount|salary|email|phone|account|"
    r"my|is|are|you|we|they|he|she|this|that|what|which|where|when|who|how|"
    r"can|could|should|would|do|does|did|have|has|had|need|needs|want|"
    r"get|meet|met|know|think|about|there|here|just|now|today|tomorrow|"
    r"to|into|of|at|on)\b",
    re.IGNORECASE,
)


def placeholder_for(entity_type: str, style: str) -> str:
    if style == "generic":
        return _GENERIC_PLACEHOLDER
    return PLACEHOLDERS.get(entity_type, _GENERIC_PLACEHOLDER)


def detect_language(text: str, hint: str | None = None) -> str:
    """Cheap heuristic used only when ``options.language == "auto"``.

    ``hint`` (the client's UI/browser language, see ScrubOptions.language_hint)
    breaks ONLY the zero-evidence tie: bare noun queries ("Milchreis Rezept",
    "Airfryer Blumenkohl") contain no hint word in either language, and the old
    hardcoded "en" default routed such German queries through the ENGLISH spaCy
    model — the single biggest real-world PERSON-FP class (36% of FP-affected
    prompts in the 2026-07-08 review of the user's real chat history, 35/36 of
    which vanish under the correct model). Whenever the text itself carries any
    signal (umlauts or hint-word hits), the hint is ignored entirely.
    """
    if _UMLAUTS.search(text):
        return "de"
    de = len(_GERMAN_HINTS.findall(text))
    en = len(_ENGLISH_HINTS.findall(text))
    if de == 0 and en == 0:
        # Neutral / non-prose input: trust the client's locale if given.
        return hint if hint in ("de", "en") else "en"
    return "de" if de >= en else "en"


def _dedup_key(entity_type: str, value: str) -> str:
    """Normalized key so the SAME entity printed in different surface forms
    collapses to ONE placeholder.

    Only the merge KEY is normalized; the raw ``value`` is preserved for
    redaction, so every surface form is still found and removed from the text.
    Distinct entities always differ in their significant characters, so this can
    only ever merge true duplicates — it never conflates two different values.

    Motivating case: an IBAN printed spaced (``DE89 3704 …``) by one detector and
    unspaced (``DE89370400…``) by another would otherwise get ``[IBAN_1]`` and
    ``[IBAN_2]`` for the *same* account, misleading the model into treating them
    as two accounts.
    """
    v = value.strip().lower()
    if entity_type == "IBAN":
        return "".join(v.split())  # inter-group spacing in an IBAN is cosmetic
    if entity_type == "PHONE":
        # Drop cosmetic separators (spaces, hyphens, parens, dots); keep digits
        # and a leading +. Conservative: national vs international forms of one
        # number still differ (unchanged behaviour), but no two *different*
        # numbers can collide.
        return re.sub(r"[^\d+]", "", v)
    return v


def _merge(primary: list[dict], secondary: list[dict]) -> list[dict]:
    """Merge two ``{type, value, score}`` lists, de-duplicating by normalized
    (type, value) — see :func:`_dedup_key`.

    On a duplicate the higher-scoring entry wins. Used to combine the
    deterministic safety-net detections with the LLM's output.
    """
    merged: dict[tuple[str, str], dict] = {}
    for item in (*primary, *secondary):
        key = (item["type"], _dedup_key(item["type"], item["value"]))
        existing = merged.get(key)
        if existing is None or float(item.get("score", 0)) > float(existing.get("score", 0)):
            merged[key] = item
    return list(merged.values())


def _normalize_value(value: str) -> str:
    value = value.strip()
    # Strip a single layer of wrapping quotes the model sometimes adds.
    if len(value) >= 2 and value[0] in "\"'`" and value[-1] == value[0]:
        value = value[1:-1].strip()
    return value


def find_spans(text: str, value: str) -> list[tuple[int, int]]:
    """All case-insensitive occurrences of ``value`` in ``text``.

    Word boundaries are required only where ``value`` begins/ends with a word
    character, so emails, IBANs and ``+49…`` phone numbers still match while
    ``Marco`` does not match inside ``marco_abenteuer``.
    """
    value = _normalize_value(value)
    if not value:
        return []

    pattern = re.escape(value)
    if value[0].isalnum() or value[0] == "_":
        pattern = r"(?<!\w)" + pattern
    if value[-1].isalnum() or value[-1] == "_":
        pattern = pattern + r"(?!\w)"

    try:
        regex = re.compile(pattern, re.IGNORECASE | re.UNICODE)
    except re.error:
        return []
    return [(m.start(), m.end()) for m in regex.finditer(text)]


def pseudonymize(
    text: str,
    detected: list[dict],
    options: ScrubOptions,
) -> tuple[str, list[Entity]]:
    """Replace every located entity occurrence and build the entity report.

    ``detected`` is a list of ``{type, value, score}`` dicts. Returns the
    scrubbed text and a de-duplicated list of :class:`Entity` records.
    """
    results: list[RecognizerResult] = []
    operators: dict[str, OperatorConfig] = {}
    report: dict[tuple[str, str], Entity] = {}
    style = options.placeholder_style
    label_counter: dict[str, int] = {}
    # (type, value_lower) -> (placeholder, presidio entity_type used as op key)
    assigned: dict[tuple[str, str], tuple[str, str]] = {}

    for item in detected:
        etype = item["type"]
        value = _normalize_value(item["value"])
        if not value:
            continue
        spans = find_spans(text, value)
        if not spans:
            continue

        # 0.8 was llm_default_confidence; the field outlived the tier because
        # it was never about the LLM — it is the score a detection gets when
        # its source did not provide one.
        score = float(item.get("score", 0.8))
        key = (etype, value.lower())

        if key not in assigned:
            if style == "indexed":
                # Each distinct value gets its own numbered placeholder + operator.
                label = INDEXED_LABELS.get(etype, "PII")
                label_counter[label] = label_counter.get(label, 0) + 1
                placeholder = f"[{label}_{label_counter[label]}]"
                op_type = f"{label}_{label_counter[label]}"
            elif style == "generic":
                placeholder, op_type = _GENERIC_PLACEHOLDER, "PII"
            else:  # typed
                placeholder = PLACEHOLDERS.get(etype, _GENERIC_PLACEHOLDER)
                op_type = etype
            assigned[key] = (placeholder, op_type)
            operators.setdefault(op_type, OperatorConfig("replace", {"new_value": placeholder}))

        placeholder, op_type = assigned[key]
        for start, end in spans:
            results.append(RecognizerResult(entity_type=op_type, start=start, end=end, score=score))

        if key not in report:
            report[key] = Entity(
                type=etype,
                value=value,
                placeholder=placeholder,
                confidence=round(score, 2),
            )

    entities = list(report.values())
    if not results:
        return text, entities

    operators.setdefault("DEFAULT", OperatorConfig("replace", {"new_value": _GENERIC_PLACEHOLDER}))
    anonymized = AnonymizerEngine().anonymize(text=text, analyzer_results=results, operators=operators)
    return anonymized.text, entities


# A DATE value that is actually a relative duration / time-span ("3 Wochen",
# "für 2 Tage", "over 6 months") — not PII. Concrete calendar dates have
# separators or month names and do not match (no bare number+unit shape).
_DURATION_RE = re.compile(
    r"^(?:für|fuer|über|ueber|seit|in|ab|ca\.?|rund|etwa|for|over|about|within)?\s*"
    r"\d+\s*"
    r"(?:tag|tage|tagen|woche|wochen|monat|monate|monaten|jahr|jahre|jahren|"
    r"stunde|stunden|minute|minuten|sekunde|sekunden|"
    r"days?|weeks?|months?|years?|hours?|minutes?)\b\.?$",
    re.IGNORECASE,
)


def _is_relative_duration(value: str) -> bool:
    """True if a DATE value is a relative duration/time-span rather than a date."""
    return bool(_DURATION_RE.match(value.strip()))


# --- LLM CREDENTIAL / PIN / INTERNAL_URL sanity gates ----------------------
# Unlike PERSON/EMAIL above, these three entity types have NO NER or regex
# safety-net source at all (fallback.py only covers EMAIL/PHONE/IBAN/BETRAG) —
# they are LLM-only, so there is no NER-side guard to reuse; the gate has to
# live here, applied to whatever the LLM proposes, mirroring the EMAIL "@"
# check and the PERSON ner._keep_person reuse above.
#
# Real-world FP report (2026-08-08): QUON's own technical documentation
# (env-var names, architecture notes), pasted back into the scrubber, produced
# CREDENTIAL "OPENROUTER_API_KEY", "QUON_SERVER_SECRET", "COOKIE_SECURE" (bare
# identifier NAMES with no value attached), CREDENTIAL/PIN on phrases that
# merely NAME a secret concept ("OpenRouter API key", "Master Key in memory",
# "recovery phrase"), and INTERNAL_URL on localhost URLs, bare path fragments
# ("/api", "/sync") and even a model id ("gemma-3-12b-it") that isn't URL-
# shaped at all. A secret/URL detector must require actual value/host context,
# not just the LABEL of one — do NOT weaken this to also drop a real
# `KEY=value`/`KEY: value` pair or a real internal hostname.

# A bare SCREAMING_SNAKE_CASE identifier ("OPENROUTER_API_KEY") — the NAME of
# a secret, not a secret. A real `KEY=value`/`KEY: value` pair contains a "="
# or ":" and does not fullmatch this (kept), and a real all-caps credential
# VALUE (AWS-style "AKIA...", no underscore) does not fullmatch either.
_BARE_IDENTIFIER_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")

# Phrases that name the CONCEPT of a credential/secret rather than being one.
# Matched only against the WHOLE value (case-insensitive) — an actual value
# that happens to start with one of these words ("recovery phrase: apple
# river tiger ...") is a longer string and does not match, so a real secret
# glued to its label is unaffected; only the bare label itself is dropped.
_CREDENTIAL_LABEL_TERMS = frozenset(
    {
        "api key", "openrouter api key", "master key", "master key in memory",
        "master-key-derived key", "secret key", "system credentials",
        "credentials", "credential", "ssh key", "license key",
        "provisioning key", "access token", "recovery key", "username",
    }
)
_PIN_LABEL_TERMS = frozenset(
    {
        "recovery phrase", "seed phrase", "pin", "passwort", "password",
        "geheimnis", "access code", "dial-in code", "master key",
    }
)


def _is_bare_credential_identifier(value: str) -> bool:
    return bool(_BARE_IDENTIFIER_RE.match(value.strip()))


def _is_credential_label(value: str) -> bool:
    return value.strip().lower() in _CREDENTIAL_LABEL_TERMS


def _is_bare_concept_word(value: str) -> bool:
    """A single word with no digit — the NAME of a secret, not one.

    Shape rule, not vocabulary: GLiNER labelled "Schlüssel" (German for "key") a
    PIN at 0.78 in a notarial contract that was discussing handing over the house
    keys. The same shape covers "Passwort", "Zugang", "Code" and every word
    German can compound into one, which a term list cannot.

    A real PIN carries digits; a real recovery phrase is several words. Neither
    is a lone digitless noun. Unmarked single-word secrets are out of scope by
    the 2026-08-20 policy anyway (see expectations.Policy), so this cannot drop
    something the product promises to catch.
    """
    v = value.strip()
    return " " not in v and not any(ch.isdigit() for ch in v)


def _is_pin_label(value: str) -> bool:
    return value.strip().lower() in _PIN_LABEL_TERMS


# Loopback/dev-infra hosts — generic to every machine, not identifying or
# internal-specific, so excluded even when otherwise URL-shaped. Deliberately
# NOT extended to RFC1918 ranges (192.168.x, 10.x): those DO identify a
# specific internal network and stay in scope.
_LOOPBACK_HOSTS = frozenset({"localhost", "0.0.0.0", "::1"})
_URL_WITH_SCHEME_RE = re.compile(
    r"^[a-z][a-z0-9+.\-]*://([^/:\s]+)(?::\d+)?(?:/.*)?$", re.IGNORECASE
)
_HOST_PORT_RE = re.compile(r"^([^/:\s]+):(\d+)(?:/.*)?$")


# Types whose whole point is to BE an identifier. Measured on 38 real documents
# (2026-08-20): every false positive in these types was the LABEL of an identifier
# rather than one — "Personalausweisnummer:" with the field left blank, "Steuer ID",
# a bare "NLN", the German words "Fahrzeugversicherer" and "Kfz-steuer" — plus two
# neighbouring classes that are never identifiers either: VAT RATES ("19% MwSt.",
# "101 19,00 %") and STATUTE CITATIONS ("§ 22 EStG", "§13 StBVV").
#
# This is the same principle already written into the credential gate — a detector
# must require a VALUE, not the label of one — applied to the identifier family.
# It is deliberately a shape rule, not a word list: an identifier without a single
# digit is essentially never real, whereas a vocabulary of German label words would
# be fitted to whichever documents happened to be read.
#
# CREDENTIAL is excluded on purpose: real passwords need not contain a digit, and
# dropping one would leak a secret. Wrong direction for a privacy gateway.
# PIN is deliberately NOT here: a recovery/seed phrase is a real PIN-type secret
# made only of words ("apple river tiger …"), and requiring a digit would drop it —
# leaking the secret. Caught by test_llm_pin_with_real_phrase_value_still_redacts.
_IDENTIFIER_TYPES = frozenset({"OTHER", "TAX_ID", "INSURANCE_ID", "ROUTING"})


def _is_identifier_shaped(value: str) -> bool:
    v = value.strip()
    if "%" in v:          # a rate, not an identifier
        return False
    if "\u00a7" in v:         # a statute citation ("§ 22 EStG")
        return False
    return any(c.isdigit() for c in v)


# --- structural preconditions per type ---------------------------------------
# Not heuristics: DEFINITIONS. An EMAIL without an "@" is not an email under any
# reading, and a claim that fails its own type's definition is the WORD FOR the
# thing, not the thing. Measured on AI4Privacy: "Zugangscode" as CREDENTIAL,
# "secret code" as PIN, "Geburtsdatum" as DATE, "new email address" as EMAIL,
# and a blank form field "____________" as an IBAN.
#
# Deliberately NOT checksums. IBAN mod-97 and Luhn would catch more, but they
# fail CLOSED on OCR-damaged real values — and an IBAN the scanner mangled is
# still an IBAN that must not leak. Structure, not arithmetic.
_IBAN_SHAPE_RE = re.compile(r"^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9 ]{6,}$")


def _has_digits(value: str, n: int = 1) -> bool:
    return sum(ch.isdigit() for ch in value) >= n


def _email_shaped(value: str) -> bool:
    v = value.strip()
    at = v.rfind("@")
    return 0 < at < len(v) - 1 and "." in v[at + 1:]


def _date_shaped(value: str) -> bool:
    """A digit, or a month name. Spelled dates carry no digit at all."""
    v = value.lower()
    return _has_digits(value) or any(m in v for m in fallback.month_words())


# type -> the minimum structure a value of that type must have. A type absent
# from this map is unconstrained (PERSON and ADDRESS have their own guards,
# which are grammatical rather than structural).
_TYPE_PRECONDITION = {
    "EMAIL": _email_shaped,
    "IBAN": lambda v: bool(_IBAN_SHAPE_RE.match(v.strip())),
    "PHONE": lambda v: _has_digits(v, 3),
    "DATE": _date_shaped,
    "PIN": lambda v: not _is_concept_label(v),
    "TAX_ID": _is_identifier_shaped,
    "INSURANCE_ID": _is_identifier_shaped,
    # A routing number is 8 digits (German BLZ) or 9 (US ABA). "port 465",
    # "8080" and ":8000" were all shipping as ROUTING — measured on the
    # project's own README and a real SMTP-config document — and a 3-4 digit
    # routing number is not a stricter-threshold case, it is IMPOSSIBLE.
    "ROUTING": lambda v: sum(ch.isdigit() for ch in v) >= 8,
    "OTHER": _is_identifier_shaped,
    # A credential is a secret or the WORD for one. "Zugangscode", "Passwort",
    # "Schlüssel" are the latter, and no term list keeps up with what German can
    # compound — so the shape decides, exactly as _is_bare_concept_word does for
    # the GLiNER path. Applied here it covers every detector, not just that one.
    "CREDENTIAL": lambda v: not _is_concept_label(v),
}


def _is_concept_label(value: str) -> bool:
    """A digitless SHORT phrase — the label of a secret, not a secret.

    `_is_bare_concept_word` covers the single-word case ("Schlüssel",
    "Zugangscode"). The benchmark surfaced the two-word one: "secret code"
    redacted as a PIN. Extending from one word to three closes that without
    touching the case a digit rule would have broken —

        "apple river tiger mirror ocean velvet"

    is a real recovery phrase with no digit anywhere in it, and the backend
    suite caught a first version of this rule leaking exactly that. A
    passphrase is long by construction; a label for one is not.
    """
    v = value.strip()
    return not any(ch.isdigit() for ch in v) and len(v.split()) <= 3


def _drop_structurally_impossible(dets: list[dict]) -> list[dict]:
    """Drop claims whose value cannot be an instance of their own type."""
    kept = []
    for d in dets:
        check = _TYPE_PRECONDITION.get(d.get("type"))
        if check is None or check(d.get("value", "")):
            kept.append(d)
    return kept


def _drop_label_only_identifiers(dets: list[dict]) -> list[dict]:
    """Drop identifier-typed claims that carry no identifier."""
    return [
        d
        for d in dets
        if d.get("type") not in _IDENTIFIER_TYPES
        or _is_identifier_shaped(d.get("value", ""))
    ]


# PDF text extraction routinely breaks an umlaut into base letter + a SEPARATE
# diaeresis character, so "Dünenwald" arrives as "Du¨nenwald". Every detector then
# sees a word that matches no letter class and no learned token: measured on a real
# booking form, GLiNER scored the address 0.64 when clean and only 0.51 when
# broken, fragmenting the span in the middle of the street name.
#
# Two encodings occur and only one is repaired by NFC:
#   U+0308 COMBINING DIAERESIS — NFC joins it to the base letter.
#   U+00A8 SPACING DIAERESIS   — a standalone character; NFC leaves it alone,
#                                so it is converted to the combining form first.
# Repairing the INPUT (rather than teaching each rule about the artifact) fixes
# spaCy, GLiNER, Presidio and the regex net at once, and the scrubbed output is
# returned in the repaired form — which is what the user meant to write anyway.
_SPACING_ACCENT_RE = re.compile("([a-zA-Z])\u00a8")


def _repair_extraction_artifacts(text: str) -> str:
    repaired = _SPACING_ACCENT_RE.sub(lambda m: m.group(1) + "\u0308", text)
    return unicodedata.normalize("NFC", repaired)


def _drop_concept_only_secrets(dets: list[dict]) -> list[dict]:
    """Apply the CREDENTIAL/PIN/INTERNAL_URL sanity gates to ANY detector's output.

    The gates were written for the LLM tier, but nothing about them is
    LLM-specific: "a secret detector must require actual value context, not just
    the LABEL of one" is a property of the claim, not of who made it. GLiNER
    reintroduced the very FP class documented above through a different door —
    asked about "api key" it labels the env-var NAME "OPENROUTER_API_KEY", which
    protects nothing and destroys the sentence. Same gate, same reason.
    """
    return [
        d
        for d in dets
        if (
            d.get("type") not in ("CREDENTIAL", "PIN", "INTERNAL_URL")
            or (
                d.get("type") == "CREDENTIAL"
                and not (
                    _is_bare_credential_identifier(d.get("value", ""))
                    or _is_credential_label(d.get("value", ""))
                )
            )
            or (
                d.get("type") == "PIN"
                and not _is_pin_label(d.get("value", ""))
                and not _is_bare_concept_word(d.get("value", ""))
            )
            or (
                d.get("type") == "INTERNAL_URL"
                and _looks_like_internal_url(d.get("value", ""))
            )
        )
    ]


def _looks_like_internal_url(value: str) -> bool:
    """True only for an actual internal URL: a scheme+host, or a bare
    host:port. A path fragment with no host ("/api", "/sync", "/api/v1/keys")
    or a scheme-less, slash-less token ("gemma-3-12b-it", a model id) is
    dropped — neither identifies an internal system on its own. Loopback
    hosts are excluded even when otherwise URL-shaped (see _LOOPBACK_HOSTS)."""
    v = value.strip()
    match = _URL_WITH_SCHEME_RE.match(v) or _HOST_PORT_RE.match(v)
    if not match:
        return False
    host = match.group(1).lower()
    if host in _LOOPBACK_HOSTS or host.startswith("127."):
        return False
    return True


def _detect_always_redact(text: str, terms: list[str]) -> list[dict]:
    """Deterministically detect the user's "always redact" terms in ``text``.

    Each term that actually occurs in the text becomes a CUSTOM entity with the
    top score (1.0), so it survives merging and is always redacted. Matching is
    case-insensitive and word-boundary-aware (handled later by ``find_spans``);
    terms that do not occur are skipped so they never appear in the entity report.
    """
    detected: list[dict] = []
    seen: set[str] = set()
    for term in terms:
        term = term.strip()
        if not term:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        if not find_spans(text, term):
            continue
        detected.append({"type": "CUSTOM", "value": term, "score": 1.0})
    return detected


def _apply_never_redact(detected: list[dict], terms: list[str]) -> list[dict]:
    """Drop detections whose value is on the user's allow-list (case-insensitive,
    whole-value match). Suppresses false positives from any detector — e.g. an
    ingredient "Xantan" the LLM or NER mistook for a name.

    ⚠️ CUSTOM is exempt. A CUSTOM detection IS the user's own `always_redact`
    entry, so dropping it here would let the allow-list silently cancel an
    explicit "always redact this" — a fail-OPEN, and the user cannot see it
    happen. The `disabled_types` block below already treats CUSTOM as a hard
    override for exactly this reason; this function simply did not, so a value
    present on both lists lost. Between two contradictory instructions from the
    same user, redacting is the safe reading.
    """
    allow = {t.strip().lower() for t in terms if t.strip()}
    if not allow:
        return detected
    return [
        d
        for d in detected
        if d.get("type") == "CUSTOM" or d.get("value", "").strip().lower() not in allow
    ]


# A value can appear many times; 32 is far past the point where more occurrences
# change a verdict, and it keeps a pathological document from turning a guard
# into a quadratic scan.
_MAX_OCCURRENCES = 32


def _occurrences(text: str, value: str, limit: int = _MAX_OCCURRENCES) -> list[int]:
    """Start offsets of ``value`` in ``text``, capped at ``limit``."""
    if not value:
        return []
    out: list[int] = []
    at = text.find(value)
    while at >= 0 and len(out) < limit:
        out.append(at)
        at = text.find(value, at + 1)
    return out


async def scrub(
    text: str, options: ScrubOptions, api_key: str | None = None
) -> ScrubResponse:
    """Full scrub pipeline.

    PRIMARY (fast, always-on): spaCy/Presidio NER + the deterministic regex
    safety-net form the detection base. OPTIONAL: the LLM enriches the base with
    context-dependent PII — best-effort, so a timeout/parse error keeps the base
    instead of dropping into a near-empty fallback.

    ``api_key`` is the caller-resolved per-user OpenRouter sub-key; it is used by
    the cloud PII-extraction path so scrubbing bills the user's own budget.
    """
    started = time.perf_counter()

    if len(text) > settings.max_text_length:
        text = text[: settings.max_text_length]

    # Repair PDF-extraction damage BEFORE any detector sees the text — see
    # _repair_extraction_artifacts. Done here, once, so every tier benefits and
    # the replacement step works on the same string the detectors matched against.
    text = _repair_extraction_artifacts(text)

    # Resolve language up front — the NER engine needs it. The client's locale
    # hint only ever breaks the zero-evidence tie (see detect_language).
    if options.language in ("de", "en"):
        language = options.language
    else:
        language = detect_language(text, hint=options.language_hint)

    # --- PRIMARY: NER (names + patterns) + deterministic safety-net ----------
    # NER is CPU-bound (spaCy/Presidio); run it off the event loop so concurrent
    # /scrub requests (and /health, /auth) aren't blocked on a single worker.
    ner_detected = (
        await asyncio.to_thread(ner.detect_ner, text, language)
        if settings.ner_enabled
        else []
    )

    # GLiNER: a third deterministic-ish detector in the same PRIMARY tier. Also
    # CPU-bound, so it goes off the event loop for the same reason spaCy does.
    # Contributes [] when the dependency or model is absent, so a deployment
    # without it behaves exactly as before.
    if settings.gliner_enabled:
        import gliner_detect

        # ONE forward pass, reused for both detection and the veto below. The veto
        # used to re-run the model per PERSON candidate — measured on production,
        # that cost 4.4x at 1000 chars and 2.8x at 4000, for identical output.
        gliner_dets, gliner_spans = await asyncio.to_thread(
            gliner_detect.detect_gliner_with_spans, text
        )
        gliner_dets = _drop_concept_only_secrets(gliner_dets)
        # A PERSON claim from GLiNER goes through the SAME guards NER's own
        # PERSON claims do — the FULL _keep_person, not just the denylist.
        #
        # The denylist alone was not enough, and the gap shipped: GLiNER labels
        # ROLE NOUNS and PRONOUNS as people, confidently — measured on a real
        # notarial contract, "Der Notar" 0.93, "Käufer" 0.87, "du" 0.97, against
        # "Jonas" 0.97. No threshold separates those, and no word list scales:
        # German makes a new role noun out of any profession.
        #
        # Grammar separates them exactly. spaCy tags Notar/Käufer/Gesellschafter/
        # Nutzer as NOUN, "du"/"ihr" as PRON, "Der"/"Jeder" as DET — and
        # Jonas/Michael/Brandt/Talberg as PROPN. _keep_person's guard 4
        # already requires one PROPN in the span; it simply never saw these,
        # because detect_ner only builds a POS doc when SPACY found a PERSON, and
        # on this text spaCy found nothing.
        #
        # require_capitalization=False for the same reason the LLM path passes it:
        # GLiNER runs on all-lowercase text too, where a real name is legitimately
        # lowercase, and dropping it there would LEAK. The PROPN guard is what
        # does the work here; the caps guard is the one that can fail closed.
        def _addr_needs_doc(d: dict) -> bool:
            v = d.get("value", "")
            return (
                d.get("type") == "ADDRESS"
                and not any(ch.isdigit() for ch in v)
                and not fallback.looks_like_street_name(v)
            )

        if any(d.get("type") == "PERSON" or _addr_needs_doc(d) for d in gliner_dets):
            # `language`, NOT options.language: the client sends "auto" (or
            # nothing) far more often than it sends a locale, and `or "de"`
            # then ran the GERMAN tagger over ENGLISH text. The guard misreads
            # every tag it gets back and fails open, so the whole filter
            # silently did nothing on English input — which is exactly the
            # configuration the reported document arrived in. `language` is the
            # resolved one, decided 60 lines up for precisely this reason.
            pos = ner.pos_doc(text, language)
            # Computed once per scrub, not per candidate: it is a property of
            # the document, and the guard is called for every occurrence of
            # every PERSON claim.
            mixed_case = ner.document_is_mixed_case(text)
            kept_g: list[dict] = []
            for d in gliner_dets:
                # ADDRESS: keep on EVIDENCE of a real place, drop the concept
                # word. Evidence, in order of strength: a digit (house number or
                # postcode — the net's whole address grammar), a street-type
                # morpheme ("Poststraße", "Erdmannstr." — the beta caught the
                # first digit-only gate leaking exactly this: "Peter wohnt in
                # der Poststraße", GLiNER 0.96, dropped), or a PROPN token
                # ("Am Dünenwald", "Berlin" — named places the morpheme list
                # cannot enumerate). What has none of these is the WORD for an
                # address — "Postleitzahl-Adresse", "Lieferadresse" — and the
                # PERSON-style OOV rescue is deliberately absent here: address
                # concept words are hyphen compounds, which is precisely what a
                # vocabulary lacks, so OOV would rescue the false positive.
                if d.get("type") == "ADDRESS":
                    if _addr_needs_doc(d):
                        v = d.get("value", "")
                        a_start = text.find(v)
                        span = None
                        if pos is not None and a_start >= 0:
                            try:
                                span = pos.char_span(
                                    a_start, a_start + len(v), alignment_mode="expand"
                                )
                            except Exception:  # noqa: BLE001
                                span = None
                        if span is not None and not any(tk.pos_ == "PROPN" for tk in span):
                            continue  # concept word — drop
                    kept_g.append(d)
                    continue
                if d.get("type") != "PERSON":
                    kept_g.append(d)
                    continue
                value = d.get("value", "")
                # EVERY occurrence, not just the first. GLiNER reports a value,
                # not an offset, so this side has to relocate it — and
                # `text.find` judges whichever occurrence happens to come first,
                # which is not the one the model scored. Measured on a real
                # document: "person" scored inside `IOPoint: personOnSite`, but
                # judged against "that a person is on site" (or the reverse, on
                # a longer text). Whether the guard was right then depended on
                # document order.
                #
                # Keep if ANY occurrence looks like a name. That is the
                # fail-open direction and it is the one that matches how the
                # detection is used: the value is redacted EVERYWHERE it
                # appears, so one genuine occurrence is enough to require it.
                occurrences = _occurrences(text, value)
                # Unresolvable span -> fail OPEN, same as _keep_person does.
                if not occurrences:
                    kept_g.append(d)
                    continue
                verdicts = [
                    ner._keep_person(
                        value, o, o + len(value), None, require_capitalization=False
                    )
                    and ner.zero_shot_person_ok(
                        value, o, o + len(value), pos, mixed_case, d.get("score")
                    )
                    for o in occurrences
                ]
                # MAJORITY, not "any". "Any" was the first cut and it backfired
                # on exactly the words this guard exists to stop: measured on
                # ECHR judgments, "applicant" occurs 372 times, and a word that
                # frequent is guaranteed to appear once without its article
                # ("applicant's", a heading, a list item) — one lenient sample
                # and it survives. Fail-open belongs to UNCERTAINTY, not to
                # evidence: 370 determiner-led occurrences out of 372 is
                # evidence. Ties keep, so a genuine 50/50 still fails open.
                if sum(verdicts) * 2 >= len(verdicts):
                    kept_g.append(d)
            gliner_dets = kept_g
        ner_detected = ner_detected + gliner_dets
    deterministic = fallback.detect_safety_net(text) if settings.safety_net else []
    # User's "always redact on device" terms — deterministic, top priority.
    custom = _detect_always_redact(text, options.always_redact)
    base = _merge(_merge(ner_detected, deterministic), custom)
    ner_used = settings.ner_enabled and ner.is_ready()

    # GLiNER contrast veto — deliberately OUTSIDE the LLM branch. It used to live
    # inside it, which meant the veto silently did not exist in the one
    # configuration we most want to ship (net + GLiNER, no LLM at all): brands
    # sailed through as PERSON because nothing was asked. Measured on 38 real
    # documents, that is where "Nokia", "Apple", "Samsung" and "Arvato Bertelsmann"
    # came from.
    #
    # Two bars, because the cost of being wrong is asymmetric:
    #   tentative      -> any competing label wins (NER already doubted it)
    #   NOT tentative  -> the contrast label must win DECISIVELY (>= 0.95), since a
    #                     wrong veto here leaks a real name.
    if settings.gliner_enabled and settings.gliner_veto:
        import gliner_detect

        kept: list[dict] = []
        for d in base:
            if d.get("type") != "PERSON":
                kept.append(d)
                continue
            label, score, margin = gliner_detect.verdict_from_spans(
                gliner_spans, d.get("value", "")
            )
            if label in gliner_detect.VETO_LABELS and (
                d.get("tentative")
                or (
                    score >= settings.gliner_veto_min_score
                    and margin >= settings.gliner_veto_person_margin
                )
            ):
                logger.debug(
                    "gliner veto: PERSON candidate better explained as %s "
                    "(score %.2f, margin %+.2f)",
                    label,
                    score,
                    margin,
                )
                continue
            kept.append(d)
        base = kept

    # The LLM extraction tier is GONE (2026-08-23, .claude/plans/
    # remove-llm-pii-tier.md). Detection is complete at this point: NER + the
    # deterministic net + GLiNER, with the guards above. What follows are the
    # cross-detector gates.
    detected = base

    # Identifier-typed claims that carry no identifier — see
    # _drop_label_only_identifiers. Applied here, after every detector, so it
    # covers the net, NER, GLiNER and the LLM with one rule rather than four.
    detected = _drop_label_only_identifiers(detected)
    detected = _drop_structurally_impossible(detected)

    # V1 cross-check — the winning verifier from the 2026-08-23 trial. LAST of
    # the PERSON gates, after every detector and veto, so it judges exactly
    # what would otherwise ship. One GLiNER query per surviving PERSON claim,
    # over the claim's own context; only a real verdict below the floor drops
    # it (person_score returns None for "no verdict" -> keep). Sweep table and
    # the accepted recall cost are documented at the config knobs.
    if settings.gliner_enabled and settings.gliner_person_crosscheck:
        import gliner_detect as _gd

        # One POS doc for hygiene at this gate. The GLiNER path strips fused
        # prefixes too, but spaCy's own claims arrive here unstripped — the
        # term sheet's "Beispiel-Meilensteine Jonas" came from BOTH detectors,
        # and fixing only one path left the other's copy painting the prefix.
        pos_cc = (
            ner.pos_doc(text, language)
            if any(d.get("type") == "PERSON" for d in detected)
            else None
        )
        _person_values = {
            d.get("value", "").lower() for d in detected if d.get("type") == "PERSON"
        }
        seen_cc: set[str] = set()
        kept_cc: list[dict] = []
        for d in detected:
            # CUSTOM (always-redact) claims are a different type entirely and
            # never reach this branch; only PERSON is gated.
            if d.get("type") != "PERSON":
                kept_cc.append(d)
                continue
            value = d.get("value", "")
            at = text.find(value)
            if at >= 0:
                stripped = ner.strip_leading_common_nouns(value, at, pos_cc)
                # Accept ONLY when the stripped name is independently detected:
                # then this is convergence of two claims onto one value, and a
                # wrong strip is impossible. Without that check, stripping the
                # OOV compound off "Paul-Heinz Müller" would LEAK the given
                # name — hygiene must not be able to cost recall.
                if stripped != value and stripped.lower() in _person_values:
                    d = dict(d, value=stripped)
                    value = stripped
            if value.lower() in seen_cc:
                continue  # hygiene can converge two claims onto one value
            seen_cc.add(value.lower())
            keep = await asyncio.to_thread(
                _gd.person_crosscheck_keep,
                value,
                text,
                settings.gliner_crosscheck_floor,
                settings.gliner_crosscheck_majority,
            )
            if keep is False:
                logger.debug("crosscheck drop: %r", value)
                continue
            kept_cc.append(d)
        detected = kept_cc


    # Drop DATE entities that are relative durations ("3 Wochen") — not PII.
    if settings.drop_relative_durations:
        detected = [
            d
            for d in detected
            if not (d.get("type") == "DATE" and _is_relative_duration(d.get("value", "")))
        ]

    # User's "never redact" allow-list — applied AFTER every detector (incl. the
    # LLM) so it suppresses false positives from any source. Whole-value,
    # case-insensitive match. CUSTOM (an always_redact entry) is exempt, so an
    # overlapping allow-list entry can no longer silently un-redact it.
    detected = _apply_never_redact(detected, options.never_redact)

    # Per-request type policy: drop the entity types the user turned off. CUSTOM
    # (the always_redact list) is a hard override and is never dropped. Empty = all.
    if options.disabled_types:
        off = set(options.disabled_types) - {"CUSTOM"}
        detected = [d for d in detected if d.get("type") not in off]

    model_used = "presidio-ner" if ner_used else "presidio-fallback"

    scrubbed, entities = pseudonymize(text, detected, options)

    metadata = ScrubMetadata(
        model_used=model_used,
        processing_time_ms=int(round((time.perf_counter() - started) * 1000)),
        # Historically "the LLM tier did not run"; the tier no longer exists,
        # and the full detector IS this pipeline. True now only when the NER
        # engine itself is down (regex net alone) — the one remaining state
        # the "eingeschränkte Erkennung" warning should describe.
        fallback_mode=not ner_used,
        language_detected=language,
        ner_used=ner_used,
        skip_reason=None if ner_used else "ner_unavailable",
        low_case_signal=not any(c.isupper() for c in text),
    )

    return ScrubResponse(
        scrubbed=scrubbed,
        original_length=len(text),
        scrubbed_length=len(scrubbed),
        entities=entities if options.show_entities else [],
        metadata=metadata,
    )
