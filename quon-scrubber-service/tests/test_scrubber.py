"""Unit tests for the deterministic scrubbing logic (no Ollama required)."""

from __future__ import annotations

import pytest

from fallback import detect_safety_net
from models import ScrubOptions
from scrubber import (
    _apply_never_redact,
    _dedup_key,
    _is_relative_duration,
    _merge,
    detect_language,
    find_spans,
    placeholder_for,
    pseudonymize,
    scrub,
)


def _opts(**kw) -> ScrubOptions:
    return ScrubOptions(**kw)


# --- _is_relative_duration ------------------------------------------------
@pytest.mark.parametrize(
    "value",
    ["3 Wochen", "für 2 Tage", "über 6 Monate", "for 3 weeks", "2 hours", "1 Jahr"],
)
def test_relative_duration_matches(value):
    assert _is_relative_duration(value) is True


@pytest.mark.parametrize(
    "value",
    ["15.03.2025", "March 3, 2025", "3. März 2025", "2025-03-15", "Montag"],
)
def test_relative_duration_keeps_real_dates(value):
    assert _is_relative_duration(value) is False


# --- _apply_never_redact (allow-list) -------------------------------------
def _det(*pairs):
    return [{"type": t, "value": v, "score": 0.9} for t, v in pairs]


def test_never_redact_drops_matching_value_case_insensitive():
    out = _apply_never_redact(_det(("PERSON", "Xantan"), ("PERSON", "Anna")), ["xantan"])
    assert [d["value"] for d in out] == ["Anna"]


def test_never_redact_is_whole_value_not_substring():
    # Allowing "Xantan" must NOT suppress a real name that merely contains it.
    out = _apply_never_redact(_det(("PERSON", "Xantana Müller")), ["xantan"])
    assert [d["value"] for d in out] == ["Xantana Müller"]


def test_never_redact_empty_list_is_noop():
    dets = _det(("PERSON", "Xantan"))
    assert _apply_never_redact(dets, []) == dets
    assert _apply_never_redact(dets, ["   "]) == dets


# --- find_spans -----------------------------------------------------------
def test_find_spans_case_insensitive_and_all_occurrences():
    text = "Müller met müller and MÜLLER."
    spans = find_spans(text, "müller")
    assert len(spans) == 3


def test_find_spans_word_boundary_excludes_substring():
    # "Marco" must not match inside "marco_abenteuer".
    text = "ich bin Marco, schreib marco_abenteuer@web.de"
    spans = find_spans(text, "Marco")
    assert len(spans) == 1
    start, end = spans[0]
    assert text[start:end] == "Marco"


def test_find_spans_matches_email_and_plus_phone():
    text = "Mail j.park@firma.de or call +49 89 9876543 now"
    assert find_spans(text, "j.park@firma.de")
    assert find_spans(text, "+49 89 9876543")


def test_find_spans_empty_value():
    assert find_spans("anything", "   ") == []


# --- placeholder_for ------------------------------------------------------
def test_placeholder_for_typed_and_generic():
    assert placeholder_for("PHONE", "typed") == "[TELEFON]"
    assert placeholder_for("FINANCIAL_AMOUNT", "typed") == "[BETRAG]"
    assert placeholder_for("PHONE", "generic") == "[PII]"
    # Unknown type falls back to the generic marker.
    assert placeholder_for("MYSTERY", "typed") == "[PII]"


# --- pseudonymize ---------------------------------------------------------
def test_pseudonymize_typed_replaces_all_occurrences():
    text = "Call Anna or email anna@x.com, Anna is the lead."
    detected = [
        {"type": "PERSON", "value": "Anna", "score": 0.9},
        {"type": "EMAIL", "value": "anna@x.com", "score": 1.0},
    ]
    scrubbed, entities = pseudonymize(text, detected, _opts())
    assert "Anna" not in scrubbed
    assert "anna@x.com" not in scrubbed
    assert scrubbed.count("[PERSON]") == 2
    assert "[EMAIL]" in scrubbed
    # Report is de-duplicated by (type, value).
    assert {e.type for e in entities} == {"PERSON", "EMAIL"}


# --- _merge / _dedup_key: format-variant collision ------------------------
def test_merge_collapses_iban_spacing_variants_to_one_entity():
    """Same IBAN, spaced vs unspaced (two detectors) must not become two
    placeholders — otherwise the model sees two 'accounts'."""
    spaced = {"type": "IBAN", "value": "DE89 3704 0044 0532 0130 00", "score": 0.9}
    unspaced = {"type": "IBAN", "value": "DE89370400440532013000", "score": 0.8}
    merged = _merge([spaced], [unspaced])
    assert len(merged) == 1
    # Higher-scoring surface form wins.
    assert merged[0]["value"] == "DE89 3704 0044 0532 0130 00"


def test_merge_collapses_phone_separator_variants():
    a = {"type": "PHONE", "value": "+49 151 2345678", "score": 0.9}
    b = {"type": "PHONE", "value": "+49-151-2345678", "score": 0.7}
    assert len(_merge([a], [b])) == 1


def test_dedup_key_keeps_distinct_values_separate():
    # Different IBANs / phones must never collide.
    assert _dedup_key("IBAN", "DE89 3704 00") != _dedup_key("IBAN", "DE89 3704 01")
    assert _dedup_key("PHONE", "+49 151 111") != _dedup_key("PHONE", "+49 151 222")
    # Non-normalized types fall back to case-folded value.
    assert _dedup_key("PERSON", "Anna") == _dedup_key("PERSON", "anna")


def test_pseudonymize_indexed_style_unique_per_value():
    text = "Mail anna@x.com and bob@y.com, pay 50 € and 12 €."
    detected = [
        {"type": "EMAIL", "value": "anna@x.com", "score": 1.0},
        {"type": "EMAIL", "value": "bob@y.com", "score": 1.0},
        {"type": "FINANCIAL_AMOUNT", "value": "50 €", "score": 0.85},
        {"type": "FINANCIAL_AMOUNT", "value": "12 €", "score": 0.85},
    ]
    scrubbed, entities = pseudonymize(text, detected, _opts(placeholder_style="indexed"))
    placeholders = {e.placeholder for e in entities}
    assert placeholders == {"[EMAIL_1]", "[EMAIL_2]", "[AMOUNT_1]", "[AMOUNT_2]"}
    # Each distinct value maps to a distinct placeholder in the text.
    assert "[EMAIL_1]" in scrubbed and "[EMAIL_2]" in scrubbed
    assert "[AMOUNT_1]" in scrubbed and "[AMOUNT_2]" in scrubbed


def test_pseudonymize_generic_style():
    text = "Anna at anna@x.com"
    detected = [
        {"type": "PERSON", "value": "Anna", "score": 0.9},
        {"type": "EMAIL", "value": "anna@x.com", "score": 1.0},
    ]
    scrubbed, _ = pseudonymize(text, detected, _opts(placeholder_style="generic"))
    assert "[PII]" in scrubbed
    assert "[PERSON]" not in scrubbed
    assert "Anna" not in scrubbed and "anna@x.com" not in scrubbed


def test_pseudonymize_longest_match_wins_no_substring_breakage():
    text = "Petra Hoffmann and Hoffmann GmbH"
    detected = [
        {"type": "PERSON", "value": "Petra Hoffmann", "score": 0.9},
        {"type": "PERSON", "value": "Hoffmann", "score": 0.9},
    ]
    scrubbed, _ = pseudonymize(text, detected, _opts())
    # The longer span wins; the standalone "Hoffmann GmbH" still gets the
    # surname redacted (replace-all), but the full name is a single placeholder.
    assert "Petra Hoffmann" not in scrubbed
    assert scrubbed.startswith("[PERSON]")


def test_pseudonymize_confidence_rounding():
    text = "Reach a@b.com"
    detected = [{"type": "EMAIL", "value": "a@b.com", "score": 0.954321}]
    _, entities = pseudonymize(text, detected, _opts())
    assert entities[0].confidence == 0.95


def test_pseudonymize_unlocatable_value_is_dropped():
    text = "No PII here."
    detected = [{"type": "PERSON", "value": "Ghost Name", "score": 0.9}]
    scrubbed, entities = pseudonymize(text, detected, _opts())
    assert scrubbed == text
    assert entities == []


# --- detect_safety_net -----------------------------------------------------
def test_safety_net_detects_amounts_and_email():
    found = detect_safety_net(
        "Budget 145.000 € und $4.2M an a@b.com, IBAN DE89 3704 0044 0532 0130 00"
    )
    pairs = {(d["type"], d["value"]) for d in found}
    amounts = {v for t, v in pairs if t == "FINANCIAL_AMOUNT"}
    assert "145.000 €" in amounts and "$4.2M" in amounts
    assert ("EMAIL", "a@b.com") in pairs
    # Technical numbers without currency must NOT be flagged as amounts.
    assert not [d for d in detect_safety_net("Version 3.2.1, 99,7%, 64 GB") if d["type"] == "FINANCIAL_AMOUNT"]


def test_safety_net_amounts_plain_unseparated_digits():
    # Regression: "EUR 8045" matched only "EUR 804" → the span missed the word
    # boundary → the amount wasn't redacted at all (a leak). See fallback._NUMBER.
    for amt in ["EUR 8045", "USD 1274", "$320000", "GBP 50000"]:
        found = {
            d["value"]
            for d in detect_safety_net(f"Bitte {amt} ueberweisen.")
            if d["type"] == "FINANCIAL_AMOUNT"
        }
        assert amt in found, f"{amt!r} not fully detected: {found}"


def test_safety_net_phone_supplement_catches_unvalidated_formats():
    # Presidio validates real area codes; a privacy tool should still redact a
    # phone-shaped string. The supplement catches these, FP-safely.
    from fallback import _PHONE_SUPPLEMENT_RE

    for ph in ["259-590-5427", "(598) 323 7979", "+1 (278) 973-4060"]:
        found = {d["value"] for d in detect_safety_net(f"Ruf {ph} an.") if d["type"] == "PHONE"}
        assert ph in found, f"{ph!r} not detected: {found}"
    # The supplement itself must not fire on IPs, version strings or dates (the
    # grouped 3-3-4 + separator structure is what keeps it tight).
    for noise in ["192.168.1.1", "Version 3.2.1.4040", "Build 2024.10.03", "1.234.567,89"]:
        assert not _PHONE_SUPPLEMENT_RE.search(noise), f"false phone on {noise!r}"


# --- Titled-name supplement (deterministic PERSON backstop) ----------------
@pytest.mark.parametrize(
    "text,name",
    [
        ("Herr Sandberg wohnt am Rehbergplatz.", "Sandberg"),
        ("Frau Steinweg kommt morgen.", "Steinweg"),
        ("Meine Nachbarin ist Frau Ottersbach.", "Ottersbach"),
        ("Bitte ruf Prof. Dr. Müller an.", "Müller"),
        ("Ich habe mit Frau Anna Müller gesprochen.", "Anna Müller"),
        ("Mr Smith called yesterday.", "Smith"),
        ("Dr. Weber-Klein ist heute da.", "Weber-Klein"),
    ],
)
def test_titled_name_supplement_unit(text, name):
    # Unit level: the deterministic supplement extracts the NAME (honorific
    # excluded) regardless of NER/LLM. These are exactly the bare title+surname
    # shapes spaCy misses.
    persons = {d["value"] for d in detect_safety_net(text) if d["type"] == "PERSON"}
    assert name in persons, f"{name!r} not detected in {persons}"


@pytest.mark.parametrize(
    "text",
    [
        "Ich habe den Herr. Dann ging ich nach Hause.",  # sentence-final "Herr."
        "Die Frauen kamen an.",  # "Frauen" is not "Frau" + name
        "Kein Titel hier, nur normaler Text.",
        "Herr der Ringe war gut.",  # lowercase "der" breaks the name capture
    ],
)
def test_titled_name_supplement_no_false_positive(text):
    assert not [d for d in detect_safety_net(text) if d["type"] == "PERSON"]


def test_titled_name_redacted_end_to_end_without_llm(monkeypatch):
    """The confirmed production leak: with the cloud LLM UNAVAILABLE, a bare
    German title+surname must still be redacted by the always-on deterministic
    backstop (real spaCy NER + fallback, no mocks). Before the supplement, spaCy
    returned [] for these and — with the LLM also down — they passed through in
    full. The honorific itself is not PII and stays visible."""
    import asyncio

    from scrubber import scrub


    async def run(text: str):
        return await scrub(text, ScrubOptions(language="de", use_llm=False))

    result = asyncio.run(run("Herr Sandberg wohnt am Rehbergplatz."))
    assert any(e.type == "PERSON" and e.value == "Sandberg" for e in result.entities)
    assert "Sandberg" not in result.scrubbed  # the name is gone
    assert "Herr" in result.scrubbed  # the honorific stays (not PII)


# --- detect_language --------------------------------------------------------
def test_detect_language_formal_register_unaffected():
    # Original formal-register cases the heuristic already handled; must stay
    # correct after broadening the hint lists for casual register.
    assert detect_language("Sehr geehrte Frau Müller, mit freundlichen Grüßen") == "de"
    assert detect_language("Dear Sir, please find the invoice attached") == "en"
    # Neutral / non-prose input defaults to English.
    assert detect_language("8080:80 nginx") == "en"


def test_detect_language_reported_bug_rehbergplatz():
    """Regression for the language-misdetection bug (not an ner.py guard bug):
    a casual German QUESTION with no business/formal vocabulary scored 0 hits
    in BOTH _GERMAN_HINTS and _ENGLISH_HINTS, so detect_language fell through
    to its "de == 0 and en == 0 -> en" default. The ENGLISH spaCy model then
    ran on German text and mislabeled the capitalized street/square compound
    "Rehbergplatz" ("-platz" = square/plaza) as PERSON. Fixed by broadening
    _GERMAN_HINTS to cover conversational register (interrogatives, inflected
    articles, common verbs/conjunctions/pronouns), not by touching ner.py.
    """
    text = "Welcher Supermarkt kommt an den Rehbergplatz in bad kleinfeld"
    assert detect_language(text) == "de"


@pytest.mark.parametrize(
    "text",
    [
        "Welcher Supermarkt kommt an den Rehbergplatz in bad kleinfeld",
        "Wo ist der Alexanderplatz",
        "Ich fahre zur Bahnhofstraße",
        "Triff mich am Rosenweg",
        "Wann kommt der Bus heute",
        "Kannst du mir helfen einen Ausflug zu planen",
        "Was ist da los mit dir",
        "Wie spät ist es gerade",
        "Gibt es hier einen Bäcker in der Nähe",
        "Kommst du morgen mit ins Kino",
        "Ich glaube das ist keine gute Idee",
        "Wir treffen uns dann später am Marktplatz",
    ],
)
def test_detect_language_casual_german_battery(text):
    """Casual, register-neutral German (no formal/business vocabulary) must
    still resolve to "de" — this is the exact register the original hint list
    missed (skewed toward "sehr geehrte" / "betreff" / "rechnung" business-email
    words). Covers different question words, sentence shapes, and additional
    German street/square-name compounds beyond the one reported."""
    assert detect_language(text) == "de"


@pytest.mark.parametrize(
    "text",
    [
        "Which store is closest to me",
        "Can you help me plan a trip",
        "What time does it open",
        "I need to call my dentist tomorrow morning",
        "She lives in a small apartment downtown",
        "Where should we meet for lunch today",
        "He never answers his phone anymore",
        "This is the best restaurant in town",
        "Can you send me the invoice for last month",
        "Let's go to the beach this weekend",
        "I think we should leave soon",
        "There is nothing more to say about it",
    ],
)
def test_detect_language_casual_english_battery_unaffected(text):
    """Symmetric regression: broadening _GERMAN_HINTS for casual register must
    NOT start misclassifying casual, register-neutral ENGLISH (no business
    vocabulary either) as German. This is the main risk of the fix above —
    verified explicitly rather than just eyeballed."""
    assert detect_language(text) == "en"


@pytest.mark.parametrize(
    "text",
    [
        # "den" — the English noun (a den/room), not the German article:
        "my den needs a new sofa",
        "I turned the den into an office",
        "the kids play in the den upstairs",
        "welcome to my den",
        # "Dann" as an English NAME + "met/at": before _ENGLISH_HINTS was
        # broadened symmetrically, this tied 1:1 on hint words and the de>=en
        # tie-break flipped it to "de" — and the GERMAN model then found no
        # entities, silently LEAKING both names (the English model catches
        # PERSON Kim + PERSON Dann). For a privacy gateway a wrong-language
        # flip is a recall hole, not just an FP risk.
        "Kim and Dann met at noon",
        # "Mir" — the space station, colliding with German "mir":
        "photos from the Mir station",
    ],
)
def test_detect_language_english_with_german_lookalike_tokens(text):
    """Adversarial battery (caught in independent review, after the first
    hand-written English battery passed): short casual English sentences that
    CONTAIN one of the newly-added German hint words as an English
    token/name. These flipped to "de" until _ENGLISH_HINTS gained common
    casual English function words (my/is/to/into/at/met/...) so the count —
    not the German-favoring tie-break — decides."""
    assert detect_language(text) == "en"


def test_detect_language_excluded_english_collision_words_not_added():
    """Words that are valid German but collide with common English spellings
    must NOT be in _GERMAN_HINTS, or an ordinary English sentence containing
    them would flip to "de". Documents the words deliberately left out of the
    broadened list (see the comment above _GERMAN_HINTS in scrubber.py).

    "was" is the one caught AFTER the fact by the corpus eval's before/after
    diff (not by the hand-written battery above, since none of those sentences
    happened to use it): importing ner_gazetteer.INTERROGATIVES wholesale
    pulled in "was" (German "what"), which collides with the English
    past-tense "was" ("It was a great day") and flipped ordinary English
    prose containing it to "de". Excluded via
    _ENGLISH_COLLISION_INTERROGATIVES rather than dropping the whole import."""
    assert detect_language("I bought a new hat yesterday for the wedding") == "en"
    assert detect_language("Also, can you help me plan a trip to Paris") == "en"
    assert detect_language("He fought in the war and came home") == "en"
    assert detect_language("She wore a hat and also brought sunglasses") == "en"
    assert detect_language("It was a great day") == "en"
    assert detect_language(
        "Jason Costa's SSN is 135-50-2562; the tax return was filed in Springfield."
    ) == "en"


def test_detect_language_residual_ambiguous_case_was_hat_only():
    """Known residual edge case (surfaced during verification, not force-fixed):
    a short German sentence whose ONLY plausible hint word is "was" or "hat"
    still resolves to the "en" default, because both are correctly EXCLUDED as
    English collisions (see test_detect_language_excluded_english_collision_
    words_not_added). Verified this does NOT leak PII through the full
    pipeline (no capitalized noun for the English NER model to misfire on) —
    but it is a real classification miss a user could hit. No safe fix is
    available without reintroducing an English-collision risk; "Never redact"
    / rephrasing is the user-facing mitigation, same as any residual gap in
    a heuristic-based detector."""
    text = "Was hat es damit auf sich"
    assert detect_language(text) == "en"  # documents the residual gap, not a target
    # But it must not produce a PERSON false positive despite the misdetection.
    import asyncio

    from models import ScrubOptions
    from scrubber import scrub

    async def run():
        opts = ScrubOptions(language="auto", use_llm=False)
        return await scrub(text, opts)

    result = asyncio.run(run())
    assert result.entities == []
    assert result.scrubbed == text


def test_detect_language_hint_breaks_only_the_zero_evidence_tie():
    """The client-locale hint (ScrubOptions.language_hint): bare noun queries
    ("Milchreis Rezept") carry no hint word in either language — word lists
    structurally can't fix that class (36% of FP-affected prompts in the
    2026-07-08 real-world review; 35/36 vanish under the correct model). The
    hint decides ONLY that zero-evidence case and never overrides text signal."""
    # Zero-evidence German noun queries: hint routes them to the German model.
    for text in ["Milchreis Rezept", "Airfryer Blumenkohl", "Chai Latte Koffein"]:
        assert detect_language(text) == "en"  # old default, unchanged without hint
        assert detect_language(text, hint="de") == "de"
    # Real signal beats the hint in BOTH directions.
    assert detect_language("Which store is closest to me", hint="de") == "en"
    assert detect_language("Wann kommt der Bus heute", hint="en") == "de"
    # Umlauts are decisive German evidence — hint ignored.
    assert detect_language("Grüße", hint="en") == "de"
    # Invalid hints fall back to the old default.
    assert detect_language("Milchreis Rezept", hint="fr") == "en"
    assert detect_language("Milchreis Rezept", hint=None) == "en"
    # Bonus: the previously-documented residual gap ("was"/"hat" both excluded
    # as English collisions -> zero evidence) is now covered by the hint too.
    assert detect_language("Was hat es damit auf sich", hint="de") == "de"


def test_detect_language_full_pipeline_no_person_false_positive():
    """End-to-end regression: the reported bug only matters because it produced
    a PERSON false positive through the FULL scrub() pipeline under
    options.language="auto" (not just a detect_language() unit mismatch)."""
    import asyncio

    from models import ScrubOptions
    from scrubber import scrub

    async def run():
        text = "Welcher Supermarkt kommt an den Rehbergplatz in bad kleinfeld"
        opts = ScrubOptions(language="auto", use_llm=False)
        return await scrub(text, opts)

    result = asyncio.run(run())
    assert result.metadata.language_detected == "de"
    # The regression this guards is a PERSON false positive from the wrong-model
    # path. ("Rehbergplatz" may legitimately be picked up as ADDRESS now that
    # that type exists — a location, not a person — so we assert on PERSON
    # specifically rather than total emptiness, which also keeps the test stable
    # whether or not a local LLM is reachable.)
    assert all(e.type != "PERSON" for e in result.entities)


# --- ADDRESS safety-net regex -------------------------------------------------


def _addresses(text: str) -> list[str]:
    return [d["value"] for d in detect_safety_net(text) if d["type"] == "ADDRESS"]


@pytest.mark.parametrize(
    "text,expected",
    [
        ("Bitte an Bahnhofstraße 12 liefern.", "Bahnhofstraße 12"),
        ("Wohnhaft Rehbergplatz 5a.", "Rehbergplatz 5a"),
        ("Adresse: Rosenweg 3", "Rosenweg 3"),
        ("PLZ-Ort: 12345 Berlin, bitte.", "12345 Berlin"),
        ("80331 München ist das Ziel.", "80331 München"),
    ],
)
def test_address_regex_catches_common_shapes(text, expected):
    assert expected in _addresses(text)


@pytest.mark.parametrize(
    "text",
    [
        "Ich wohne in Berlin.",              # bare city — no number
        "Die Bahnhofstraße ist gesperrt.",   # bare street — no number
        "Version 12 der Software.",          # number without a street word
        "Er heißt Herr Wildberg.",           # surname, not an address
    ],
)
def test_address_regex_avoids_bare_city_or_street(text):
    assert _addresses(text) == []


# --- disabled_types (per-request type policy) --------------------------------


def _scrub_types(text: str, detected: list[dict], disabled: list[str]) -> set[str]:
    """Replicate scrub()'s late disabled-types filter + pseudonymize, returning
    the set of entity types that survived into the output."""
    from scrubber import pseudonymize

    opts = ScrubOptions(disabled_types=disabled)
    if opts.disabled_types:
        off = set(opts.disabled_types) - {"CUSTOM"}
        detected = [d for d in detected if d["type"] not in off]
    _scrubbed, ents = pseudonymize(text, detected, opts)
    return {e.type for e in ents}


_TEXT = "Anna Müller, Bahnhofstraße 12, Projekt-X"
_DETECTED = [
    {"type": "PERSON", "value": "Anna Müller", "score": 0.9},
    {"type": "ADDRESS", "value": "Bahnhofstraße 12", "score": 0.8},
    {"type": "CUSTOM", "value": "Projekt-X", "score": 1.0},
]


def test_disabled_types_empty_scrubs_everything():
    assert _scrub_types(_TEXT, _DETECTED, []) == {"PERSON", "ADDRESS", "CUSTOM"}


def test_disabled_types_drops_listed_types():
    assert _scrub_types(_TEXT, _DETECTED, ["ADDRESS"]) == {"PERSON", "CUSTOM"}


def test_disabled_types_never_drops_custom():
    # Even if the user somehow lists CUSTOM, the always-redact override survives.
    assert "CUSTOM" in _scrub_types(_TEXT, _DETECTED, ["CUSTOM", "PERSON", "ADDRESS"])


def test_always_redact_survives_an_overlapping_never_redact() -> None:
    """always_redact must win over never_redact.

    Regression for a fail-OPEN: `_apply_never_redact` filtered by value
    regardless of type, so a value the user had put on BOTH lists was dropped —
    the allow-list silently cancelling an explicit "always redact this", with
    nothing surfaced to the user. The neighbouring `disabled_types` block had
    always treated CUSTOM as a hard override; this one did not.
    """
    detected = [
        {"type": "CUSTOM", "value": "Kundennummer 48213", "start": 0, "end": 18, "score": 1.0},
        {"type": "PERSON", "value": "Xantan", "start": 20, "end": 26, "score": 0.8},
    ]
    kept = _apply_never_redact(detected, ["Kundennummer 48213", "Xantan"])
    kept_values = [d["value"] for d in kept]

    # The explicit always-redact entry survives…
    assert "Kundennummer 48213" in kept_values
    # …while a genuine false positive is still suppressed.
    assert "Xantan" not in kept_values


# --- spelled-out dates + prefixed insurance ids in the safety net -----------
# Added 2026-08-19 after a golden-58 comparison of the cloud 24B against a
# self-hosted 7B: 5 of the 7B's 11 leaks were written dates the 24B caught, in
# both languages, plus two prefixed insurance ids. Deterministic shapes must not
# depend on which model is configured, so they moved into the net. These are the
# exact values that leaked.
@pytest.mark.parametrize(
    "text,expected",
    [
        ("Der Termin ist am 15. April 2025.", "15. April 2025"),
        ("Rechnung vom 12. März 2025 liegt bei.", "12. März 2025"),
        ("Liefertermin 1. April", "1. April"),
        ("The deadline is March 14th.", "March 14th"),
        ("Payment due June 5th 2025.", "June 5th 2025"),
        ("Signed on 14th March 2025.", "14th March 2025"),
    ],
)
def test_safety_net_catches_spelled_out_dates(text, expected):
    values = {d["value"] for d in detect_safety_net(text) if d["type"] == "DATE"}
    assert expected in values


@pytest.mark.parametrize("value", ["VN-2024-88421", "KV-98234-A-7"])
def test_safety_net_catches_prefixed_insurance_ids(value):
    text = f"Die Versichertennummer lautet {value} laut Karte."
    values = {d["value"] for d in detect_safety_net(text) if d["type"] == "INSURANCE_ID"}
    assert value in values


@pytest.mark.parametrize(
    "text",
    [
        "we may march to the office",          # lowercase month words in prose
        "Der Vertrag ist unbefristet.",         # ordinary German prose
        "She will march in April with us",      # capitalised month, no day number
        "Version 3. Release folgt",             # ordinal + word, not a month
    ],
)
def test_spelled_date_net_does_not_fire_on_prose(text):
    """The FP guard matters more than the catch: a date net that eats ordinary
    sentences would over-redact every message, which is the failure users
    actually notice."""
    assert [d for d in detect_safety_net(text) if d["type"] == "DATE"] == []


def test_spelled_dates_can_be_left_to_the_llm(monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "safety_net_spelled_dates", False)
    assert [d for d in detect_safety_net("Termin am 15. April 2025") if d["type"] == "DATE"] == []


# --- shared blind spots: both models missed these (2026-08-19 golden-58) -----
# Not a model weakness — the 24B leaked the slash date and BOTH models leaked the
# internal host and the labelled record id. A shape both models miss belongs in
# the net, not in a model comparison.
@pytest.mark.parametrize("value", ["09/15/1978", "05/12/1962", "1/2/2024"])
def test_safety_net_catches_slash_dates(value):
    found = {d["value"] for d in detect_safety_net(f"Termin {value} bestaetigt") if d["type"] == "DATE"}
    assert value in found


@pytest.mark.parametrize(
    "value",
    ["confluence.intern.de/quon", "wiki.internal.acme.com/page", "jira.corp.example.org", "db.local"],
)
def test_safety_net_catches_internal_hosts(value):
    found = {d["value"] for d in detect_safety_net(f"Doku: {value}") if d["type"] == "INTERNAL_URL"}
    assert value in found


def test_internal_host_alternation_does_not_truncate():
    """`intern` before `internal` in the alternation matched only 'wiki.intern'.
    Leftmost-first alternation silently truncating a host is worse than missing
    it: a partial redaction looks like a success in the entity list."""
    found = {d["value"] for d in detect_safety_net("wiki.internal.acme.com/page")}
    assert "wiki.internal.acme.com/page" in found


@pytest.mark.parametrize(
    "text,ident",
    [("MRN 7734521 show improvement", "7734521"), ("Kundennummer 4711-8890", "4711-8890"),
     ("Patienten-ID: A-99812", "A-99812")],
)
def test_labelled_ids_redact_the_value_not_the_label(text, ident):
    """The corpus requires the LABEL ('MRN') to survive while the identifier is
    redacted — so the emitter must use the capture group, not the whole match."""
    found = {d["value"] for d in detect_safety_net(text)}
    assert ident in found
    assert not any(v.upper().startswith("MRN") for v in found)


@pytest.mark.parametrize(
    "text",
    ["Er ist international taetig", "Die Internal Revenue Service Seite",
     "Das neue QUON System bei Siemens Energy", "Verhaeltnis 3/4 der Stimmen"],
)
def test_new_patterns_do_not_fire_on_prose(text):
    assert [d for d in detect_safety_net(text) if d["type"] in {"INTERNAL_URL", "DATE", "OTHER"}] == []


# --- academic qualifiers between title and name -----------------------------
# "Dr. med. Stefan Weber" was the ONE real detection miss left after the
# 2026-08-19 golden-58: the lowercase qualifier sits where the name pattern
# expects a capital, so the whole span was skipped. The qualifier is consumed,
# never emitted — the honorific still stays in the output on purpose (see
# test_titled_name_redacted_end_to_end_without_llm).
@pytest.mark.parametrize(
    "text,name",
    [
        ("Der Termin mit Dr. med. Stefan Weber ist am Montag.", "Stefan Weber"),
        ("Prof. Dr. rer. nat. Ada Lovelace hält den Vortrag.", "Ada Lovelace"),
        ("Frau Dr. jur. Petra Hoffmann übernimmt.", "Petra Hoffmann"),
    ],
)
def test_titled_name_with_academic_qualifier(text, name):
    persons = {d["value"] for d in detect_safety_net(text) if d["type"] == "PERSON"}
    assert name in persons, f"{name!r} not in {persons}"


def test_academic_qualifier_is_not_itself_emitted():
    """Only the NAME is redacted. The qualifier is part of the honorific, and
    redacting it would contradict the deliberate 'honorifics stay' behaviour."""
    persons = {d["value"] for d in detect_safety_net("Dr. med. Stefan Weber kommt.") if d["type"] == "PERSON"}
    assert persons == {"Stefan Weber"}


# --- dotted German dates ----------------------------------------------------
# Found by running the net over 45 REAL German documents (2026-08-19): dd.mm.yyyy
# was the most common identifier shape at 126 occurrences and config 1 caught
# NONE. looks_like_date() existed only to keep such strings OUT of PHONE; nothing
# emitted them as DATE. The synthetic corpus missed it because the cloud LLM
# covered the form — so it leaked precisely on the degraded path, where the net
# is the only thing left.
@pytest.mark.parametrize(
    "text,value",
    [
        ("Vertragsbeginn 15.04.2025 laut Police.", "15.04.2025"),
        ("Geburtsdatum 03.11.1965 des Versicherten.", "03.11.1965"),
        ("Stichtag 01.01.26 beachten.", "01.01.26"),
        ("Rechnung vom 12.03.2026 ist fällig.", "12.03.2026"),
    ],
)
def test_safety_net_catches_dotted_german_dates(text, value):
    found = {d["value"] for d in detect_safety_net(text) if d["type"] == "DATE"}
    assert value in found


@pytest.mark.parametrize(
    "text",
    [
        "Version 1.2.3 ist raus",        # semver: 1-digit final group
        "Siehe § 5.2.1 im Vertrag",      # section numbering
        "Betrag 1.234.567 EUR",          # grouped amount: middle group too long
        "IP 192.168.1.1 erreichbar",     # first group too long
        "Kafka 3.6 läuft stabil",        # two components only
    ],
)
def test_dotted_date_does_not_eat_version_or_amount_strings(text):
    """Digit-group WIDTH is what separates a date from a version, a section
    number and a grouped amount — all three live in the same documents."""
    assert [d for d in detect_safety_net(text) if d["type"] == "DATE"] == []


def test_dotted_date_still_excluded_from_phone():
    """The original purpose of looks_like_date must survive: Presidio validates
    dotted dates as phone numbers, and two of its three real-world PHONE hits
    were dates."""
    from fallback import looks_like_date

    assert looks_like_date("30.05.2028") is True
    phones = {d["value"] for d in detect_safety_net("Termin 30.05.2028") if d["type"] == "PHONE"}
    assert phones == set()


# --- E1/E2: widening what the LLM veto is allowed to reach -------------------
# The veto is doubly-gated (NER marks tentative AND the LLM says NOT_NAME), which
# is what makes a wrong model answer safe. These do NOT touch that gate — they
# widen only what qualifies as tentative, so the LLM finally gets a channel to
# say "that is a payroll field, not a person". With no LLM, everything here stays
# redacted exactly as before.
@pytest.mark.parametrize(
    "value",
    ["Gesamtbrutto", "RV-Brutto AV-Brutto PV-Brutto", "Zusatzbtr", "Arbg", "Ust-Id", "Auftragsnr"],
)
def test_form_labels_are_flagged_tentative(value):
    from ner import _looks_like_form_label

    assert _looks_like_form_label(value) is True


@pytest.mark.parametrize("value", ["Bruttoreich", "Nummernberg", "Beitragsmann", "Anna Müller", "Talberg"])
def test_form_label_predicate_does_not_claim_plausible_surnames(value):
    """Suffix, not substring: a substring test flagged 'Bruttoreich'. A wrong
    guess here only costs noise (tentative never drops on its own), but a
    predicate that fires on real surnames would make the veto dangerous to widen
    further later."""
    from ner import _looks_like_form_label

    assert _looks_like_form_label(value) is False


@pytest.mark.parametrize("value", ["Ornnl�bury", "Anna Kopp@nbpry", "Jah-", "-Weber"])
def test_ocr_damaged_values_are_flagged_tentative(value):
    from ner import _looks_ocr_damaged

    assert _looks_ocr_damaged(value) is True


@pytest.mark.parametrize("value", ["Anna Müller", "Weber-Klein", "O'Brien", "Müller"])
def test_ocr_damage_predicate_leaves_normal_names_alone(value):
    from ner import _looks_ocr_damaged

    assert _looks_ocr_damaged(value) is False


# --- E4: identifier LABEL vocabulary ----------------------------------------
@pytest.mark.parametrize(
    "text,ident",
    [
        ("Versicherungsnummer 4711889900", "4711889900"),
        ("Vertragsnr. VN-2024-88421", "VN-2024-88421"),
        ("Zählernummer 09887766", "09887766"),
        ("Steuer-ID 12345678901", "12345678901"),
        ("Personalnummer 4455667", "4455667"),
        ("Depotnummer 900123456", "900123456"),
    ],
)
def test_widened_identifier_labels(text, ident):
    assert ident in {d["value"] for d in detect_safety_net(text) if d["type"] == "OTHER"}


@pytest.mark.parametrize("text", ["Die Nummer der Seite 12", "Artikel 8829911 kostet 12 EUR"])
def test_bare_numbers_are_still_not_identifiers(text):
    """Matching bare digit runs was rejected: an 8-digit number is as plausibly an
    article number or a meter reading as an identifier. The LABEL is what makes
    it unambiguous."""
    assert [d for d in detect_safety_net(text) if d["type"] == "OTHER"] == []


def test_pdf_split_umlaut_is_repaired_before_detection():
    """PDF extraction breaks an umlaut into base letter + a separate diaeresis, so
    "Dünenwald" arrives as "Du¨nenwald" and every detector sees a word matching no
    letter class and no learned token. Measured on a real booking form: GLiNER
    scored the address 0.64 clean and 0.51 broken, fragmenting the span mid-street.

    Both encodings occur; only one is fixed by NFC alone.
    """
    from scrubber import _repair_extraction_artifacts

    spacing = "Du¨nenwald"      # U+00A8 SPACING DIAERESIS — NFC leaves it alone
    combining = "Dünenwald"    # U+0308 COMBINING DIAERESIS — NFC joins it
    assert _repair_extraction_artifacts(spacing) == "Dünenwald"
    assert _repair_extraction_artifacts(combining) == "Dünenwald"
    # Text with no damage must come back byte-identical.
    clean = "Dünenwald 60, 18551 Glowe"
    assert _repair_extraction_artifacts(clean) == clean


@pytest.mark.parametrize(
    "text",
    [
        # The read_url E2E's mocked listing (2026-09-04): scraped pages and old
        # exports transliterate umlauts, the umlaut shortcut sees nothing, no
        # hint word matched, and the zero-evidence default sent GERMAN text to
        # the ENGLISH model — which invented PERSONs out of capitalised noun
        # phrases ("Ruhige Finca", "Grosse Auswahl").
        "Ruhige Finca im Suedwesten, windgeschuetzt, zwei Wochen frei im Januar.",
        "Grosse Auswahl an Modellen, Beratung vor Ort.",
        "Schoene Wohnung fuer zwei Personen, Anfrage ueber das Formular.",
        "Lieferung dauert drei Wochen, Versand nach Deutschland frei.",
        "Termin am Montag, spaeter geht auch Donnerstag.",
    ],
)
def test_detect_language_transliterated_german(text):
    assert detect_language(text) == "de", text


@pytest.mark.parametrize(
    "text",
    [
        # Near-collisions for the transliterated/casual additions: bare English
        # words that BORDER the new hint words must not flip English prose.
        "My gut says we should wait for the gross margin numbers.",
        "She lives on Grosse Pointe and works downtown.",
        "We met in June for four days at the lake.",
        "The invoice from Tuesday needs your approval before Friday.",
        "Frei University alumni meet today.",
    ],
)
def test_detect_language_transliteration_additions_leave_english_alone(text):
    assert detect_language(text) == "en", text


@pytest.mark.anyio
async def test_scrub_fetched_listing_no_person_fp_without_gliner():
    """Full-pipeline regression for the read_url FP class, in the E2E/self-host
    configuration (no GLiNER, so the V1 cross-check cannot rescue anything —
    the language router plus _keep_person guard 5 must carry it alone)."""
    text = "Ruhige Finca im Suedwesten, windgeschuetzt, zwei Wochen frei im Januar."
    result = await scrub(text, ScrubOptions(placeholder_style="indexed"))
    persons = [e.value for e in result.entities if e.type == "PERSON"]
    assert persons == [], persons
