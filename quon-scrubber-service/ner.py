"""spaCy / Presidio NER detection — the primary, always-on PII detector.

Runs a Presidio :class:`AnalyzerEngine` backed by spaCy models (German +
English). Unlike :mod:`fallback`, this DOES construct an ``AnalyzerEngine`` and
load spaCy NER models, so it can recognise person names — the main thing the
regex safety-net and a timed-out LLM miss.

Everything is best-effort: if Presidio or the spaCy models are not available the
module logs once and returns ``[]`` so the service degrades to the regex
safety-net (and the LLM, when reachable) instead of crashing.

Only a curated set of entity types is emitted. NER LOCATION/ORG/DATE labels are
deliberately dropped — they produce false positives (cities, public company
names) that conflict with QUON's "do not flag public companies / locations"
policy. Structured PII (email/phone/IBAN/credit card/SSN) comes from Presidio's
built-in pattern recognizers, which the engine runs anyway.
"""

from __future__ import annotations

import logging
import re

from config import settings
from fallback import TITLE_PATTERN, looks_like_date
from ner_gazetteer import (
    ALLERGEN_COMPONENTS,
    AMBIGUOUS_TERMS,
    CULINARY_FRAME,
    EDGE_TRIM_TOKENS,
    HYPHEN_COMPOUND_PREFIXES,
    HYPHEN_COMPOUND_SUFFIXES,
    INTERROGATIVES,
    KINSHIP_TERMS,
    NON_NAME_SUFFIXES,
    NAME_PARTICLE_PREFIXES,
    NON_NAME_TERMS,
    POSSESSIVE_PRONOUNS,
    STREET_SUFFIXES,
    TENTATIVE_TECH_EPONYMS,
)

logger = logging.getLogger("quon.ner")

# spaCy POS tag a genuine person-name token must carry. German NER frequently
# mis-tags capitalized sentence-initial imperative verbs and common nouns
# ("Mache", "Rechne", "Fasse", "Übersetze") as NOUN, and because German
# capitalizes every noun, capitalization alone can't separate them from a name.
# A real name token is a proper noun, so we require PROPN and deliberately do
# NOT accept NOUN — accepting NOUN was the main source of PERSON false positives.
_NAME_POS = frozenset({"PROPN"})

# Common German words that the medium/large spaCy models still occasionally tag
# as PERSON (salutations, sentence-initial verbs, function words). Matched
# case-insensitively against the full detected value. Extend via
# ``settings.ner_person_denylist``.
_BUILTIN_PERSON_DENYLIST = frozenset(
    {
        "schreibe", "schreiben", "reiche", "reichen", "sende", "senden",
        "sehr", "geehrte", "geehrter", "geehrten", "geehrtes",
        "hallo", "liebe", "lieber", "liebes", "guten", "tag", "morgen",
        "mit", "freundlichen", "grüßen", "gruss", "gruß", "grüße", "grüsse",
        "danke", "dank", "vielen", "viele", "beste", "herzliche", "herzlichen",
        "anbei", "betreff", "betrifft", "bitte", "gerne", "hiermit", "leider",
        "möchte", "würde", "hätte", "könnte", "außerdem", "zudem", "ferner",
        "ich", "wir", "sie", "ihnen", "ihre", "ihren", "ihrer",
        # Sentence-initial imperative verbs that open a chat instruction. The
        # PROPN guard in _keep_person already drops most of these, but listing
        # them here also covers the fail-open path (POS tags unavailable).
        "mache", "machen", "rechne", "rechnen", "fasse", "übersetze", "uebersetze",
        "gib", "zeige", "zeig", "plane", "suche", "erkläre", "erklaere", "erstelle",
        "nenne", "formuliere", "berechne", "vergleiche", "beschreibe", "analysiere",
        "korrigiere", "prüfe", "pruefe", "überprüfe", "ueberpruefe", "liste",
        "generiere", "finde", "hilf", "sage", "gestalte", "entwirf", "optimiere",
        "verbessere", "ergänze", "ergaenze", "wandle", "konvertiere", "definiere",
        "empfehle", "schlage", "antworte", "zusammenfasse", "kopiere", "ordne",
        # Short imperative forms + affirmations/fillers, from the real-world
        # prompt review (2026-07-08): the LONG forms above were already listed
        # ("mache", "suche"), but real chat uses the short imperative ("Mach
        # noch Mal…", "Such mir einen Anbieter…"), and bare affirmations
        # ("Ja", "Ggf.") got tagged PERSON as whole one-word messages.
        "mach", "such", "ja", "nein", "ok", "okay", "ggf",
        # LLM-origin single-token PERSON FPs from the config-2 real-world run
        # (the merge gate routes LLM output through this same denylist): bare
        # role words/acronyms in work notes ("Termin von PM, PO, PPO, PL…",
        # "meiner Frau…", "for me"). A bare two-letter role acronym or a
        # generic role noun is never an identifying name on its own; titled
        # real names ("Frau Vogel") are multi-token values and unaffected —
        # the denylist matches the FULL value only.
        "me", "frau", "herr", "pm", "po", "ppo", "pl", "vp", "ba",
    }
)

# Lazily-merged denylist (builtin + config extras).
_denylist: frozenset[str] | None = None


def _get_denylist() -> frozenset[str]:
    global _denylist
    if _denylist is None:
        extra = {
            w.strip().lower()
            for w in settings.ner_person_denylist.split(",")
            if w.strip()
        }
        # Builtin salutations/verbs + the lab/food gazetteer + the operator's extras.
        _denylist = _BUILTIN_PERSON_DENYLIST | NON_NAME_TERMS | frozenset(extra)
    return _denylist

# Presidio entity label -> QUON entity type. Anything not listed here (LOCATION,
# GPE, ORG, NRP, DATE_TIME, URL, ...) is intentionally ignored.
_PRESIDIO_TO_QUON: dict[str, str] = {
    "PERSON": "PERSON",
    "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE",
    "IBAN_CODE": "IBAN",
    "US_SSN": "TAX_ID",
    "US_ITIN": "TAX_ID",
    "CREDIT_CARD": "CREDIT_CARD",
}

_SUPPORTED_LANGUAGES = ("de", "en")

# Lazily-built, cached AnalyzerEngine (constructed on first use / warmup).
_analyzer = None
_init_failed = False


def _build_analyzer():
    """Construct the Presidio AnalyzerEngine with a de+en spaCy NLP engine.

    Returns the engine, or ``None`` if Presidio / the spaCy models are missing.
    """
    try:
        from presidio_analyzer import AnalyzerEngine
        from presidio_analyzer.nlp_engine import NlpEngineProvider
    except ImportError:
        logger.error(
            "presidio-analyzer is not installed — NER detection disabled "
            "(install presidio-analyzer + spaCy models to enable name detection)."
        )
        return None

    configuration = {
        "nlp_engine_name": "spacy",
        "models": [
            {"lang_code": "de", "model_name": settings.spacy_model_de},
            {"lang_code": "en", "model_name": settings.spacy_model_en},
        ],
        # Pin the spaCy-label -> Presidio-entity mapping instead of relying on
        # Presidio's shifting defaults. We map ONLY person labels; every other NER
        # label (MISC/LOC/ORG/GPE/DATE/...) is explicitly ignored. This stops a
        # future Presidio/model default from silently mapping the German MISC
        # label to PERSON again — the behaviour that produced the "kannst du mir"
        # multi-token false positives on the older deployment. Structured PII
        # (EMAIL/PHONE/IBAN/...) comes from Presidio's pattern recognizers, not
        # spaCy NER, so restricting the NER mapping does not affect it.
        "ner_model_configuration": {
            "model_to_presidio_entity_mapping": {
                "PER": "PERSON",
                "PERSON": "PERSON",
            },
            "labels_to_ignore": [
                "O", "MISC", "LOC", "ORG", "GPE", "ORGANIZATION", "LOCATION",
                "NORP", "FAC", "PRODUCT", "EVENT", "WORK_OF_ART", "LAW",
                "LANGUAGE", "DATE", "TIME", "MONEY", "PERCENT", "QUANTITY",
                "ORDINAL", "CARDINAL",
            ],
            "low_score_entity_names": [],
        },
    }
    try:
        nlp_engine = NlpEngineProvider(nlp_configuration=configuration).create_engine()
        analyzer = AnalyzerEngine(
            nlp_engine=nlp_engine,
            supported_languages=list(_SUPPORTED_LANGUAGES),
        )
    except Exception as exc:  # missing model, load failure, etc.
        logger.error(
            "Could not build the spaCy NER engine (de=%s, en=%s): %s — NER "
            "detection disabled (run `python -m spacy download <model>`).",
            settings.spacy_model_de,
            settings.spacy_model_en,
            exc,
        )
        return None

    logger.info(
        "spaCy NER engine ready (de=%s, en=%s)",
        settings.spacy_model_de,
        settings.spacy_model_en,
    )
    return analyzer


def _get_analyzer():
    global _analyzer, _init_failed
    if _init_failed:
        return None
    if _analyzer is None:
        _analyzer = _build_analyzer()
        if _analyzer is None:
            _init_failed = True
    return _analyzer


def warmup() -> bool:
    """Eagerly build the engine (called at startup). Returns readiness."""
    if not settings.ner_enabled:
        return False
    return _get_analyzer() is not None


def is_ready() -> bool:
    """True if the NER engine is enabled and successfully loaded."""
    return settings.ner_enabled and _analyzer is not None and not _init_failed


def _get_nlp(lang: str):
    """Return the spaCy ``Language`` already loaded inside Presidio's NLP engine.

    Reused for POS tagging (no second model load). Returns ``None`` if it can't
    be reached, so the POS filter degrades gracefully.
    """
    analyzer = _get_analyzer()
    if analyzer is None:
        return None
    try:
        return analyzer.nlp_engine.nlp.get(lang)
    except Exception:  # unexpected Presidio internals
        return None


def _is_non_name(value: str) -> bool:
    """True for document vocabulary that NER mislabels PERSON but is never a personal
    name: an exact gazetteer/denylist hit, a taxonomic family name (…aceae / …idae),
    an allergen protein component (…profilin), a German interrogative/question-word
    appearing anywhere in the span (…profilin-style, but ANY-token rather than
    ALL-token — see below), or a multi-word span whose EVERY token is such a term
    ("LifeLabs FST", "Romanesco broccoli", "Mugwort Profilin"). These are safe drops
    — none collides with a real surname (those live in AMBIGUOUS_TERMS, handled
    separately).

    The interrogative check is deliberately ANY-token, not ALL-token: a real
    person's name never contains a bare interrogative pronoun/adverb as one of its
    tokens (nobody is named "Einnahme Wann"), so a multi-token span like
    "Einnahme wann" is dropped even though "einnahme" alone is an ordinary noun, not
    gazetteered. This is narrower than the generic ALL-token rule below on purpose:
    it only fires for the closed interrogative class, so it can never suppress a
    real name that happens to share a token with an unrelated food/lab term.
    """
    v = value.lower().strip()
    if v in _get_denylist():
        return True
    toks = v.split()
    if any(len(t) >= 6 and t.endswith(NON_NAME_SUFFIXES) for t in toks):
        return True
    if any(t in ALLERGEN_COMPONENTS for t in toks):
        return True
    if len(toks) > 1 and any(t in INTERROGATIVES for t in toks):
        return True
    # Culinary-frame ANY-token rule (same closed-class reasoning as the
    # interrogatives above): no personal name contains "Rezept"/"Kalorien"/
    # "Zubereitung"/"Airfryer" as one of its tokens, so a span like
    # "Milchreis Rezept" or "Kalorien haloumi" is a safe unconditional drop.
    if len(toks) > 1 and any(t in CULINARY_FRAME for t in toks):
        return True
    # German possessive-pronoun + kinship-noun rule (real-world report,
    # 2026-07-28): "meinem bruder", "meine Mutter" are never a name. Requires
    # BOTH a possessive token AND a kinship token present, AND every token in the
    # span to be one or the other -- so it can only ever match the combination
    # itself, never a real name in the same span ("mein bruder Thomas" has a
    # third token outside both sets and is left alone). See ner_gazetteer.py for
    # why this is deliberately its own AND-combo rule rather than folded into the
    # bare-word NON_NAME_TERMS denylist.
    if (
        len(toks) > 1
        and any(t in POSSESSIVE_PRONOUNS for t in toks)
        and any(t in KINSHIP_TERMS for t in toks)
        and all(t in POSSESSIVE_PRONOUNS or t in KINSHIP_TERMS for t in toks)
    ):
        return True
    if len(toks) > 1 and all(
        t in NON_NAME_TERMS
        or t in ALLERGEN_COMPONENTS
        or (len(t) >= 6 and t.endswith(NON_NAME_SUFFIXES))
        for t in toks
    ):
        return True
    # Intercapped identifier ("ReqDoc", "DevOps") — code/product shape, not a
    # written name. Every token must look that way, so a real name sitting next
    # to one ("ReqDoc von Anna") keeps its redaction. See
    # ner_gazetteer.NAME_PARTICLE_PREFIXES for the surnames this must not eat.
    if all(_is_intercapped_identifier(t) for t in value.split()):
        return True
    # Hyphenated technical/doc compound ("Per-request", "Vendor Lock-in") — see
    # ner_gazetteer.HYPHEN_COMPOUND_PREFIXES/SUFFIXES for why this is a closed
    # vocabulary rather than "any lowercase half", and why that discipline
    # matters (a real name like "Soo-jin" also has a lowercase second half).
    # ANY-token: the compound word can be just one word of a longer span
    # ("Vendor Lock-in") without the OTHER word being name-shaped at all.
    if any(_is_hyphen_lowercase_compound(t) for t in value.split()):
        return True
    return False


def _is_hyphen_lowercase_compound(token: str) -> bool:
    """True for a hyphenated token shaped like an English tech/doc compound
    ("Per-request", "Lock-in", "Multi-tenant", "Follow-up"), never a real
    hyphenated personal name.

    Deliberately a closed-vocabulary check (see ner_gazetteer.HYPHEN_COMPOUND_
    PREFIXES/SUFFIXES), not "the half after the hyphen starts lowercase" —
    that broader shape also matches real given names such as "Soo-jin" (a
    genuine entry in the synthetic eval corpus), which must never be dropped.
    """
    if "-" not in token:
        return False
    parts = [p for p in token.split("-") if p]
    if len(parts) < 2:
        return False
    first, second = parts[0].lower(), parts[1]
    if first in HYPHEN_COMPOUND_PREFIXES:
        return True
    return second[:1].islower() and second.lower() in HYPHEN_COMPOUND_SUFFIXES


def _is_intercapped_identifier(token: str) -> bool:
    """True for a CamelCase-style identifier that is not a particle surname.

    Requires a lowercase letter FOLLOWED BY an uppercase one inside the word —
    so "ReqDoc"/"DevOps" match while an all-caps acronym ("API", "PAT") does
    not (those are handled elsewhere and are not name-shaped anyway).
    """
    if len(token) < 3 or "'" in token or "\u2019" in token:
        return False
    if not re.search(r"[a-z][A-Z]", token):
        return False
    low = token.lower()
    return not any(
        low.startswith(p) and len(low) > len(p) for p in NAME_PARTICLE_PREFIXES
    )


# Minimum token length before a STREET_SUFFIXES match is honoured — guards the
# shortest suffix ("platz", 5 chars) from firing on itself or a near-bare word;
# a real street compound always has a meaningful prefix in front of the suffix
# ("Rehbergplatz", "Marktplatz"), so >= 7 total chars leaves room for at least
# a 2-letter prefix while still excluding the bare suffix word.
_STREET_SUFFIX_MIN_LEN = 7


def _has_street_suffix(value: str) -> bool:
    """True if any token in ``value`` ends with an unambiguous German street/
    square/avenue/lane suffix (see ``ner_gazetteer.STREET_SUFFIXES`` for the
    per-suffix surname-collision vetting). Used ONLY to make a PERSON candidate
    tentative (never a hard drop, unlike ``_is_non_name``) — see ``detect_ner``.
    """
    toks = value.lower().split()
    return any(len(t) >= _STREET_SUFFIX_MIN_LEN and t.endswith(STREET_SUFFIXES) for t in toks)


def _trim_person_edges(value: str) -> str:
    """Trim non-name tokens off a PERSON span's EDGES, keeping the name core.

    Real-world spans glue junk onto real names ("bin Timo", "CEO Kapferer",
    "Ja Preis", "Max because he ha"). Dropping such a span outright would LEAK
    the contained name ("Danke Anna" must keep redacting Anna), so we shrink it
    instead: leading/trailing tokens that are in EDGE_TRIM_TOKENS or fully
    lowercase are removed; whatever remains goes through the normal guards
    (denylist / POS / caps), so "Ja Preis" → "Preis" can still be dropped by
    the POS filter while "bin Timo" → "Timo" stays redacted. Trimming a
    lowercase name particle at the edge ("van Gogh" → "Gogh") only shrinks the
    placeholder — the name core is still redacted, which is the invariant that
    matters. NER-path only: the LLM merge gate runs with
    require_capitalization=False for legitimate all-lowercase names, and this
    trim would shred those.
    """
    toks = value.split()

    def _edge_junk(tok: str) -> bool:
        t = tok.strip(".,:;!?()[]{}\"'").lower()
        return t in EDGE_TRIM_TOKENS or not any(ch.isupper() for ch in tok)

    while toks and _edge_junk(toks[0]):
        toks.pop(0)
    while toks and _edge_junk(toks[-1]):
        toks.pop()
    return " ".join(toks)


# Characters no personal name contains. A PERSON candidate carrying one of
# these is markup or a path, not a person — "MCCS/ RZOst/ JSN/ Facility" read as
# four people on a real substation document (spaCy's own claim, not GLiNER's).
# The test runs on the RAW value on purpose: the tokeniser drops punctuation and
# takes the evidence with it, leaving a bare PROPN that every later guard accepts.
_NAME_HOSTILE_CHARS = "/\\|<>{}=@#*"


def has_name_hostile_punctuation(value: str) -> bool:
    """Does this PERSON candidate carry punctuation no name has?"""
    return any(ch in value for ch in _NAME_HOSTILE_CHARS)


def _keep_person(
    value: str, start: int, end: int, doc, require_capitalization: bool = True
) -> bool:
    """Decide whether a PERSON candidate is a real name.

    German NER is noisy on informal / imperative chat text: it mislabels
    sentence-initial verbs ("Mache", "Rechne"), common nouns and even lowercase
    words ("pasta") as PERSON, and emits function-word runs ("kannst du mir",
    "Mein Name") as multi-token spans. Four model-independent guards remove the
    bulk of these without hurting recall on genuine names:

      1. denylist     — known salutations / imperative verbs / interrogatives.
      2. punctuation  — no name carries "/", "@", "|" or markup braces; those
                        are paths and tags ("MCCS/", "RZOst/").
      3. no digits    — a real name never contains a digit (drops IDs/codes such
                        as an insurance number "KV-98234-A-7").
      3. capitalised  — every German name is capitalised, so a span with no
                        capitalised token is dropped (kills lowercase "pasta" and
                        all-lowercase runs like "kannst du mir"). SKIPPED when
                        ``require_capitalization`` is False: the LLM merge path
                        passes that, because on all-lowercase input NER defers
                        PERSON detection to the LLM (casing is NER's main signal),
                        so the LLM is precisely the layer that legitimately returns
                        lowercase names — applying this guard there would drop them
                        and LEAK the name (fail-open).
      4. proper noun  — when POS tags are available, the span must contain at
                        least one PROPN token. Real names carry one; mistagged
                        verbs / common nouns ("Mache"/NOUN) and function-word runs
                        do not. This now covers MULTI-token spans too — previously
                        they bypassed every POS check and were kept unconditionally.
      5. attributive adjective — a span OPENING with a declined, in-vocabulary
                        ADJ whose syntactic head is a following token inside the
                        same span is a noun phrase, not a name ("Ruhige Finca",
                        from a fetched holiday listing — the parser itself says
                        Ruhige/ADJ, Case=Nom, head=Finca). Guard 4 cannot stop
                        it: web pages capitalise product and place phrases, the
                        head noun tags PROPN, and one PROPN keeps the span. The
                        Case requirement is what scopes this to German attributive
                        declension — English adjectives carry no Case, so a
                        nickname like "Big John" never triggers it; an OOV token
                        claiming ADJ is tagger ignorance and keeps (fail-open).

    Fail-open: if POS tags are unavailable (no doc) or the span can't be resolved,
    guards 4 and 5 are skipped; the cheaper denylist / digit / caps guards still run.
    """
    if _is_non_name(value):
        return False
    if has_name_hostile_punctuation(value):
        return False
    if any(ch.isdigit() for ch in value):
        return False
    # A real name never contains an underscore — drops identifier-shaped tokens
    # ("HF_TOKEN", env-var / code names), found via the real-world prompt eval.
    if "_" in value:
        return False
    # Capitalisation guard (works without a POS doc): a German name always has a
    # capitalised token. Drops lowercase mistags and all-lowercase word runs.
    # Skipped for the LLM path (require_capitalization=False) — see guard 3 above.
    word_tokens = value.split()
    if require_capitalization and word_tokens and not any(w[:1].isupper() for w in word_tokens):
        return False
    if not (settings.ner_person_pos_filter and doc is not None):
        return True
    try:
        span = doc.char_span(start, end, alignment_mode="expand")
    except Exception:
        return True
    if span is None:
        return True
    tokens = [t for t in span if not t.is_punct and not t.is_space]
    if not tokens:
        return True
    # Require at least one proper-noun token anywhere in the span.
    if not any(t.pos_ in _NAME_POS for t in tokens):
        return False
    # Guard 5 — see the docstring. By head POSITION, not dep label: the de model
    # uses TIGER labels (nk), UD models use amod; token order is scheme-free.
    tok0 = tokens[0]
    if (
        tok0.pos_ == "ADJ"
        and not tok0.is_oov
        and tok0.morph.get("Case")
        and tok0.head.i > tok0.i
        and tok0.head.i < span.end
    ):
        return False
    return True


# --- E1/E2 tentative predicates (2026-08-19, from the real-document eval) ----
# Both only ever mark a candidate TENTATIVE. Nothing here removes a detection by
# itself: with the LLM absent the value stays redacted, so a wrong guess here
# costs noise, never a leak.
_FORM_LABEL_PARTS = (
    "brutto", "netto", "betrag", "summe", "saldo", "entgelt", "abzug", "zuschlag",
    "beitrag", "nummer", "steuer", "sozialvers", "gesamt", "zwischensumme",
)
_FORM_LABEL_ABBREV = frozenset({
    "arbg", "arbn", "ust-id", "ustid", "zusatzbtr", "auftragsnr", "rechnungsnr",
    "kundennr", "vertragsnr", "versnr", "pers-nr", "persnr", "sv-nr", "bic", "blz",
})
_FORM_LABEL_PREFIX = ("rv-", "av-", "pv-", "kv-", "st-", "ust-")


def _looks_like_form_label(value: str) -> bool:
    """True for German business-document field labels that are not people."""
    v = value.strip().lower()
    if v in _FORM_LABEL_ABBREV:
        return True
    if any(v.startswith(p) for p in _FORM_LABEL_PREFIX):
        return True
    # Multi-token label rows ("RV-Brutto AV-Brutto PV-Brutto"): every token must
    # END in a label morpheme. Suffix, not substring, and hyphens are NOT split:
    # a substring test flagged the plausible surname "Bruttoreich", and splitting
    # on "-" broke the very row this exists for ("rv" carries no morpheme).
    tokens = v.split()
    if not tokens:
        return False
    return all(t.endswith(_FORM_LABEL_PARTS) for t in tokens)


_OCR_DAMAGE_CHARS = frozenset("\ufffd@#*|~^\\<>{}[]_")


def _looks_ocr_damaged(value: str) -> bool:
    """True for strings carrying textual damage rather than a name."""
    v = value.strip()
    if not v:
        return False
    if any(c in _OCR_DAMAGE_CHARS for c in v):
        return True
    if v.endswith("-") or v.startswith("-"):
        return True
    return False


# Surname particles that legitimately glue two capitalised parts together. This
# is a list of MORPHEMES, not of names: it is closed, it is small, and it does
# not grow when the world invents another surname — which is exactly what a
# gazetteer would have to do.
_NAME_PARTICLES = ("mc", "mac", "de", "del", "della", "di", "du", "da", "van",
                   "von", "le", "la", "st")


def is_code_identifier(text: str) -> bool:
    """Is this token a CODE IDENTIFIER (``personOnSite``) rather than a name?

    Technical documents are full of camelCase, and a zero-shot detector reads
    them as people: measured on a real substation-modelling document,
    ``personOnSite`` 0.67 and ``PersonOnSite`` 0.93 — while the SAME document's
    plain-English "a person" was correctly dropped by the grammar guard. Worse,
    detections are value-keyed, so one surviving ``personOnSite`` highlighted
    every occurrence of "person" in the document.

    The tagger is no help: ``personOnSite`` is NOUN + out-of-vocabulary and
    ``PersonOnSite`` is PROPN + OOV, so both of this predicate's rescue branches
    fire on them. OOV in particular means nothing here — an identifier is
    out-of-vocabulary by construction.

    Shape decides, and only shapes no human name has:

      - a lowercase initial followed by an internal capital (``personOnSite``,
        ``bayLocked``) — no name is written that way, so this is free;
      - three or more capitalised segments glued together (``PersonOnSite``);
      - two glued segments (``BayLocked``) UNLESS the token opens with a surname
        particle — ``McDonald``, ``MacLeod``, ``DeVries``, ``LaFleur`` survive;
      - an ALL-CAPS run running into a lowercase word (``IOPoint``);
      - letters glued to digits (``KE101``), or an underscore.

    ``O'Brien`` never reaches the particle test: the capital follows an
    apostrophe, not a lowercase letter, so it has no camel hump at all.
    """
    if not text or " " in text:
        return False
    if "_" in text and any(c.isalpha() for c in text):
        return True
    if any(c.isalpha() for c in text) and any(c.isdigit() for c in text):
        return True
    # Acronym glue: an ALL-CAPS run running straight into a lowercase word —
    # "IOPoint", "HTTPServer", "XMLParser". The hump test below cannot see this
    # shape, because the capital that starts the second word is preceded by
    # another capital, not by a lowercase letter.
    if any(
        text[i - 2].isupper() and text[i - 1].isupper() and text[i].islower()
        for i in range(2, len(text))
    ):
        return True
    humps = [i for i in range(1, len(text)) if text[i].isupper() and text[i - 1].islower()]
    if not humps:
        return False
    if text[0].islower():
        return True
    if len(humps) + 1 >= 3:
        return True
    lowered = text.lower()
    if any(lowered.startswith(prefix) for prefix in _NAME_PARTICLES):
        return False
    return True


def document_is_mixed_case(text: str) -> bool:
    """Does this document distinguish case at all?

    `require_capitalization` is switched OFF on the zero-shot path for a real
    reason: GLiNER runs on all-lowercase text too, where a genuine name is
    legitimately lowercase, and applying a capitalisation guard there would
    DROP the name and leak it. But that reason only holds for documents that
    have no casing to read. In a document that capitalises normally, a
    lowercase common noun is not a name — and that is the ordinary case.

    Measured, so the threshold is not a guess: across the AI4Privacy sample and
    the ECHR judgments every document sits far from 5% uppercase-initial words
    on one side or the other, so nothing real lands near the boundary.
    """
    words = [w for w in text.split() if w[:1].isalpha()]
    if len(words) < 12:
        # Too little evidence to read the casing — so DO NOT arm the guard.
        # The first cut returned True here and the suite caught it instantly:
        # "anna müller wohnt in berlin und ruft morgen an." is eight words, was
        # read as a capitalising document, and the real lowercase name was
        # dropped. A guard that can delete a detection fails OPEN on
        # uncertainty; anything else turns a short message into a leak.
        return False
    upper = sum(1 for w in words if w[0].isupper())
    return upper / len(words) >= 0.05


def strip_leading_common_nouns(value: str, start: int, doc) -> str:
    """"Beispiel-Meilensteine Jonas" -> "Jonas". Span hygiene, not a veto.

    GLiNER's span sometimes fuses a preceding compound noun onto a real name —
    measured on a founders' term sheet, where the fused span then repaints the
    compound everywhere it occurs (detections are value-keyed). The NAME must
    stay redacted; only the prefix has to go.

    Drops leading NOUN tokens while a PROPN or OOV token remains later in the
    span. OOV leading tokens are strippable too — hyphen compounds are OOV by
    construction — which is exactly why THE CALLER must only accept a strip
    when the resulting name already exists as its own PERSON detection:
    "Paul-Heinz Müller" must never lose its "Paul-Heinz" unless "Müller" was
    independently detected, because a wrong strip here is a LEAK, not an
    annoyance. This function proposes; the existence check disposes.
    """
    if doc is None or " " not in value:
        return value
    try:
        span = doc.char_span(start, start + len(value), alignment_mode="expand")
        if span is None:
            return value
        toks = [t for t in span if not t.is_punct and not t.is_space]
        if len(toks) < 2:
            return value
        keep_from = 0
        for i, t in enumerate(toks):
            rest = toks[i + 1:]
            if (
                t.pos_ == "NOUN"
                and any(r.pos_ == "PROPN" or r.is_oov for r in rest)
            ):
                keep_from = i + 1
                continue
            break
        if keep_from == 0:
            return value
        new_start = toks[keep_from].idx
        stripped = value[new_start - start:].strip()
        return stripped or value
    except Exception:  # noqa: BLE001 — hygiene must never break the scrub
        return value


# An honorific token directly before a span ("Frau", "Dr.", "Herr") — same
# vocabulary as the regex net and GLiNER's title strip, so they cannot drift.
_TITLE_BEFORE_RE = re.compile(rf"^{TITLE_PATTERN}$")

#: spaCy NER labels that mean "the second model reads this span as a person".
_SPACY_PERSON_LABELS = frozenset({"PER", "PERSON"})


def _is_common_noun_phrase(span, tokens, doc, score: float | None = None) -> bool:
    """Is a multi-word zero-shot PERSON span only ordinary common nouns?

    The false positive this exists for (beta feedback, GitHub #89): the German
    prompt "... mit Kita Kind und iga Magen ..." — "Kita Kind" is "daycare
    child", two capitalised common nouns, and GLiNER scores it a person at
    0.83. Every other guard misses it: no article inside the span, no plural,
    nothing hostile in the punctuation, and the tagger does not call either
    word a name (both NOUN, neither PROPN, neither out-of-vocabulary).

    What separates it from a real two-word name is that EVERY independent
    signal agrees it is not one, and the verdict needs all of them:

      - every token is tagged NOUN (we are past the PROPN rescue, so none is a
        PROPN — but a PUNCT-only / NUM / ADJ member is not "a noun phrase of
        nouns" and stays out of scope);
      - every token is an ordinary WORD: its LOWERCASE form is in the model's
        vocabulary. German capitalises all nouns, so the capitalised form says
        nothing — but a rare given name or surname ("Kriemhild", "Nermin",
        "Rörricht") is not attested in lowercase, while "kita" and "kind" are;
      - the detector itself is not sure: its score is below
        ``settings.gliner_common_noun_max_score`` (0.90). Real names score
        ~1.0, this false positive 0.83. An UNKNOWN score (None) disables the
        guard — it only acts on a confidence it can read;
      - spaCy's own NER does not call the span a person (here it reads
        "Kita Kind" as MISC); and
      - no honorific sits right before it ("Frau Kind" is a person whatever
        the tagger thinks).

    Recall-safe by construction: a CONJUNCTION of negative signals that only
    ever removes a GLiNER-only claim (NER and the regex net are unioned in
    separately). Measured on 19 208 Faker name occurrences (4 802 de_DE/en_US
    names x 4 carrier sentences each, tagged by the real models): without the
    score interlock ONE occurrence was vetoed ("Romana Schleich", in a contract
    sentence where the tagger read both words as NOUN and spaCy as ORG); GLiNER
    scored it 1.00, so with the interlock the sweep vetoes none. Every
    uncertainty keeps: no score, no vocab, an odd tokenisation -> the span stays.
    """
    try:
        if score is None or score >= settings.gliner_common_noun_max_score:
            return False
        if len(tokens) < 2:
            return False
        if any(t.pos_ != "NOUN" or not t.is_alpha for t in tokens):
            return False
        vocab = doc.vocab
        if not all(vocab.has_vector(t.lower_) for t in tokens):
            return False
        if any(
            e.label_ in _SPACY_PERSON_LABELS
            and e.start_char < span.end_char
            and e.end_char > span.start_char
            for e in doc.ents
        ):
            return False
        prev = doc[span.start - 1] if span.start > 0 else None
        if prev is not None and _TITLE_BEFORE_RE.match(prev.text):
            return False
        return True
    except Exception:  # noqa: BLE001 — a guard must never break the scrub
        return False


def zero_shot_person_ok(
    value: str,
    start: int,
    end: int,
    doc,
    mixed_case: bool = True,
    score: float | None = None,
) -> bool:
    """Is a ZERO-SHOT detector's PERSON claim grammatically a name? Fail-open.

    GLiNER labels role nouns and pronouns as people, confidently — measured on a
    real notarial contract: "Der Notar" 0.93, "Käufer" 0.87, "du" 0.97, against
    "Jonas" 0.97. No threshold and no label phrasing separates them ("full name"
    drops the FPs and every real name with them). Published GLiNER evaluations
    name the same weakness — common nouns as entities — and the published fix is
    a structural post-filter, which is what this is.

    _keep_person's PROPN guard is the wrong tool here: it reads the tagger's
    IGNORANCE as "not a name" and cost 13 real corpus names on first contact
    ("Rörricht", "Möchlichen", "Miodrag" — NOUN-tagged, because the tagger does
    not know them). This predicate instead asks for GRAMMATICAL EVIDENCE OF
    ROLE-NESS before it vetoes, and keeps otherwise:

      drop  — a PLURAL noun            ("Studierende", "attendees")
      drop  — all-lowercase, in a document that capitalises normally
      drop  — name-hostile punctuation ("MCCS/" — a path segment)
      drop  — a code identifier        ("personOnSite", "PersonOnSite" — both
                                         rescues below fire on these, so this
                                         test must come first)
      drop  — an article inside the span ("A Lamp" — a noun phrase, not a name)
      keep  — any PROPN token          (the tagger recognises a name)
      keep  — any OOV token with letters (the tagger recognises nothing — names
              are exactly the words a vocabulary lacks; hyphen-safe on purpose,
              "Paul-Heinz" is one OOV token and `is_alpha` would exclude it)
      drop  — any PRON token           ("du", "ihr" — never identifiers)
      drop  — a NOUN carrying a `det`  ("Der Notar", "dem Käufer", "meiner
              child in the parse         Mutter", "Die verbleibenden
                                         Gesellschafter" — German role nouns
              take an article; names do not. The det child is found through the
              PARSE, so it works when the article sits outside GLiNER's span.)
      keep  — everything else          (fail-open: "Kriemhild Lindner" — two
              in-vocabulary NOUNs, no article — stays redacted)
    """
    # Characters no name contains. Checked on the RAW value, before tokenising,
    # because the tokeniser drops punctuation and takes the evidence with it:
    # "MCCS/" tokenises to a bare PROPN "MCCS" and sails through. Path and
    # markup punctuation is what separates a path segment from a person.
    if has_name_hostile_punctuation(value):
        return False
    if doc is None:
        return True
    try:
        span = doc.char_span(start, end, alignment_mode="expand")
    except Exception:  # noqa: BLE001 — a guard must never break the scrub
        return True
    if span is None:
        return True
    tokens = [t for t in span if not t.is_punct and not t.is_space]
    if not tokens:
        return True
    # BEFORE the rescues, not after: both of them fire on a code identifier
    # (PROPN for PascalCase, OOV for every shape of it), so a check placed
    # after them can never run.
    if any(is_code_identifier(t.text) for t in tokens):
        return False
    # An article INSIDE the span is the detector telling on itself: it matched a
    # noun phrase, not a name. "A Lamp" (0.77), "The Breaker" — English tech
    # prose capitalises component nouns, so the PROPN rescue cannot separate
    # them, but no name is spanned together with its own article.
    if tokens[0].pos_ == "DET":
        return False
    # The RESCUES run before the morphological tests below, deliberately. Both
    # of those read the tagger's output about words it may not know, and the
    # rescues are what stop that being read as "not a name".
    if any(t.pos_ in _NAME_POS for t in tokens):
        return True
    if any(t.is_oov and any(c.isalpha() for c in t.text) for t in tokens):
        return True
    if any(t.pos_ == "PRON" for t in tokens):
        return False
    if _is_common_noun_phrase(span, tokens, doc, score):
        return False
    # A PLURAL common noun is not one person: "Studierende", "Rentner",
    # "Kunden", "attendees", "Participants", "volunteers" all tag
    # NOUN/Number=Plur.
    #
    # EVERY noun in the span must be plural, and the corpus is why. "Kriemhild
    # Lindner" tags Sing + Plur — the tagger reads the surname as plural, and
    # it is IN-VOCABULARY, so an out-of-vocabulary condition does not save it
    # either. A first version using `any` dropped it, and it is the very name
    # this predicate's docstring cites as the fail-open case. A personal name
    # pairs a given name with a surname, so a singular noun anywhere in the
    # span means the span is a name; a role noun stands alone.
    nouns = [t for t in tokens if t.pos_ == "NOUN"]
    if nouns and all("Plur" in t.morph.get("Number") for t in nouns):
        return False
    # In a document that capitalises normally, a lowercase common noun is not a
    # name: "staff", "volunteers", "parents". Conditioned on the DOCUMENT's own
    # casing, which is what makes it safe to apply at all — see
    # document_is_mixed_case, and note it fails OPEN on short text.
    if mixed_case and not any(t.text[:1].isupper() for t in tokens):
        return False
    for t in tokens:
        if t.pos_ in ("NOUN", "ADJ", "DET"):
            if t.pos_ == "DET":
                return False
            # By the CHILD'S POS, not the dep label: the de model uses TIGER
            # labels, where an article attaches as "nk", not UD's "det" —
            # checked on the live sentence ("Dem Käufer wird … erteilt":
            # Käufer's child Dem is DET/nk). POS is scheme-independent.
            if any(ch.pos_ == "DET" for ch in t.children):
                return False
    return True


def pos_doc(text: str, language: str):
    """Parsed spaCy doc for POS filtering, or None. Never raises.

    detect_ner() builds a doc only when SPACY ITSELF proposed a PERSON. GLiNER
    proposes people spaCy never saw — on "Der Notar beurkundet" spaCy returns
    nothing at all — so the doc has to be obtainable independently, or GLiNER's
    candidates bypass the PROPN guard entirely. Which is exactly what happened:
    role nouns and pronouns shipped as PERSON.
    """
    if not settings.ner_person_pos_filter:
        return None
    lang = language if language in ("de", "en") else "de"
    nlp = _get_nlp(lang)
    if nlp is None:
        return None
    try:
        return nlp(text)
    except Exception as exc:  # noqa: BLE001 — a guard must never break the scrub
        logger.warning("POS tagging failed (lang=%s): %s — POS filter skipped", lang, exc)
        return None


def detect_ner(text: str, language: str) -> list[dict]:
    """Run spaCy/Presidio NER and return ``{type, value, score}`` dicts.

    Only curated, mappable entity types are returned (see ``_PRESIDIO_TO_QUON``).
    PERSON candidates are additionally filtered (POS + denylist) to drop
    capitalized-verb false positives, and are suppressed entirely on all-lowercase
    input (casing is NER's main signal — names are deferred to the LLM there).
    Returns ``[]`` if NER is disabled or the engine is unavailable.
    """
    if not settings.ner_enabled:
        return []
    analyzer = _get_analyzer()
    if analyzer is None:
        return []

    lang = language if language in _SUPPORTED_LANGUAGES else "en"
    try:
        results = analyzer.analyze(text=text, language=lang)
    except Exception as exc:
        logger.warning("NER analyze failed (lang=%s, text_len=%d): %s", lang, len(text), exc)
        return []

    # No case signal (all lowercase) -> NER PERSON is unreliable; defer names to
    # the LLM enrichment layer and keep only the structured (pattern) detections.
    keep_person = not (
        settings.ner_person_require_case_signal and not any(c.isupper() for c in text)
    )

    # Build the POS doc once per call, only if a PERSON candidate needs filtering.
    doc = None
    if (
        keep_person
        and settings.ner_person_pos_filter
        and any(r.entity_type == "PERSON" for r in results)
    ):
        nlp = _get_nlp(lang)
        if nlp is not None:
            try:
                doc = nlp(text)
            except Exception as exc:
                logger.warning("POS tagging failed (lang=%s): %s — skipping POS filter", lang, exc)

    detected: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for res in results:
        quon_type = _PRESIDIO_TO_QUON.get(res.entity_type)
        if quon_type is None:
            continue
        if quon_type == "PERSON" and not keep_person:
            continue
        value = text[res.start : res.end].strip()
        if not value:
            continue
        # Presidio's PhoneRecognizer validates dotted dates ("30.05.2028") as
        # phones — found via the real-world prompt eval. Shared guard with the
        # fallback safety net (fallback.looks_like_date).
        if quon_type == "PHONE" and looks_like_date(value):
            continue
        if quon_type == "PERSON":
            # Shrink glued-on junk at the span edges FIRST ("bin Timo" →
            # "Timo", "Ja Preis" → "Preis"), then run the normal guards on
            # the core. The POS check below still uses the ORIGINAL offsets —
            # the wider char_span still contains the name token, so the
            # at-least-one-PROPN requirement is unaffected.
            value = _trim_person_edges(value)
            if not value:
                continue
        if quon_type == "PERSON" and not _keep_person(value, res.start, res.end, doc):
            continue
        # Ambiguous food/plant words that are also surnames (Millet, Sweet, Berry…):
        # drop only with a non-name signal — a directly-following number (a table row
        # like "Millet 16", heuristic B). Otherwise flag as "tentative" so the LLM
        # veto (A, applied in scrubber._merge) can decide. Recall-first: with neither
        # signal the name stays redacted.
        tentative = False
        if quon_type == "PERSON" and value.lower() in AMBIGUOUS_TERMS:
            if re.match(r"\s*[:=\-]?\s*\d", text[res.end : res.end + 8]):
                continue
            tentative = True
        # German street/square/avenue/lane compounds (Rehbergplatz, Bahnhofstraße…)
        # that either spaCy model or the LLM can mistag PERSON — defense-in-depth
        # alongside the language-detection fix (4aaac34), which addressed the root
        # cause (wrong model) but not this class of token surviving under the
        # RIGHT model too. No digit-heuristic here (unlike AMBIGUOUS_TERMS above):
        # a trailing house number ("Rehbergplatz 5") is not a reason to hard-drop
        # OR to un-suppress — it stays tentative either way, same as with no number
        # at all. Recall-first: a real surname that happens to end in one of these
        # (vetted in STREET_SUFFIXES — none does) would stay redacted by default;
        # only an explicit LLM NOT_NAME veto removes it.
        if quon_type == "PERSON" and _has_street_suffix(value):
            tentative = True
        # Tech/product and medical-eponym homographs (Kafka, Claude, Matrix,
        # Hashimoto, Dunning…) — real names that in casual chat are far more
        # often terms (see ner_gazetteer.TENTATIVE_TECH_EPONYMS). ANY-token so
        # the multi-token eponym span ("Dunning Krüger") is covered via its
        # safe token without listing the common surname "Krüger" itself.
        # Tentative only: the LLM veto decides; config-1 behaviour unchanged.
        if quon_type == "PERSON" and any(
            t in TENTATIVE_TECH_EPONYMS for t in value.lower().split()
        ):
            tentative = True
        # E1 (2026-08-19): German business-document field LABELS that spaCy reads
        # as surnames — "Gesamtbrutto", "RV-Brutto AV-Brutto PV-Brutto", "Zusatzbtr",
        # "Arbg", "Ust-Id", "Auftragsnr". Found by running the net over 45 real
        # documents: the largest PERSON false-positive class there, and one the LLM
        # can plainly recognise but had no channel to report, because the veto only
        # ever reaches values NER marked tentative. This does not drop anything on
        # its own — with no LLM the label stays redacted, same recall-first rule as
        # every other tentative.
        if quon_type == "PERSON" and _looks_like_form_label(value):
            tentative = True
        # E2: OCR damage. Scanned pages produce fragments that are not words in any
        # language ("Ornnl\ufffdbury", "Anna Kopp@nbpry", "Jah-"). A replacement
        # character, an embedded symbol, or a dangling hyphen is textual damage, not
        # a name. Tentative, not a drop: a damaged string could still BE someone's
        # name, so only the LLM may clear it.
        if quon_type == "PERSON" and _looks_ocr_damaged(value):
            tentative = True
        key = (quon_type, value.lower())
        if key in seen:
            continue
        seen.add(key)
        entry = {"type": quon_type, "value": value, "score": float(res.score)}
        if tentative:
            entry["tentative"] = True
        detected.append(entry)
    return detected
