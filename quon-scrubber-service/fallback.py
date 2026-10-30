"""Deterministic safety-net / fallback detection.

Runs alongside the LLM (safety net) and also serves as the Ollama-down fallback.
Covers the high-confidence, regex-friendly PII types:
  - EMAIL / PHONE / IBAN via Presidio's pattern recognizers
  - FINANCIAL_AMOUNT via a local currency regex (toggle: SAFETY_NET_AMOUNTS)

The Presidio recognizers are invoked *directly* — no ``AnalyzerEngine`` and no
spaCy NLP engine is ever constructed, so no NER model is loaded. ``presidio-
analyzer`` pulls spaCy in transitively, but this module never imports or runs it.
"""

from __future__ import annotations

import logging
import re

from config import settings

logger = logging.getLogger("quon.fallback")

FALLBACK_LOG_MESSAGE = (
    "QUON fallback mode active – deterministic patterns only (EMAIL/PHONE/IBAN/BETRAG)"
)

# Map Presidio entity labels -> QUON entity types.
_PRESIDIO_TO_QUON = {
    "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE",
    "IBAN_CODE": "IBAN",
}

# --- Currency-amount detection -------------------------------------------
# A number adjacent to a currency symbol/word (either order), with an optional
# magnitude word. Deterministic, so amounts are never missed by the small model
# — at the cost of also redacting public figures (e.g. a company's revenue).
_CURRENCY = (
    r"€|\$|£|¥|\bEUR\b|\bUSD\b|\bGBP\b|\bCHF\b|\bEuro\b|\bDollars?\b|\bPfund\b|\bFranken\b"
)
# Grouped form REQUIRES a thousands separator ((?:[.,]\d{3})+), so a plain number
# like "8045" falls to the second alternative and matches in full — otherwise
# \d{1,3} grabbed only "804", the span missed the word boundary, and the amount
# wasn't redacted at all (a leak). The order also matters: try the grouped form first.
_NUMBER = r"\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?"
_MAGNITUDE = (
    r"(?:\s?(?:Milliarde(?:n)?|Million(?:en)?|billion|million|thousand|"
    r"Mrd\.?|Mia\.?|Mio\.?|Mill\.?|Tsd\.?|Tausend|[kKmMbB]\b))?"
)
_AMOUNT_RE = re.compile(
    rf"(?:(?:{_CURRENCY})\s?(?:{_NUMBER}){_MAGNITUDE}"  # $320,000 / €20 million
    rf"|(?:{_NUMBER}){_MAGNITUDE}\s?(?:{_CURRENCY}))",  # 145.000 € / 2,3 Mio. €
    re.IGNORECASE,
)

# --- Phone supplement (recall-first) -------------------------------------
# Presidio's PhoneRecognizer VALIDATES numbers (real NANP area codes etc.), so a
# clearly phone-shaped string with an unassigned area code slips through. A privacy
# tool should redact anything phone-shaped. This tight North-American-style pattern
# (optional +cc, optional parens, 3-3-4 grouped WITH separators) catches those while
# staying FP-safe: it needs the grouped structure, so IPs/versions/IDs don't match.
_PHONE_SUPPLEMENT_RE = re.compile(
    r"(?<![\w])(?:\+\d{1,3}[ ]?)?\(?\d{3}\)?[ .\-/]\d{3}[ .\-/]\d{4}(?![\w])"
)

# A dotted German/European DATE is not a phone number. Presidio's
# PhoneRecognizer happily validates "30.05.2028" as a phone (found via the
# real-world prompt eval — two of its three PHONE detections were dates), so
# every PHONE candidate is checked against this shape before being emitted.
# Deliberately narrow: exactly day.month.year with nothing else in the value —
# a real phone number never consists of exactly two dots separating 1-2/1-2/2-4
# digit groups, so this cannot suppress a genuine phone. Shared with ner.py
# (its Presidio engine has the same failure mode).
# The dotted German date, unanchored so it can also be DETECTED and not merely
# excluded from PHONE. That distinction was a real hole: `looks_like_date` existed
# only to keep "30.05.2028" from being emitted as a phone number, and nothing ever
# emitted it as a DATE. Measured 2026-08-19 over 45 real German documents
# (insurance, invoices, medical, utilities): dd.mm.yyyy was the single most common
# identifier shape at 126 occurrences, and config 1 detected NONE of them. The
# synthetic corpus never showed it because the cloud LLM was quietly covering the
# form — so it leaked exactly on the degraded path, where the net is all there is.
#
# Both groups are capped at two digits and the year at 2 or 4, which is what keeps
# version strings ("1.2.3"), section numbers ("§ 5.2.1") and grouped amounts
# ("1.234.567") out: each fails on a group that is too long or a 1-digit year.
_DOTTED_DATE = r"\b\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})\b"
_DOTTED_DATE_RE = re.compile(_DOTTED_DATE)
_DATE_NOT_PHONE_RE = re.compile(rf"^\s*{_DOTTED_DATE}\s*$".replace(r"\b", ""))


def looks_like_date(value: str) -> bool:
    """True if ``value`` is exactly a dotted date ("30.05.2028") — see above."""
    return bool(_DATE_NOT_PHONE_RE.match(value))


# --- Titled-name supplement (recall-first) -------------------------------
# The German spaCy model (de_core_news_md) routinely fails to tag a bare
# title+surname span as a PERSON at all ("Herr Sandberg", "Frau Steinweg" → []),
# so those names leak whenever the LLM enrichment layer is ALSO unavailable
# (outage / budget / rate-limit) — a confirmed production gap. An honorific is
# strong, deterministic evidence that the following capitalized token is a
# person's name, so we redact it here: always-on, model-independent, same tier as
# the phone/amount supplements (no cloud dependency). Only the NAME is captured
# (the honorific stays visible — it isn't PII), mirroring how NER trims
# "CEO Kapferer" → "Kapferer". Requiring a Capitalized name keeps precision
# reasonable; genuinely lowercase names remain the LLM's job (casing is NER's own
# main signal). One or two name tokens cover "Frau Müller" and "Frau Anna Müller".
_TITLED_NAME = r"[A-ZÄÖÜ][a-zäöüß]+(?:[-'][A-ZÄÖÜ][a-zäöüß]+)?"
# Full-word honorifics take NO trailing period (keeping it out avoids matching a
# sentence-final "… den Herr. Dann …"); abbreviations may carry one. Repeatable so
# "Prof. Dr. Müller" resolves to the trailing name.
_TITLE = r"(?:Herr|Frau|Mister|Madam|(?:Dr|Prof|Mr|Mrs|Ms|Mx)\.?)"

#: Public alias — other detectors need the SAME title vocabulary rather than a
#: second, drifting copy. GLiNER spans "Herr Sandberg" as one PERSON and has to
#: trim the honorific back off: the title is not PII and removing it makes the
#: redacted sentence unreadable ("[PERSON] wohnt…" instead of "Herr [PERSON] wohnt…").
TITLE_PATTERN = _TITLE
# German academic qualifiers sit BETWEEN the title and the name ("Dr. med. Stefan
# Weber", "Prof. Dr. rer. nat. Ada Lovelace"). They are lowercase, so the name
# pattern cannot match them and the whole span was skipped — the golden-58 on
# 2026-08-19 had exactly this as a real miss, on the one case where an honorific
# was followed by a qualifier. The qualifier is consumed, never emitted: the
# honorific deliberately STAYS in the output (it is not PII, and
# test_titled_name_redacted_end_to_end_without_llm asserts it) — only the NAME is
# redacted.
_TITLE_QUALIFIER = r"(?:med|rer|nat|phil|jur|oec|h\.c|habil|Ing|LL\.M|MBA)\.?"
_TITLED_NAME_RE = re.compile(
    rf"\b(?:{_TITLE}\s+)+(?:{_TITLE_QUALIFIER}\s+)*"
    rf"(?P<name>{_TITLED_NAME}(?:\s+{_TITLED_NAME})?)"
)

# --- Address supplement (deterministic, recall-first) --------------------
# Positive ADDRESS detection, model-independent (so an address is redacted even
# with the LLM offline). Two shapes cover the common German cases:
#   1. street name + house number: a Capitalized single-word street ending in a
#      street suffix (broad set — over-redacting an address is acceptable, unlike
#      PERSON suppression which needs the surname-safe narrow STREET_SUFFIXES),
#      then a 1-4 digit house number with an optional letter ("Bahnhofstraße 12",
#      "Rehbergplatz 5a", "Rosenweg 3"). Multi-word streets ("Unter den Linden 7")
#      are deliberately left to the LLM — an optional leading word here would
#      wrongly swallow the preceding word ("Wohnhaft Rehbergplatz 5a").
#   2. postal code + city: a German 5-digit PLZ followed by a Capitalized city
#      ("12345 Berlin", "80331 München").
# House number / PLZ are REQUIRED so a bare street word or city never matches.
# --- Spelled-out dates ------------------------------------------------------
# The DOTTED form (30.05.2028) was already deterministic; the written form was
# left to the LLM. The 2026-08-19 golden-58 comparison showed why that is not
# safe: 5 of a 7B model's 11 leaks were exactly this shape, in BOTH languages
# ("15. April 2025", "March 14th", "June 5th 2025", "1. April", "12. März 2025"),
# while the 24B caught them. A privacy guarantee that depends on whether a model
# felt like emitting a date is not a guarantee — so it moves into the net, where
# it holds for every model and with the LLM off entirely.
#
# Case-sensitive on purpose: lowercase "may"/"march" are ordinary English words,
# and every pattern requires an adjacent day number, so prose does not match.
def month_words() -> tuple[str, ...]:
    """The month vocabulary the net already carries, lowercased.

    Exposed so callers do not re-declare it. Months and weekdays are a CLOSED
    class per language — unlike a gazetteer of names or role nouns, this list
    cannot grow.
    """
    return tuple(
        w.lower()
        for group in (_DE_MONTHS, _EN_MONTHS)
        for w in group.split("|")
    )


_DE_MONTHS = (
    "Januar|Februar|März|Maerz|April|Mai|Juni|Juli|August|September|Oktober|"
    "November|Dezember"
)
_EN_MONTHS = (
    "January|February|March|April|May|June|July|August|September|October|"
    "November|December"
)
_SPELLED_DATE_RE = re.compile(
    rf"\b\d{{1,2}}\.\s*(?:{_DE_MONTHS})(?:\s+\d{{4}})?"
    rf"|\b(?:{_EN_MONTHS})\s+\d{{1,2}}(?:st|nd|rd|th)?(?:,?\s+\d{{4}})?"
    rf"|\b\d{{1,2}}(?:st|nd|rd|th)?\s+(?:{_EN_MONTHS})(?:,?\s+\d{{4}})?",
    re.UNICODE,
)

# --- Insurance / health-insurance identifiers -------------------------------
# Prefixed German forms (VN-2024-88421, KV-98234-A-7) — both were leaked by
# the 7B and caught by the 24B, back when an LLM tier existed.
_INSURANCE_ID_RE = re.compile(r"\b(?:VN|VNR|KV|KVNR|VS)-[A-Z0-9]{2,}(?:-[A-Z0-9]+)*\b")

# The bare KVNR shape ([A-Z] + 9 digits) was originally left out because "it
# collides with order and tracking numbers, and the model already catches it".
# The second half died with the LLM tier (2026-08-23): re-measured 2026-09-04,
# an unlabelled bare KVNR in German prose leaks through the whole current
# pipeline. The first half is answered STRUCTURALLY instead of with context
# vocabulary: the KVNR's own check digit (§ 290 SGB V, GKV Anlage 1
# 2023-01-02 — letter as two digits A=01..Z=26, weights 1,2 alternating from
# the left, two-digit products digit-summed, sum mod 10). A random
# letter+9-digit order number passes that gate 1 time in 10, so the collision
# class shrinks 10× while every real KVNR — which must validate by law —
# still matches.
_BARE_KVNR_RE = re.compile(r"\b[A-Z]\d{9}\b")


def kvnr_checksum_ok(value: str) -> bool:
    """True if a bare [A-Z]+9-digit candidate carries a valid KVNR check digit."""
    ten = f"{ord(value[0]) - 64:02d}{value[1:9]}"
    total = 0
    for i, ch in enumerate(ten):
        product = int(ch) * (1 if i % 2 == 0 else 2)
        total += product // 10 + product % 10
    return total % 10 == int(value[9])

# --- Slash dates ------------------------------------------------------------
# US/EU numeric form ("09/15/1978", "05/12/1962"). Added with the shapes below
# after the 2026-08-19 golden-58: the 24B leaked 09/15/1978, so this is not a
# small-model weakness — it was simply never deterministic. Ambiguous d/m vs m/d
# is irrelevant here: either reading is a date, and a date is what gets redacted.
_SLASH_DATE_RE = re.compile(r"\b\d{1,2}/\d{1,2}/\d{2,4}\b")

# --- Internal hostnames -----------------------------------------------------
# "confluence.intern.de/quon" was missed by BOTH models — a shared blind spot,
# which makes it a net candidate rather than a model complaint. Matches a host
# carrying an internal label (intern/internal/corp/local/lan) plus optional
# path. The host is matched, never a bare word: the same corpus case requires
# the standalone product name "QUON" to SURVIVE while the url containing /quon
# is redacted, so anything looser would fail that case from the other side.
_INTERNAL_HOST_RE = re.compile(
    # Longest alternative FIRST and a label boundary after it: with "intern"
    # leading, "wiki.internal.acme.com" matched only "wiki.intern" — alternation
    # is leftmost-first, so a shorter alternative silently truncates the host.
    r"\b(?:[a-z0-9-]+\.)+(?:internal|intern|corp|local|lan)(?![a-z0-9-])"
    r"(?:\.[a-z0-9-]+)*(?:/\S*)?",
    re.IGNORECASE,
)

# --- Labelled record identifiers --------------------------------------------
# A bare 7-digit number cannot be matched safely (order numbers, article codes),
# and that is exactly why both models walked past "MRN 7734521". The LABEL is
# what makes it safe: only the identifier is emitted, never the label itself —
# the corpus case requires "MRN" to still be readable in the output.
# E4 (2026-08-19): the real-document eval left 87 long bare digit runs unmatched.
# Matching bare digits was REJECTED — an 8-digit number is as plausibly an article
# number, a meter reading or an amount as an identifier, and this net already
# redacts enough. The safe lever is the LABEL vocabulary: German paperwork names
# its identifiers, and the label is what makes the number unambiguous. Widened
# from 8 labels to the set that actually appears in insurance, banking, payroll,
# tax and utility documents. group(1) only — the label must stay readable.
_LABELLED_ID_RE = re.compile(
    # MORPHEME, not vocabulary. The first version listed ~30 label words read out
    # of 45 real documents. Measured against a holdout the author never inspected,
    # that list covered 5.4% of label+identifier constructions on the tune set and
    # 6.5% on the holdout — so it did NOT overfit, it simply never scaled: 96
    # distinct label words appear across 45 documents, and German compounds make
    # more on demand ("Vertragskontonummer", "Mandantennummer").
    #
    # CASE-SENSITIVE on purpose. German labels are capitalised nouns, and the
    # identifier must start uppercase/digit — with IGNORECASE the continuation
    # group swallowed ordinary following words ("Kundennummer 4711 bitte" -> "4711
    # bitte"). "id" is not a bare suffix either: "David 12345" would match.
    #
    # Up to two space-separated continuation groups, because real identifiers
    # contain spaces — "Kennzeichen B-XY 1234", "Aktenzeichen 12 O 345/24".
    # Capturing only the first group is worse than missing the whole thing: the
    # entity list shows a hit while the tail stays in the clear.
    r"\b(?:"
    r"[A-ZÄÖÜ][a-zäöüß]{2,}(?:nummer|nr|kennzeichen|zeichen|konto|kennung)"
    r"|Nr|MRN|Police|[A-ZÄÖÜ][a-zäöüß]{1,}-[Ii][Dd]"
    # ENGLISH labels. The rule was German-only, which is a bilingual-product
    # defect rather than a corpus quirk: "Account: 000123456789" and
    # "API key: sk-live-…" carry no German morpheme, so nothing matched.
    # Lowercase-initial variants for the labels that genuinely occur mid-sentence
    # in English ("…, member ID A725…"). German labels are capitalised nouns so
    # they keep their capital; "Case"/"File"/"Ref" stay capital-only on purpose,
    # because lowercase "case 55" / "file 12" collide with ordinary prose.
    r"|[Aa]ccount|[Rr]eference|Ref|[Pp]olicy|[Mm]ember(?:ship)?|[Cc]ustomer"
    r"|[Ii]nvoice|Case|File|[Rr]outing(?:\s+number)?"
    r"|API[ -]?key|Token|Licen[cs]e|Serial"
    # HORIZONTAL whitespace only. "\s" matches a newline, so on a form layout
    # ("Angebots-Nr.: 20240110\nKunden-Nr.: …") the value group ran past the end of
    # the line and captured "20240110\nK" — a span that no longer matches the text
    # cleanly and is dropped downstream, so the identifier silently stayed in the
    # clear. A label and its value are a LINE-LOCAL construct; a newline ends them.
    r")\.?[^\S\n]*[:#\-]?[^\S\n]*"
    # First group allows a SHORT run ("Aktenzeichen 12 O 345/24" starts with two
    # digits); the label itself is the strong signal, so the identifier does not
    # need to carry the length requirement as well.
    # The continuation token must not be the first letter of an ordinary word:
    # on a merged two-column line ("Kunden-Nr.: 10023 Seite: 1 von 3") it captured
    # "10023 S" — the S of "Seite". A real identifier fragment is not followed by
    # lowercase ("B-XY 1234", "12 O 345/24" both still match).
    r"([A-ZÄÖÜ0-9][A-ZÄÖÜ0-9\-/.]{1,}"
    r"(?:[^\S\n]+[A-ZÄÖÜ0-9][A-ZÄÖÜ0-9\-/.]*(?![a-zäöüß])){0,2})",
)

# US Social Security number. A published, fixed national format — the same class
# of universal shape as an IBAN, not a pattern read off one test case. Excludes
# the ranges the SSA never issues (000/666/900-999 area, 00 group, 0000 serial),
# which is what keeps it off ordinary hyphenated numbers.
_SSN_RE = re.compile(
    r"\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b"
)

# API keys and tokens by their VENDOR-DEFINED prefix. These are documented,
# stable formats (Stripe, GitHub, Slack, AWS) — a token is a credential wherever
# it appears, label or no label, which is why this does not depend on the
# surrounding words the way the labelled-identifier rule does.
_API_KEY_RE = re.compile(
    r"\b(?:"
    r"[sprk]k_(?:live|test)_[A-Za-z0-9]{8,}"        # stripe-style, underscore
    # OpenAI ships BOTH "sk-proj-…" and a bare "sk-" + random run; requiring the
    # live/test/proj infix matched only the former, so real keys walked through.
    r"|sk-[A-Za-z0-9][A-Za-z0-9\-]{15,}"           # sk-proj-… AND bare sk-…
    r"|gh[pousr]_[A-Za-z0-9]{16,}"                  # github
    r"|xox[baprs]-[A-Za-z0-9\-]{10,}"               # slack
    r"|AKIA[0-9A-Z]{16}"                            # aws access key id
    r"|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"  # jwt
    r")\b"
)

# NAME=VALUE secret assignments — the .env / CI-variable / shell-export shape.
# This is what every secret scanner keys on, and it is orthogonal to the vendor
# prefixes above: the label declares the value is a secret even when the value
# itself has no recognisable form. Only the VALUE is captured, so "API_KEY=" stays
# readable in the placeholder text while the secret goes.
#
# Deliberately NOT extended to catch bare password-shaped strings. The corpus
# also contains values like "P@ss1234word" that carry no label and no vendor
# prefix; any regex matching those would be fitted to the generator's template
# and would fire on ordinary prose in the real world. Those are a semantic call,
# and they belong to the model tier, not here.
_SECRET_ASSIGN_RE = re.compile(
    r"\b(?:API[_ -]?KEY|SECRET(?:[_ -]?KEY)?|ACCESS[_ -]?TOKEN|AUTH[_ -]?TOKEN|TOKEN"
    r"|PASSWORD|PASSWD|PWD|CLIENT[_ -]?SECRET)"
    r"\s*[=:]\s*"
    r"[\"']?([^\s\"';,]{6,})",
    re.IGNORECASE,
)

_STREET_SUFFIX = (
    r"(?:stra(?:ß|ss)e|str\.|weg|platz|allee|gasse|ring|damm|ufer|steig|"
    r"chaussee|wall|markt|hof|graben)"
)
#: Does any token END in a street-type morpheme ("Poststraße", "Erdmannstr.",
#: "Am Marktplatz")? Public because the ADDRESS gate in scrubber.py needs the
#: SAME morphology the net uses — a second list would drift. This is the rule
#: (morpheme) side of address evidence; the digit and PROPN sides live with the
#: gate.
_STREET_NAME_TOKEN_RE = re.compile(rf"\w+{_STREET_SUFFIX}\.?$", re.IGNORECASE)


def looks_like_street_name(value: str) -> bool:
    return any(_STREET_NAME_TOKEN_RE.search(tok) for tok in value.split())


# Two shapes of German street name:
#   glued    — "Poststraße", "Erdmannstr."           (one word ending in the morpheme)
#   hyphened — "Bertha-von-Suttner-Str.", "Willy-Brandt-Platz", "Kurt-Schumacher-Damm"
# The hyphen chain starts capitalised, may contain lowercase particles (von, zu,
# van), and ends with the suffix as its OWN segment. The beta caught the gap the
# glued-only rule left: on a real pension letter only "Str. 1" was masked while
# the name-bearing "Bertha-von-Suttner-" stayed readable — the sensitive half of
# the address was exactly the half that leaked.
# The standalone suffix segment is capitalised ("-Str.", "-Platz"), unlike the
# glued form ("…straße"), so the hyphen branch scopes (?i:) to the suffix only —
# whole-pattern IGNORECASE would let "ehepartner. 1"-shaped text in.
_STREET_WORD = (
    rf"(?:[A-ZÄÖÜ][a-zäöüß]+(?:-[A-Za-zÄÖÜäöüß]+){{0,4}}-(?i:{_STREET_SUFFIX})"
    rf"|[A-ZÄÖÜ][a-zäöüß]+{_STREET_SUFFIX})"
)
# Same newline trap as the labelled-ID rule: "\s" let the postcode+city branch
# match a 5-digit CUSTOMER NUMBER at the end of one line against the capitalised
# first word of the NEXT one — "10023\nSeite" was redacted as an address, which
# both mislabelled the number and swallowed "Seite". An address sits on one line.
_ADDRESS_RE = re.compile(
    rf"\b{_STREET_WORD}[^\S\n]\d{{1,4}}(?:[^\S\n]?[a-z])?\b"
    rf"|\b\d{{5}}[^\S\n][A-ZÄÖÜ][a-zäöüß]+(?:[^\S\n][A-ZÄÖÜ][a-zäöüß]+)?\b"
)

# OCR splits an address at the last dot — "service@pension-services. de",
# "info@nuernberger. de" — and Presidio's recogniser requires "\S" throughout, so
# a scanned letterhead leaked every address on it. Real documents are scanned
# documents, so this is not an edge case.
#
# Two guards keep it from eating prose. The TLD must be LOWERCASE: German
# sentences capitalise, so "Schreib an a@b. Der Termin…" cannot end up with "Der"
# as a TLD. And only HORIZONTAL space is tolerated — a line break is a new line,
# not a split address.
_OCR_EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+\-]+[^\S\n]*@[^\S\n]*"
    r"[A-Za-z0-9\-]+(?:[^\S\n]*\.[^\S\n]*[A-Za-z0-9\-]+)*"
    r"[^\S\n]*\.[^\S\n]*[a-z]{2,24}\b"
)

#: The "PLZ Stadt" half of _ADDRESS_RE, on its own, as an ANCHOR for the street
#: line that precedes it. Kept in sync with the branch above deliberately — this
#: rule is meaningless without a confirmed postcode.
_PLZ_CITY_RE = re.compile(
    r"\b\d{5}[^\S\n][A-ZÄÖÜ][a-zäöüß]+(?:[^\S\n][A-ZÄÖÜ][a-zäöüß]+)?\b"
)

#: "Am Dünenwald 60", "Erdmannstr. 45", "Dorfstraße 3a" — a capitalised word (or
#: two, for "Am Alten Markt 4") plus a house number. NO suffix vocabulary: the
#: postcode anchor is what makes this safe, so the shape can stay general.
_STREET_LINE_RE = re.compile(
    r"(?:[A-ZÄÖÜ][a-zäöüß.\-]+[^\S\n]){1,3}\d{1,4}[a-z]?(?=[^\w]|$)"
)

#: How far back to look for the street line. One address block, not a whole form.
_STREET_LOOKBACK = 120

#: Words that begin a LAYOUT row, not a street. "Seite 1" directly above a
#: postcode line matches the street shape perfectly, and forms are full of such
#: rows. Note what this list is and is not: it is document furniture — small,
#: closed and stable — NOT a vocabulary of street names, which is the thing this
#: rule exists to avoid needing. It does not grow when Germany invents a street.
_LAYOUT_ROW_WORDS = frozenset(
    {
        "seite", "blatt", "pos", "position", "nr", "anlage", "datum", "stand",
        "tel", "telefon", "fax", "mobil", "raum", "zimmer", "kunde", "auftrag",
        "rechnung", "angebot", "konto", "betrag", "summe", "artikel", "menge",
    }
)


def _is_layout_row(candidate: str) -> bool:
    first = candidate.strip().split(" ", 1)[0].rstrip(".:").lower()
    return first in _LAYOUT_ROW_WORDS

# Lazily-instantiated recognizers (constructed on first use).
_recognizers: list | None = None
_import_failed = False


def _get_recognizers() -> list:
    global _recognizers, _import_failed
    if _import_failed:
        return []
    if _recognizers is None:
        # Imported lazily so the service starts even if presidio-analyzer is
        # not installed; the fallback path is only hit when Ollama is down.
        try:
            from presidio_analyzer.predefined_recognizers import (
                EmailRecognizer,
                IbanRecognizer,
                PhoneRecognizer,
            )
        except ImportError:
            logger.error(
                "presidio-analyzer is not installed — fallback detection disabled "
                "(install it to enable EMAIL/PHONE/IBAN fallback)."
            )
            _import_failed = True
            return []

        _recognizers = [EmailRecognizer(), PhoneRecognizer(), IbanRecognizer()]
    return _recognizers


def detect_safety_net(text: str) -> list[dict]:
    """Deterministic detection: EMAIL/PHONE/IBAN (Presidio) + optional amounts.

    Returns a list of ``{type, value, score}`` dicts using QUON entity types.
    Used both as the safety net (alongside the LLM) and as the Ollama-down
    fallback; the caller decides whether to emit the fallback log.
    """
    detected: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def _add(quon_type: str, value: str, score: float) -> None:
        value = value.strip()
        if not value:
            return
        # Dotted dates validate as phones in Presidio — never emit them as PHONE.
        if quon_type == "PHONE" and looks_like_date(value):
            return
        key = (quon_type, value.lower())
        if key in seen:
            return
        seen.add(key)
        detected.append({"type": quon_type, "value": value, "score": float(score)})

    for recognizer in _get_recognizers():
        # nlp_artifacts=None -> pure pattern matching, no spaCy required.
        results = recognizer.analyze(text=text, entities=recognizer.supported_entities, nlp_artifacts=None)
        for res in results:
            quon_type = _PRESIDIO_TO_QUON.get(res.entity_type)
            if quon_type is not None:
                _add(quon_type, text[res.start : res.end], res.score)

    if settings.safety_net_amounts:
        for match in _AMOUNT_RE.finditer(text):
            _add("FINANCIAL_AMOUNT", match.group(0), 0.85)

    # Supplement Presidio with format-based phone catches it validates away.
    for match in _PHONE_SUPPLEMENT_RE.finditer(text):
        _add("PHONE", match.group(0).strip(), 0.8)

    # Honorific + Capitalized name: names spaCy misses on bare title+surname.
    for match in _TITLED_NAME_RE.finditer(text):
        _add("PERSON", match.group("name").strip(), 0.8)

    # Street addresses (street+number, PLZ+city) — model-independent.
    if settings.safety_net_addresses:
        # A 5-digit number that a LABEL already claimed is an identifier, not a
        # postcode. PDF extraction of a two-column form merges the columns onto
        # one line — "Kunden-Nr.: 10023 Seite: 1 von 3" — and the postcode branch
        # then read "10023 Seite" as PLZ+city: it mislabelled the customer number
        # AND swallowed "Seite". Making the rule line-local fixed the version of
        # this that spanned a newline; this fixes the same-line one. Specificity
        # wins: an explicit label beats a shape guess.
        labelled_spans = [m.span(1) for m in _LABELLED_ID_RE.finditer(text)]

        def _claimed_by_a_label(start: int, end: int) -> bool:
            return any(s < end and start < e for s, e in labelled_spans)

        for match in _ADDRESS_RE.finditer(text):
            if _claimed_by_a_label(*match.span()):
                continue
            _add("ADDRESS", match.group(0).strip(), 0.8)

        # POSTCODE-ANCHORED STREET LINE. The street-suffix list ("…straße",
        # "…weg", "…platz"…) is a vocabulary, and German street names run out of
        # it fast — "Am Dünenwald 60" ends in "-wald" and was missed, so the city
        # line was redacted while the street line survived: a half-removed
        # address, the worst outcome. This rule is STRUCTURAL instead: whatever
        # sits immediately before a CONFIRMED "PLZ Stadt" match, on the same line
        # or the line above, and looks like "Word 60", is that address's street.
        # It needs no street vocabulary at all and cannot fire on its own — the
        # postcode has to be there first, which is what bounds the FP risk.
        for match in _PLZ_CITY_RE.finditer(text):
            head = text[: match.start()]
            # same line, or exactly one line up — no further, or a form's
            # unrelated rows above an address block start matching.
            tail = head[-_STREET_LOOKBACK :].rsplit("\n", 2)[-2:]
            for chunk in tail:
                m = _STREET_LINE_RE.search(chunk)
                if m and not _claimed_by_a_label(*m.span()) and not _is_layout_row(m.group(0)):
                    _add("ADDRESS", m.group(0).strip(), 0.75)
                    break

    # Written dates and prefixed insurance ids — see the pattern comments above.
    if settings.safety_net_spelled_dates:
        for match in _SPELLED_DATE_RE.finditer(text):
            _add("DATE", match.group(0).strip(), 0.8)

    for match in _INSURANCE_ID_RE.finditer(text):
        _add("INSURANCE_ID", match.group(0).strip(), 0.85)

    # Bare KVNR — only with a valid check digit (see the pattern comment).
    for match in _BARE_KVNR_RE.finditer(text):
        if kvnr_checksum_ok(match.group(0)):
            _add("INSURANCE_ID", match.group(0), 0.85)

    if settings.safety_net_spelled_dates:
        for match in _SLASH_DATE_RE.finditer(text):
            _add("DATE", match.group(0).strip(), 0.8)
        for match in _DOTTED_DATE_RE.finditer(text):
            _add("DATE", match.group(0).strip(), 0.8)

    for match in _INTERNAL_HOST_RE.finditer(text):
        _add("INTERNAL_URL", match.group(0).strip(), 0.85)

    # group(1) only — the label ("MRN") must survive, the identifier must not.
    for match in _LABELLED_ID_RE.finditer(text):
        _add("OTHER", match.group(1).strip(), 0.8)

    for match in _SSN_RE.finditer(text):
        _add("TAX_ID", match.group(0).strip(), 0.9)

    for match in _API_KEY_RE.finditer(text):
        _add("CREDENTIAL", match.group(0).strip(), 0.9)

    for match in _SECRET_ASSIGN_RE.finditer(text):
        _add("CREDENTIAL", match.group(1).strip(), 0.9)

    for match in _OCR_EMAIL_RE.finditer(text):
        _add("EMAIL", match.group(0).strip(), 0.9)

    return detected
