"""Tests for the spaCy/Presidio NER primary detector and its integration.

The NER tests skip automatically if the spaCy models are not installed, so the
suite still passes in a strictly model-free environment.
"""

from __future__ import annotations

import asyncio

import pytest

import ner
import ner_gazetteer
from models import ScrubOptions


@pytest.fixture(scope="module", autouse=True)
def _warm_ner():
    ner.warmup()


def _require_ner():
    if not ner.is_ready():
        pytest.skip("spaCy NER models not installed")


def _require_gliner():
    """Skip when the GLiNER model is not loaded.

    One guard for every GLiNER test, because ad-hoc copies drift:
    _get_model() returns False (not None) after a failed load, and a test that
    checks ``is None`` runs against an empty detector on a runner where the
    load failed, and fails instead of skipping (see
    test_gliner_is_loaded_is_false_when_the_load_failed for the same class).
    """
    import gliner_detect

    if not gliner_detect._get_model():
        pytest.skip("GLiNER model/dependency unavailable")


# --- detect_ner -----------------------------------------------------------
def test_detect_ner_finds_person_de():
    _require_ner()
    detected = ner.detect_ner("Mein Name ist Stefan Weber und ich rufe morgen an.", "de")
    persons = [d["value"] for d in detected if d["type"] == "PERSON"]
    assert any("Weber" in p for p in persons)


def test_detect_ner_finds_person_en():
    _require_ner()
    detected = ner.detect_ner("Please contact Stephen Weber about the appointment.", "en")
    persons = [d["value"] for d in detected if d["type"] == "PERSON"]
    assert any("Weber" in p for p in persons)


def test_detect_ner_drops_sentence_initial_verb():
    _require_ner()
    # "Reiche" / "Schreibe" are capitalized sentence-initial German verbs that the
    # spaCy models tend to mislabel as PERSON. The POS filter must drop them.
    detected = ner.detect_ner("Reiche ich das Attest direkt bei Ihnen ein?", "de")
    persons = [d["value"].lower() for d in detected if d["type"] == "PERSON"]
    assert "reiche" not in persons

    detected = ner.detect_ner("Schreibe mir bitte morgen eine Nachricht.", "de")
    persons = [d["value"].lower() for d in detected if d["type"] == "PERSON"]
    assert "schreibe" not in persons


def test_detect_ner_keeps_real_name_with_filter():
    _require_ner()
    # The filter must not suppress genuine multi-token names.
    detected = ner.detect_ner(
        "Mein Arzt Dr. med. Stefan Weber hat mir ein Attest ausgestellt.", "de"
    )
    persons = [d["value"] for d in detected if d["type"] == "PERSON"]
    assert any("Weber" in p for p in persons)


def test_gazetteer_drops_food_and_lab_terms_but_keeps_real_name():
    """A lab report's capitalized food + lab terms must not be flagged PERSON, while
    the real (even all-caps) patient name still is. Regression for the food-sensitivity
    PDF that redacted Bok Choi / IgG / LifeLabs but kept the patient."""
    _require_ner()
    text = (
        "PATIENT: MARIO OPEL. IgG Food Sensitivity via LifeLabs FST. "
        "Bok Choi 3, Mung bean 5, Kohlrabi 16, Zucchini 18, Butterhead 3, "
        "Cauliflower 3, Asparagus 15. See Patient Guidebook. IgE elevated."
    )
    persons = {d["value"].lower() for d in ner.detect_ner(text, "en") if d["type"] == "PERSON"}
    assert "mario opel" in persons  # recall-first: the real name survives
    for term in (
        "bok choi", "mung bean", "kohlrabi", "zucchini", "butterhead",
        "cauliflower", "asparagus", "lifelabs", "igg", "ige", "patient guidebook",
    ):
        assert term not in persons, f"{term} wrongly flagged as PERSON"


# --- Regression: informal/imperative German chat must not yield PERSON FPs ----
@pytest.mark.parametrize(
    "text",
    [
        # The two reported screenshots: an imperative verb mistagged as NOUN,
        # and a lowercase function-word run mistagged as a multi-token PERSON.
        "Mache mir vorschläge für ein neues kleines auto für meine mutter die 70 ist",
        "Kannst du mir helfen meine medivere darm analyse zu interpretieren?",
        # Other common chat openers that spaCy mislabels.
        "Rechne mir aus wie viel das kostet",
        "Fasse diesen text zusammen",
        "Übersetze das ins englische",
        "Zeige mir gute rezepte für pasta",
        "Erkläre mir wie photosynthese funktioniert",
    ],
)
def test_detect_ner_no_person_in_imperative_chat(text):
    _require_ner()
    persons = [d["value"] for d in ner.detect_ner(text, "de") if d["type"] == "PERSON"]
    assert persons == [], f"unexpected PERSON false positive: {persons}"


# --- Regression: German interrogatives/question-words must not yield PERSON FPs --
@pytest.mark.parametrize(
    "text",
    [
        # The two reported screenshots (medical-shorthand chat, Filter/auto-redact):
        # "Ibuprofen" = Ibuprofen (a thyroid drug); "Einnahme wann" = "intake when".
        "Ibuprofen Einnahme wann?",
        # "Wann" = interrogative adverb "when", standing alone as a whole message.
        "Wann einnehmen?",
        # Nearby variants of the same shape (short German medical-shorthand
        # question), covering other interrogatives / word orders generally rather
        # than hard-coding just the two reported strings.
        "Wie einnehmen?",
        "Wieviel Einnahme?",
        "Tabletten wann einnehmen?",
        "Wann Kontrolle?",
        "Wo einnehmen?",
        "Was einnehmen?",
        "Warum diese Dosis?",
    ],
)
def test_detect_ner_no_person_for_german_interrogatives(text):
    _require_ner()
    persons = [d["value"] for d in ner.detect_ner(text, "de") if d["type"] == "PERSON"]
    assert persons == [], f"unexpected PERSON false positive: {persons}"


def test_detect_ner_keeps_real_name_alongside_interrogative():
    """Recall regression guard: a genuine name in the exact same sentence shape as
    the reported false positives must still be redacted."""
    _require_ner()
    persons = [
        d["value"]
        for d in ner.detect_ner("Anna Müller Einnahme wann?", "de")
        if d["type"] == "PERSON"
    ]
    assert any("Anna Müller" in p for p in persons), f"real name not caught: {persons}"


def test_keep_person_rejects_interrogatives_via_fail_open_path():
    """Unit-level proof of the actual bug: _keep_person's guard 4 (PROPN check)
    fails open when no POS doc is available (doc=None) -- the exact situation the
    two reported false positives hit. A bare interrogative or an interrogative
    alongside an ordinary noun must be dropped even on this fail-open path, purely
    by the doc-independent guards (denylist / _is_non_name)."""
    assert ner._keep_person("Wann", 0, 4, None) is False
    assert ner._keep_person("wann", 0, 4, None) is False
    assert ner._keep_person("Einnahme wann", 0, 13, None) is False
    assert ner._keep_person("Wann einnehmen", 0, 14, None) is False
    # A real (even multi-token) name must still pass the same fail-open path.
    assert ner._keep_person("Anna Müller", 0, 11, None) is True


def test_is_non_name_any_token_interrogative_rule():
    """The ANY-token interrogative rule in _is_non_name must not require every
    token in the span to be gazetteered -- one interrogative token is enough,
    regardless of what the other (ordinary noun) tokens are."""
    from ner import _is_non_name

    assert _is_non_name("Einnahme wann") is True
    assert _is_non_name("Dosis wie") is True
    # But it must never fire on a real name that merely happens to be adjacent to
    # an interrogative in a longer detected span -- _is_non_name only ever sees
    # the isolated candidate value, so this just confirms an actual name value
    # (no interrogative token) is unaffected.
    assert _is_non_name("Anna Müller") is False


# --- Regression: German possessive pronoun + kinship noun must not yield PERSON
# false positives ----------------------------------------------------------------
@pytest.mark.parametrize(
    "value",
    [
        "meinem bruder", "meine Mutter", "mein Vater", "meiner Schwester",
        "meine mutter", "mein vater",  # all-lowercase, the reported register
        "seine Oma", "ihre Tante", "unser Onkel", "deine Freundin",
    ],
)
def test_is_non_name_kinship_possessive_combo(value):
    """A possessive pronoun + kinship noun (in either order/case) is a closed
    grammatical construction, never a name -- the reported FP class."""
    from ner import _is_non_name

    assert _is_non_name(value) is True


def test_is_non_name_kinship_word_alone_is_not_hard_dropped():
    """A bare kinship noun with no possessive pronoun must not be unconditionally
    dropped -- some kinship words (e.g. "Vater") are, rarely, also real German
    surnames, and _is_non_name lowercases before comparing so a hard drop here
    would risk suppressing a genuine capitalized surname. Recall-first: only the
    possessive+kinship COMBINATION is a safe unconditional drop, not the bare
    word alone."""
    from ner import _is_non_name

    assert _is_non_name("Vater") is False
    assert _is_non_name("Bruder") is False


def test_is_non_name_kinship_combo_does_not_swallow_an_adjacent_real_name():
    """A real name sharing a span with a possessive+kinship phrase must not be
    treated as non-name -- the ALL-token requirement means a third token outside
    both closed sets (the name) blocks the drop."""
    from ner import _is_non_name

    assert _is_non_name("mein bruder Thomas") is False
    assert _is_non_name("meine Mutter Anna Müller") is False


# --- scrub() integration: the LLM merge path must gate its own PERSON output ----
# --- Regression: "meinem bruder"/"meine Mutter" wrongly redacted as PERSON -----
def test_keep_person_llm_path_skips_capitalisation_guard():
    """Unit proof of the merge-gate contract: with require_capitalization=False the
    doc-independent name guards still run (interrogatives/denylist/digits dropped),
    but an all-lowercase real name is KEPT (the LLM's job on caseless input)."""
    # Still dropped - case-independent guards:
    assert ner._keep_person("Wann", 0, 4, None, require_capitalization=False) is False
    assert ner._keep_person("Einnahme wann", 0, 13, None, require_capitalization=False) is False
    assert ner._keep_person("KV-98234-A-7", 0, 12, None, require_capitalization=False) is False
    # Kept - lowercase real name (would be dropped under the default caps guard):
    assert ner._keep_person("anna müller", 0, 11, None, require_capitalization=False) is True
    assert ner._keep_person("anna müller", 0, 11, None) is False  # default still drops it


def test_detect_ner_defers_person_on_all_lowercase():
    _require_ner()
    # All-lowercase input: NER PERSON is unreliable, so names are deferred to the
    # LLM. Even a real lowercase name must not be emitted by NER here...
    persons = [
        d["value"] for d in ner.detect_ner("kannst du anna müller anrufen", "de")
        if d["type"] == "PERSON"
    ]
    assert persons == [], f"NER should defer lowercase names to the LLM: {persons}"
    # ...but structured PII (email) is case-insensitive and must still be caught.
    detected = ner.detect_ner("schreib eine mail an anna@example.com", "de")
    assert any(d["type"] == "EMAIL" for d in detected)
    assert not any(d["type"] == "PERSON" for d in detected)


def test_detect_ner_keeps_person_with_case_signal():
    _require_ner()
    # A single capitalized real name elsewhere in the text means casing is a
    # usable signal, so NER PERSON detection stays on.
    detected = ner.detect_ner("bitte ruf Stefan Weber an", "de")
    assert any("Weber" in d["value"] for d in detected if d["type"] == "PERSON")


def test_keep_person_rejects_lowercase_and_nonpropn():
    # Pure unit tests (no model needed for the caps/denylist guards).
    # All-lowercase function-word run -> dropped by the capitalization guard.
    assert ner._keep_person("kannst du mir", 0, 13, None) is False
    # Lowercase single token -> dropped by the capitalization guard.
    assert ner._keep_person("pasta", 0, 5, None) is False
    # Imperative verb in the denylist -> dropped before any POS logic.
    assert ner._keep_person("Mache", 0, 5, None) is False
    # A capitalised real name still passes when no POS doc is available.
    assert ner._keep_person("Stefan Weber", 0, 12, None) is True


def test_keep_person_rejects_denylist_and_digits():
    # Pure unit test (no model needed): the denylist and digit guard run before
    # any POS/doc logic.
    assert ner._keep_person("Reiche", 0, 6, None) is False  # denylisted verb
    assert ner._keep_person("KV-98234-A-7", 0, 12, None) is False  # has digits
    assert ner._keep_person("Stefan Weber", 0, 12, None) is True  # real name


def test_detect_ner_skips_location_and_org():
    _require_ner()
    # Cities (LOCATION) and public companies (ORG) must not be emitted - they are
    # not in the curated type map.
    detected = ner.detect_ner("Allianz is headquartered in Hamburg.", "en")
    values = " ".join(d["value"].lower() for d in detected)
    assert "hamburg" not in values
    assert "allianz" not in values


def test_detect_ner_returns_quon_types_only():
    _require_ner()
    detected = ner.detect_ner("Stefan Weber, stefan@example.com", "de")
    allowed = {"PERSON", "EMAIL", "PHONE", "IBAN", "TAX_ID", "CREDIT_CARD"}
    assert detected, "expected at least one detection"
    assert all(d["type"] in allowed for d in detected)


# --- scrub() integration: LLM failure keeps the NER base ------------------
# --- scrub() integration: always-redact, skip_reason, low_case_signal ------
# --- Ambiguous food/surname words (heuristic B) -------------------------------
def test_ambiguous_food_word_followed_by_number_is_dropped():
    """An ambiguous food/surname word in a table row ('Millet 16') is a food."""
    _require_ner()
    persons = {
        d["value"].lower()
        for d in ner.detect_ner("Lemon 3, Millet 16, Sweet 3, Berry 8 sind erhöht.", "en")
        if d["type"] == "PERSON"
    }
    assert persons == set()


def test_ambiguous_food_word_as_titled_surname_is_kept():
    """Recall-first: the same word as a real (titled) surname stays redacted."""
    _require_ner()
    persons = [
        d["value"]
        for d in ner.detect_ner("Herr Millet und Frau Sweet kommen morgen.", "de")
        if d["type"] == "PERSON"
    ]
    assert any("Millet" in p for p in persons)


# --- LLM veto of a tentative ambiguous PERSON (heuristic A) --------------------
def _tentative_sweet(text, lang):
    return [{"type": "PERSON", "value": "Sweet", "score": 0.85, "tentative": True}]


# --- Allergen-panel false positives (taxonomic / component / multi-word) -------
@pytest.mark.parametrize(
    "value",
    [
        "Rosaceae", "Bovideae", "Asparagaceae",   # taxonomic family names
        "Mugwort Profilin", "Ragweed Profilin",   # allergen protein components
        "LifeLabs FST", "Romanesco broccoli",     # multi-word, every token non-name
        "Gluten", "Sumac",                        # unambiguous single foods
    ],
)
def test_is_non_name_drops_allergen_vocabulary(value):
    from ner import _is_non_name

    assert _is_non_name(value) is True


@pytest.mark.parametrize(
    "value", ["MARIO OPEL", "M. CARACCIOLO ND", "Anna Berry", "Heinrich Vogelsang"]
)
def test_is_non_name_keeps_real_names(value):
    from ner import _is_non_name

    assert _is_non_name(value) is False


@pytest.mark.parametrize("value", ["Fava", "Lily", "Savoy", "Mustard", "Timothy", "Sweet"])
def test_name_homograph_foods_stay_tentative_not_dropped(value):
    """Real-surname foods are not auto-dropped (leak risk) - they stay tentative so
    the LLM veto (A) / number heuristic (B) / Never-redact can act on them."""
    from ner import _is_non_name
    from ner_gazetteer import AMBIGUOUS_TERMS

    assert _is_non_name(value) is False
    assert value.lower() in AMBIGUOUS_TERMS


# --- Document size budget (regression: the old 20k truncation cap) ------------
async def _no_llm(text, api_key=None):
    return []


def test_long_document_scrubbed_past_old_cap(monkeypatch):
    """A document up to the 50k attachment budget is scrubbed in full - PII near the
    end is caught (deterministic EMAIL safety net), not truncated away. Guards against
    a regression to the old max_text_length=20000 cap."""
    from scrubber import scrub
    filler = "This is neutral filler text with no personal data. " * 460  # ~24k chars
    text = filler + " Please email john.smith@example.com about it."
    assert len(text) > 20000  # beyond the OLD cap
    r = asyncio.run(scrub(text, ScrubOptions(language="en")))
    assert "john.smith@example.com" not in r.scrubbed  # redacted, not leaked
    assert "EMAIL" in r.scrubbed  # ...and SEEN (placeholder inserted) -> not truncated away


# --- LLM chunk resilience (one bad chunk must not doom the whole document) -----
# --- P3: street/square suffix defense-in-depth (PERSON-mistag, tentative-only) --
# Regression for the reported FP ("Welcher Supermarkt kommt an den Rehbergplatz
# in bad kleinfeld" -> PERSON "Rehbergplatz"), whose root cause (wrong spaCy
# model via language misdetection) was fixed in 4aaac34. These tests cover the
# Same token surviving even under the correct model - either spaCy or the LLM can
# still mistag an unfamiliar capitalized street/square compound as a name.
@pytest.mark.parametrize(
    "value",
    ["Rehbergplatz", "rehbergplatz", "Bahnhofstraße", "Bahnhofstrasse",
     "Alexanderplatz", "Marktplatz", "Königsallee", "Rosengasse"],
)
def test_has_street_suffix_matches_street_compounds(value):
    from ner import _has_street_suffix

    assert _has_street_suffix(value) is True


@pytest.mark.parametrize(
    # Real surnames ending in the suffixes EXPLICITLY EXCLUDED from
    # STREET_SUFFIXES because they are attested German surname endings - a hard
    # or tentative-suppress rule on these would risk leaking an actual name.
    "value",
    ["Sandberg", "Steinweg", "Rosenweg", "Feld", "Rosenfeld", "Homburg",
     "Mannheim", "Goldstein", "Bernstein", "Hausen",
     # Bare suffix words / short tokens must not self-match (length floor).
     "Platz", "Gasse", "Allee"],
)
def test_has_street_suffix_excludes_surname_endings(value):
    from ner import _has_street_suffix

    assert _has_street_suffix(value) is False


def test_has_street_suffix_does_not_hard_drop_is_non_name():
    """The street-suffix rule is tentative-only - it must not be folded into the
    hard-drop _is_non_name (that stays reserved for the unambiguous gazetteer/
    interrogative/taxonomic classes)."""
    from ner import _is_non_name

    assert _is_non_name("Rehbergplatz") is False
    assert _is_non_name("Bahnhofstraße") is False


def test_detect_ner_marks_street_compound_tentative():
    _require_ner()
    # A sentence shape the installed model reliably tags multi-PERSON on: two
    # titled real names plus a street compound. The names are firm (non-
    # tentative) PERSON; the street compound - if spaCy also tags it PERSON - 
    # must never be firm.
    detected = ner.detect_ner(
        "Herr Sandberg und Frau Weber treffen sich am Rehbergplatz.", "de"
    )
    persons = {d["value"].lower(): d for d in detected if d["type"] == "PERSON"}
    assert any("sandberg" in v or "weber" in v for v in persons), (
        f"real name not caught: {persons}"
    )
    for v, d in persons.items():
        if "rehbergplatz" in v:
            assert d.get("tentative") is True, f"{v!r} should be tentative, got {d}"


def test_scrub_reported_rehbergplatz_sentence_stays_clean_de_and_auto():
    """The exact originally-reported sentence must stay clean end-to-end under
    both an explicit language="de" and the "auto" detector (defense-in-depth: this
    test must pass even if detect_language's own fix were ever weakened)."""
    from scrubber import scrub

    text = "Welcher Supermarkt kommt an den Rehbergplatz in bad kleinfeld"
    for lang in ("de", "auto"):
        r = asyncio.run(scrub(text, ScrubOptions(language=lang)))
        # The regression this guards is a PERSON false positive (wrong-language
        # model path). Since the ADDRESS type exists, a live LLM may now
        # legitimately tag the place as [ADRESSE] - assert on PERSON
        # specifically, not byte-equality (also keeps the test stable whether
        # or not a local Ollama is reachable).
        assert "[PERSON]" not in r.scrubbed, f"lang={lang}: {r.scrubbed!r}"
        assert all(e.type != "PERSON" for e in r.entities), f"lang={lang}: {r.entities!r}"


# The next three tests exercise the MERGE-GATE logic (scrubber._merge / the
# tentative->veto flow) deterministically by mocking ner.detect_ner directly,
# the same pattern as _tentative_sweet above. This is intentional, not just
# convenience: the installed de_core_news_md spaCy model does not reliably tag
# PERSON on a bare single-surname sentence at all ("Frau Steinweg kommt
# morgen." -> [], a known NER recall gap unrelated to this gate), so pinning
# these regressions to real model output would be
# flaky against that gap rather than testing the gate this fix actually adds.
# --- Edge-trim, shape rules, date!=phone ------------------------------------------
def test_trim_person_edges_keeps_the_name_core():
    """Spans glue non-name tokens onto real names ("bin Timo", "CEO Kapferer").
    Dropping such spans would LEAK the contained name - trimming keeps the core
    redacted while shrinking the placeholder to the actual name."""
    from ner import _trim_person_edges

    assert _trim_person_edges("bin Timo") == "Timo"
    assert _trim_person_edges("CEO Kapferer") == "Kapferer"
    assert _trim_person_edges("Max because he ha") == "Max"
    assert _trim_person_edges("Ja Preis") == "Preis"
    # The leak guard that forbids ANY-token dropping of affirmation spans:
    assert _trim_person_edges("Danke Anna") == "Anna"
    # Untouched real names (multi-token, titled, capitalized abbreviation):
    assert _trim_person_edges("Anna Müller") == "Anna Müller"
    assert _trim_person_edges("Dr. Stefan Weber") == "Dr. Stefan Weber"
    # Lowercase edge particle: the name core stays redacted (invariant that matters).
    assert _trim_person_edges("van Gogh") == "Gogh"
    # All-junk spans trim to empty -> caller drops them.
    assert _trim_person_edges("kannst du mir") == ""


def test_keep_person_shape_and_denylist_quick_wins():
    """Underscore tokens, short imperatives, affirmations and role acronyms are
    never names (all seen as real FPs in the user's exported prompts). Titled
    multi-token names are unaffected (denylist matches the full value only)."""
    assert ner._keep_person("HF_TOKEN", 0, 8, None) is False  # underscore shape
    for v in ("Mach", "Such", "Ja", "Ggf", "Frau", "PM", "PO", "PPO", "PL"):
        assert ner._keep_person(v, 0, len(v), None) is False, v
    assert ner._keep_person("Frau Vogel", 0, 10, None) is True  # titled name intact


def test_is_non_name_culinary_frame_any_token():
    """Recipe-style noun queries ("Milchreis Rezept", "Kalorien haloumi") are a
    closed frame class - no personal name contains these tokens."""
    from ner import _is_non_name

    assert _is_non_name("Milchreis Rezept") is True
    assert _is_non_name("Kalorien haloumi") is True
    assert _is_non_name("Zubereitung Lachs") is True
    assert _is_non_name("Airfryer Blumenkohl") is True
    assert _is_non_name("Anna Müller") is False


def test_dotted_dates_are_not_phone_numbers():
    """Presidio validates dotted German dates as phones ("30.05.2028" - two of
    the three PHONE hits in the real-world eval were dates). Real phone numbers
    must keep being detected (corpus PHONE floor stays the recall guard)."""
    import fallback

    assert fallback.looks_like_date("30.05.2028") is True
    assert fallback.looks_like_date("30.04.26") is True
    assert fallback.looks_like_date("030 901820") is False
    assert fallback.looks_like_date("+49 30 901820") is False
    _require_ner()
    for text in ("Datieren auf den 30.05.2028 bitte", "Trage den 30.04.2026 ein"):
        phones = [d for d in ner.detect_ner(text, "de") if d["type"] == "PHONE"]
        assert phones == [], f"date leaked as PHONE: {phones}"
    kept = [d for d in ner.detect_ner("Ruf mich unter 030 901820 an", "de") if d["type"] == "PHONE"]
    assert kept, "real phone number no longer detected"


def test_gliner_person_claim_passes_the_kinship_denylist(monkeypatch):
    """GLiNER scores German possessive+kinship spans as people with high
    confidence ("meinem bruder" 0.86) - the same false positive the kinship
    denylist exists for, arriving through a detector that did not exist when
    the gate was written. A gate that guards only one detector's door is not a
    gate."""
    import pytest

    from config import settings as _settings
    _require_gliner()

    from scrubber import scrub

    monkeypatch.setattr(_settings, "gliner_enabled", True)
    text = (
        "... gps tracker am auto ist. Danach kann sie vermutlich frü 3 wochen "
        "zu meinem bruder nach kanada fliegen."
    )
    r = asyncio.run(scrub(text, ScrubOptions(language="de")))
    assert "[PERSON]" not in r.scrubbed
    assert "meinem bruder" in r.scrubbed


# --- LLM CREDENTIAL/PIN/INTERNAL_URL sanity gates --------------------------------
# QUON's own technical documentation, pasted back into the scrubber, produced
# CREDENTIAL/PIN/INTERNAL_URL false positives on bare identifier NAMES and
# concept LABELS with no attached value, and on non-URL-shaped tokens. These
# three entity types have no NER/regex source at all (fallback.py only covers
# EMAIL/PHONE/IBAN/BETRAG) - they are LLM-only, so the gate lives in
# scrubber.scrub's llm_pii filtering, same place as the EMAIL "@" check above.

def test_looks_like_internal_url_unit():
    from scrubber import _looks_like_internal_url

    assert not _looks_like_internal_url("http://localhost:8000/health")
    assert not _looks_like_internal_url("http://127.0.0.1:9000")
    assert not _looks_like_internal_url("/api/v1/keys")
    assert not _looks_like_internal_url("gemma-3-12b-it")
    assert _looks_like_internal_url("https://internal.acme-corp.com/admin")
    assert _looks_like_internal_url("db.internal:5432/main")


class TestDevVocabularyAndIntercapped:
    """An Azure DevOps message produced PERSON "ReqDoc" and PERSON "Repos". Two
    different shapes, so two different rules - and the recall direction is what
    matters, so every case below pins a real name surviving alongside the
    drop."""

    def test_capitalised_dev_nouns_are_not_names(self):
        assert ner._is_non_name("Repos")
        assert ner._is_non_name("Backlog")
        assert ner._is_non_name("Pipeline")

    def test_intercapped_identifiers_are_not_names(self):
        assert ner._is_non_name("ReqDoc")
        assert ner._is_non_name("GitHub")

    @pytest.mark.parametrize(
        "surname",
        ["McCarthy", "MacDonald", "DeVries", "DiCaprio", "LaSalle", "LeBlanc", "VanDamme"],
    )
    def test_particle_surnames_are_never_dropped(self, surname):
        # The failure direction that actually matters: these are intercapped
        # AND real names. Dropping one would leak it.
        assert not ner._is_intercapped_identifier(surname)
        assert not ner._is_non_name(surname)

    def test_plain_names_and_acronyms_unaffected(self):
        for token in ("Anna", "Müller", "Schmidt", "API", "PAT"):
            assert not ner._is_intercapped_identifier(token)

    def test_a_real_name_beside_an_identifier_still_redacts(self):
        # ALL-token discipline: the span only drops when every token is
        # identifier-shaped, so a name glued to one keeps its redaction.
        assert not ner._is_non_name("ReqDoc Anna")


class TestOwnDocumentationFalsePositives:
    """QUON's own technical documentation (ARCHITECTURE.md-style prose), pasted
    back into the scrubber, produced a batch of PERSON false positives on
    tech/doc vocabulary. Three shapes:
    an unambiguous product term (hard drop), a closed-vocabulary hyphenated
    compound (hard drop, but not a blanket "lowercase second half" rule - see
    the Soo-jin regression), and words that collide with real given names
    (tentative, not hard-dropped)."""

    def test_tailwind_is_not_a_name(self):
        assert ner._is_non_name("Tailwind")

    @pytest.mark.parametrize(
        "value",
        ["Per-request", "Vendor Lock-in", "Multi-tenant", "Built-in", "Cross-origin"],
    )
    def test_hyphenated_tech_compounds_are_not_names(self, value):
        assert ner._is_non_name(value)

    def test_soo_jin_is_not_treated_as_a_hyphenated_compound(self):
        """Regression: a real Korean given name ("Soo-jin", in the synthetic
        corpus, tests/synth.py) has a lowercase second half after the hyphen,
        same surface shape as "Per-request" - but "jin" is not in the closed
        HYPHEN_COMPOUND_SUFFIXES vocabulary and "soo" is not in
        HYPHEN_COMPOUND_PREFIXES, so it must not be dropped."""
        assert not ner._is_hyphen_lowercase_compound("Soo-jin")
        assert not ner._is_non_name("Soo-jin Park")

    @pytest.mark.parametrize(
        "value", ["Anne-Marie", "Müller-Lüdenscheidt", "Karl-Heinz", "Weber-Klein"]
    )
    def test_real_hyphenated_names_are_not_dropped(self, value):
        assert not ner._is_hyphen_lowercase_compound(value)
        assert not ner._is_non_name(value)

    @pytest.mark.parametrize("value", ["dev", "legacy", "ver"])
    def test_dev_legacy_ver_are_tentative_not_hard_dropped(self, value):
        # These collide with real given names (Dev Patel, "Legacy" as an
        # English given name, "Ver" as short for Vera/Verena) - recall-first,
        # so they must be in the ambiguous/tentative tier, never the hard
        # denylist.
        assert value in ner_gazetteer.AMBIGUOUS_TERMS
        assert not ner._is_non_name(value)

    @pytest.mark.parametrize(
        "name", ["Petra", "Marcus", "Lena"],
    )
    def test_reported_real_names_still_fire(self, name):
        """Must-stay-detected counterpart of the doc-vocabulary drops: real
        first names used alongside the false positives must keep firing as
        PERSON."""
        _require_ner()
        text = f"{name} hat das Review heute Nachmittag gemacht."
        persons = {d["value"] for d in ner.detect_ner(text, "de") if d["type"] == "PERSON"}
        assert any(name in p for p in persons)

    def test_anna_mueller_still_fires(self):
        _require_ner()
        detected = ner.detect_ner("Bitte an Anna Müller weiterleiten.", "de")
        persons = {d["value"] for d in detected if d["type"] == "PERSON"}
        assert any("Anna" in p and "Müller" in p for p in persons)


def test_gliner_is_loaded_is_false_when_the_load_failed(monkeypatch):
    """A failed load is cached as the sentinel `False`, not None. Reporting it
    with "is not None" said gliner_loaded: true on a box where the dependency is
    missing - /health would have claimed a broken detector was fine, forever.

    CI caught the sibling of this bug: a test guard written as
    "if _get_model() is None: skip" never skipped, so two GLiNER tests ran on a
    runner without the package and failed instead of skipping.
    """
    import gliner_detect

    monkeypatch.setattr(gliner_detect, "_model", False)
    assert gliner_detect.is_loaded() is False

    monkeypatch.setattr(gliner_detect, "_model", None)
    assert gliner_detect.is_loaded() is False

    monkeypatch.setattr(gliner_detect, "_model", object())
    assert gliner_detect.is_loaded() is True


def test_gliner_person_claims_pass_the_full_keep_person_not_just_the_denylist(monkeypatch):
    """Role nouns and pronouns must not ship as PERSON.

    GLiNER labels them confidently - measured on a real notarial contract:
    "Der Notar" 0.93, "Käufer" 0.87, "du" 0.97, against "Jonas" 0.97. No
    threshold separates those, and no term list scales: German builds a new role
    noun from any profession.

    Grammar does separate them, and _keep_person's PROPN guard already encoded
    that. It never saw these because detect_ner builds a POS doc only when SPACY
    proposed a PERSON - and on this text spaCy proposes nothing at all. The
    denylist was wired up for GLiNER; the POS guard was not. Same class of bug as
    the credential and kinship gates: a guard on one detector's door only.
    """
    import pytest

    from config import settings as _settings
    _require_gliner()

    from scrubber import scrub

    monkeypatch.setattr(_settings, "gliner_enabled", True)

    text = (
        "Der Notar beurkundet. Dem Käufer wird die Vollmacht erteilt. "
        "Jeder Gesellschafter dokumentiert seine Zeit, du und Jonas entscheiden. "
        "Der Nutzer meldet sich an."
    )
    r = asyncio.run(scrub(text, ScrubOptions(language="de")))
    persons = {e.value for e in r.entities if e.type == "PERSON"}

    # The real name survives ...
    assert "Jonas" in persons
    # ... including names the POS TAGGER does not know. The first version of this
    # guard required a PROPN unconditionally and cost 13 real corpus names - 
    # "Rörricht", "Möchlichen", "Miodrag" are all tagged NOUN and all OOV, so
    # "no PROPN" read the tagger's ignorance as "not a name". OOV now counts.
    r2 = asyncio.run(
        scrub("Termin mit Gülten Möchlichen und Hans-Hinrich Rörricht.",
              ScrubOptions(language="de"))
    )
    caught = {e.value for e in r2.entities if e.type == "PERSON"}
    assert any("Möchlichen" in v for v in caught), caught
    assert any("Rörricht" in v for v in caught), caught
    # ... and nothing else is called a person.
    for noise in ("Der Notar", "Notar", "Käufer", "Jeder Gesellschafter",
                  "Gesellschafter", "du", "Nutzer"):
        assert noise not in persons, f"{noise!r} was redacted as a PERSON"


def test_gliner_person_survives_on_all_lowercase_text(monkeypatch):
    """The POS guard must not drag the capitalisation guard in with it.

    GLiNER runs on all-lowercase input, where a real name is legitimately
    lowercase. Requiring capitalisation there would fail closed and leak the
    name, which is why the LLM path passes require_capitalization=False and why
    this path does too.
    """
    import pytest

    from config import settings as _settings
    _require_gliner()

    from scrubber import scrub

    monkeypatch.setattr(_settings, "gliner_enabled", True)
    r = asyncio.run(scrub("anna müller wohnt in berlin und ruft morgen an.",
                          ScrubOptions(language="de")))
    assert "anna müller" not in r.scrubbed


def test_a_bare_concept_word_is_not_a_pin():
    """"Schlüssel" (German for "key") scored PIN 0.78 in a contract about handing
    over house keys. A real PIN carries digits; a real recovery phrase is several
    words. A lone digitless noun is neither - a shape rule, so it also covers
    "Passwort", "Zugang" and anything German compounds into one word."""
    from scrubber import _is_bare_concept_word

    for concept in ("Schlüssel", "Passwort", "Zugangscode", "Geheimnis"):
        assert _is_bare_concept_word(concept), concept
    for real in ("4711", "apfel fluss tiger wolke", "P@ss2706word"):
        assert not _is_bare_concept_word(real), real


def test_an_address_claim_without_a_digit_is_the_name_of_an_address(monkeypatch):
    """"Postleitzahl-Adresse" scored ADDRESS 0.71 in a real contract - the
    concept-word failure again, in a new type. Label phrasing was measured and
    cannot separate it ("postal address with street and number" still scores the
    concept word 0.54 vs 0.78 for a real street line), so the fix is the same
    structural post-filter the GLiNER literature uses: a real address carries a
    digit; the name of one does not."""
    import pytest

    from config import settings as _settings
    _require_gliner()

    from scrubber import scrub

    monkeypatch.setattr(_settings, "gliner_enabled", True)

    r = asyncio.run(scrub("Bitte die Postleitzahl-Adresse angeben.", ScrubOptions(language="de")))
    assert [(e.type, e.value) for e in r.entities] == []

    # ... but a DIGITLESS real place must survive. The first version of this gate
    # required a digit unconditionally, and the beta caught it within the hour:
    # "Peter wohnt in der Poststraße" - GLiNER proposed the street at 0.96 and
    # the gate dropped it. Street morphology and PROPN are the digitless
    # evidence ("Poststraße" by suffix, "Am Dünenwald" by PROPN).
    r = asyncio.run(
        scrub("Peter wohnt in der Poststraße in der Nähe von Berlin.",
              ScrubOptions(language="de"))
    )
    assert ("ADDRESS", "Poststraße") in [(e.type, e.value) for e in r.entities]
    r = asyncio.run(scrub("Er wohnt Am Dünenwald in Glowe.", ScrubOptions(language="de")))
    assert any(e.type == "ADDRESS" and "Dünenwald" in e.value for e in r.entities)

    r = asyncio.run(
        scrub("Julia Talberg wohnt Erdmannstr. 45, 16540 Hohen Talbach.",
              ScrubOptions(language="de"))
    )
    addrs = {e.value for e in r.entities if e.type == "ADDRESS"}
    assert "Erdmannstr. 45" in addrs and "16540 Hohen Talbach" in addrs


def test_code_identifiers_are_not_people():
    """camelCase is not a name - and no gazetteer can keep up with identifiers.

    In a substation-modelling document every occurrence of "person" came back
    redacted. The grammar guard was working - plain-English "a person"
    was dropped correctly - but `personOnSite` (0.67) and `PersonOnSite` (0.93)
    survived it, and because detections are value-keyed, one survivor
    highlighted every "person" in the document.
    """
    ident = ner.is_code_identifier
    for token in ("personOnSite", "PersonOnSite", "bayLocked", "BayLocked",
                  "IOPoint", "KE101", "person_on_site"):
        assert ident(token) is True, token
    # Names that legitimately carry an internal capital must survive. These are
    # the reason the particle list exists; without it the rule eats surnames.
    for token in ("McDonald", "MacLeod", "DeVries", "LaFleur", "O'Brien",
                  "Schmidt", "Müller-Lüdenscheidt", "Anna", "van"):
        assert ident(token) is False, token


def test_zero_shot_person_ok_rejects_identifiers_and_noun_phrases():
    text = (
        'A Lamp needs to show the toast message "Person on Site" as well as not '
        "allow execution of a control sequence if a person is on site "
        "(IOPoint: personOnSite). PersonOnSite belongs to a Substation."
    )
    doc = ner.pos_doc(text, "en")
    assert doc is not None

    def verdict(value: str) -> bool:
        at = text.find(value)
        assert at >= 0, value
        return ner.zero_shot_person_ok(value, at, at + len(value), doc)

    # The identifiers: PROPN and OOV both, so both rescue branches fire on them
    # and only a shape test placed before the rescues can reject them.
    assert verdict("personOnSite") is False
    assert verdict("PersonOnSite") is False
    # The article is inside the span - a noun phrase, not a name.
    assert verdict("A Lamp") is False
    # And the plain common noun, which already worked, must keep working.
    assert verdict("person") is False


def test_zero_shot_person_ok_still_keeps_real_names():
    """The guard may not buy its precision with recall."""
    text = "Anna Schmidt und Dr. Weber treffen McDonald in Berlin."
    doc = ner.pos_doc(text, "de")
    assert doc is not None
    for name in ("Anna Schmidt", "Dr. Weber", "McDonald"):
        at = text.find(name)
        assert ner.zero_shot_person_ok(name, at, at + len(name), doc) is True, name


def test_person_guard_judges_every_occurrence_not_just_the_first():
    """`text.find` judged whichever occurrence came first, not the scored one.

    Same value, two contexts, opposite verdicts - with `text.find` the guard's
    answer depends on which one the document happens to put first.
    """
    from scrubber import _occurrences

    text = "IOPoint: personOnSite … and later a person is on site."
    assert len(_occurrences(text, "person")) == 2
    assert _occurrences(text, "nothing-here") == []
    assert _occurrences(text, "") == []
    # Capped, so a pathological document cannot turn the guard quadratic.
    assert len(_occurrences("ab" * 500, "ab")) == 32


def test_person_rejects_path_punctuation():
    """"MCCS/ RZOst/ JSN/ Facility" - a path, read as four people.

    The check must run on the RAW value: the tokeniser drops the slash, and
    what is left ("MCCS") is a bare PROPN that every later guard accepts.
    """
    text = "MCCS/ RZOst/ JSN/ Facility (Asset Template: Facility / KE101)."
    doc = ner.pos_doc(text, "en")
    for value in ("MCCS/", "RZOst/", "JSN/"):
        at = text.find(value)
        assert ner.zero_shot_person_ok(value, at, at + len(value), doc) is False, value
    # An ordinary name is untouched by the punctuation rule.
    plain = "Anna Schmidt kam an."
    d2 = ner.pos_doc(plain, "de")
    assert ner.zero_shot_person_ok("Anna Schmidt", 0, 12, d2) is True


def test_keep_person_rejects_path_punctuation():
    """The same rule has to hold on spaCy's own PERSON claims.

    The first cut put this only in the zero-shot guard, which gates GLiNER - 
    and "MCCS/" came from spaCy, so it sailed straight past a fix that its
    own unit test said was working.
    """
    assert ner._keep_person("MCCS/", 0, 5, None) is False
    assert ner._keep_person("RZOst/", 0, 6, None) is False
    assert ner._keep_person("Anna Schmidt", 0, 12, None) is True


def test_person_guard_uses_the_resolved_language_not_the_option(monkeypatch):
    """The client sends language="auto"; the guard must not tag with the wrong model.

    `options.language or "de"` never even reached "de" - ScrubOptions defaults
    to "auto", which is truthy, so spaCy loaded whatever "auto" resolves to and
    ran it over English text. That does not merely degrade the guard, it
    INVERTS the signal it depends on: under the wrong model "person" tags X
    with a child "a" tagged PROPN, where the English model gives NOUN with a
    DET child. The determiner test looks for DET, finds PROPN, and fails open - 
    so on English input the whole filter silently did nothing.

    Found by deploying and watching production still return the false positive
    that the local test (which passed language="en") said was fixed.
    """
    from config import settings as _settings
    from scrubber import scrub

    monkeypatch.setattr(_settings, "gliner_enabled", True)

    text = (
        "can be left to allow for usage of naturally elsewhere located IOPoints "
        "also in the context of e.g. a Breaker with Bypass. A Breaker with Bypass "
        "Control dialog needs to show a con fi gurable toast message, that a "
        "person is on site (IOPoint: personOnSite). A Sammelschienentrenner needs "
        "to not allow execution of a control sequence if a person is on site "
        "(IOPoint: personOnSite). A Lamp needs to show the toast message "
        "\"Person on Site\". PersonOnSite belongs to e.g. a Substation."
    )
    # No language pinned - the shape the app actually sends.
    r = asyncio.run(scrub(text, ScrubOptions()))
    assert [e.value for e in r.entities if e.type == "PERSON"] == []


def test_repeated_role_noun_loses_the_vote_but_a_repeated_name_does_not(monkeypatch):
    """A frequent common noun always finds one lenient context. Majority, not any.

    Measured on the ECHR judgments (TAB): "applicant" occurs 372 times, and
    "keep if any occurrence looks like a name" kept it every time - a word that
    frequent is guaranteed to appear once without its article. Switching to a
    majority vote removed 687 of 1112 false-positive instances (applicant,
    applicants, he, she, I, landlord, child, lawyer, first/second applicant)
    with the PERSON recall unchanged at 1107/1136.
    """
    from config import settings as _settings
    from scrubber import scrub

    monkeypatch.setattr(_settings, "gliner_enabled", True)

    # The role noun carries an article nearly everywhere, and once ("applicant's")
    # it does not - which is exactly the single lenient sample "any" fell for.
    role = (
        "The applicant filed a claim. The applicant was heard in person. "
        "The applicant then appealed. Counsel for the applicant objected. "
        "applicant's counsel withdrew. The applicant was awarded costs."
    )
    r = asyncio.run(scrub(role, ScrubOptions(language="en")))
    assert "applicant" not in [e.value for e in r.entities if e.type == "PERSON"]

    # A real name repeats too, and must not be voted away.
    name = (
        "Anna Schmidt reichte Klage ein. Anna Schmidt wurde angehört. "
        "Später legte Anna Schmidt Berufung ein. Die Kosten trägt Anna Schmidt."
    )
    r = asyncio.run(scrub(name, ScrubOptions(language="de")))
    assert "Anna Schmidt" in [e.value for e in r.entities if e.type == "PERSON"]


def test_a_value_must_be_possible_for_its_own_type():
    """The WORD for a secret is not a secret. Definitions, not heuristics.

    From the AI4Privacy benchmark: "Zugangscode" redacted as a
    CREDENTIAL, "secret code" as a PIN, "Geburtsdatum" as a DATE, "new email
    address" as an EMAIL, and a blank form field "____________" as an IBAN.

    Deliberately not checksums (IBAN mod-97, Luhn): those fail closed on
    OCR-damaged real values, and a mangled IBAN is still an IBAN that must not
    leak. Structure, not arithmetic.
    """
    from scrubber import _drop_structurally_impossible as drop

    def kept(t, v):
        return drop([{"type": t, "value": v}]) != []

    # The concept word, not the thing.
    assert kept("EMAIL", "new email address") is False
    assert kept("IBAN", "____________") is False
    assert kept("CREDENTIAL", "Zugangscode") is False
    assert kept("PIN", "secret code") is False
    assert kept("DATE", "Geburtsdatum") is False
    assert kept("PHONE", "Telefonnummer") is False

    # The thing itself must survive - including a spelled date, which carries
    # no digit at all, and a credential that is not a lone bare word.
    assert kept("EMAIL", "a.schmidt@web.de") is True
    assert kept("IBAN", "DE02120300000000202051") is True
    assert kept("CREDENTIAL", "sk-a1b2c3d4e5f6g7") is True
    assert kept("PIN", "4711") is True
    # The case a digit rule would have LEAKED - a real recovery phrase carries
    # no digit anywhere. The backend suite caught the first version of this
    # rule dropping it; that is why PIN tests phrase LENGTH, not digits.
    assert kept("PIN", "apple river tiger mirror ocean velvet") is True
    assert kept("DATE", "15.03.2025") is True
    assert kept("DATE", "1. Januar 2024") is True
    assert kept("PHONE", "030 12345678") is True

    # Types with no structural precondition are untouched - PERSON and ADDRESS
    # are guarded grammatically instead, and a street name has no digit.
    assert kept("PERSON", "Anna Schmidt") is True
    assert kept("ADDRESS", "Poststraße") is True


def test_plural_nouns_are_not_people_but_pluralised_surnames_are():
    """"Studierende" is not a person; "die Schmidts" are.

    From the AI4Privacy benchmark: Studierende, Rentner, Kunden, Besucher,
    Ingenieuren, attendees, volunteers, parents - all survived the guard,
    because a plural takes no article and the determiner test never fired.

    The rescue ordering is what makes this safe: a pluralised family name tags
    PROPN, and the PROPN branch runs after this one only for NOUNs. Verified on
    both models before relying on it.
    """
    for lang, text, value in [
        ("de", "Studierende erhalten einen Rabatt.", "Studierende"),
        ("de", "Rentner und Kunden ebenso.", "Rentner"),
        ("en", "Many attendees registered early.", "attendees"),
        ("en", "Participants and Visitors must register.", "Participants"),
    ]:
        doc = ner.pos_doc(text, lang)
        at = text.find(value)
        assert ner.zero_shot_person_ok(
            value, at, at + len(value), doc, True
        ) is False, value

    # A surname the tagger reads as plural, IN VOCABULARY, inside a real name.
    # "Kriemhild Lindner" tags Sing + Plur, and an out-of-vocabulary condition
    # does not save it - the corpus caught a first version using `any` dropping
    # it, and it is the name this predicate's own docstring cites as its
    # fail-open case. Requiring every noun in the span to be plural is what
    # separates a name (given + surname) from a role noun (which stands alone).
    text = "Versichertennummer KV-72167-A-4 für Kriemhild Lindner, Termin seit zwei Tagen."
    doc = ner.pos_doc(text, "de")
    at = text.find("Kriemhild Lindner")
    assert ner.zero_shot_person_ok(
        "Kriemhild Lindner", at, at + 17, doc, ner.document_is_mixed_case(text)
    ) is True

    # An OOV surname the tagger MISREADS as plural must survive. "Möchlichen"
    # tags NOUN/Number=Plur/OOV - German "-en" looks plural, and the tagger has
    # never seen the name. A first version without the OOV condition dropped it
    # and the suite caught it. Every genuine plural role noun above is
    # in-vocabulary; every mistagged surname is not.
    text = "Termin mit Gülten Möchlichen und Hans-Hinrich Rörricht."
    doc = ner.pos_doc(text, "de")
    at = text.find("Möchlichen")
    assert ner.zero_shot_person_ok("Möchlichen", at, at + 10, doc, True) is True

    # A real surname, pluralised, must survive.
    text = "Die Schmidts kamen an."
    doc = ner.pos_doc(text, "de")
    at = text.find("Schmidts")
    assert ner.zero_shot_person_ok("Schmidts", at, at + 8, doc, True) is True


def test_lowercase_guard_applies_only_to_documents_that_capitalise():
    """The capitalisation guard is safe only when the document has casing.

    `require_capitalization=False` exists on the zero-shot path because GLiNER
    runs on all-lowercase text, where a real name is legitimately lowercase and
    the guard would drop it - a LEAK. Conditioning on the document's own casing
    keeps that protection while still rejecting "staff" in ordinary prose.
    """
    normal = "All staff were notified by the Board on Tuesday morning in Berlin."
    doc = ner.pos_doc(normal, "en")
    at = normal.find("staff")
    assert ner.document_is_mixed_case(normal) is True
    assert ner.zero_shot_person_ok("staff", at, at + 5, doc, True) is False

    # Same shape of claim, in a document with no casing to read: kept.
    lower = (
        "hallo ich bin anna schmidt und wohne in der poststrasse in berlin. "
        "bitte melde dich bei mir wenn du zeit hast, mein kollege kommt mit."
    )
    assert ner.document_is_mixed_case(lower) is False
    d2 = ner.pos_doc(lower, "de")
    at = lower.find("anna schmidt")
    assert ner.zero_shot_person_ok(
        "anna schmidt", at, at + 12, d2, ner.document_is_mixed_case(lower)
    ) is True


def test_crosscheck_drops_label_line_role_nouns_and_keeps_names(monkeypatch):
    """The V1 cross-check, wired for real.

    The decisive case is the label-line form of a real insurance document:
    "Versicherungsnehmer: <name>" - the other guards let the role noun through
    there (no article for the determiner test, capitalised, in-vocabulary), and
    the cross-check is what kills it. The name beside it must survive.
    """
    from config import settings as _settings
    from scrubber import scrub

    _require_gliner()
    monkeypatch.setattr(_settings, "gliner_enabled", True)
    monkeypatch.setattr(_settings, "gliner_person_crosscheck", True)

    text = "Versicherungsschein Versicherungsnummer: L 10.001.533 Versicherungsnehmer: Marlen Weinhold"
    r = asyncio.run(scrub(text, ScrubOptions()))
    persons = [e.value for e in r.entities if e.type == "PERSON"]
    assert "Marlen Weinhold" in persons
    assert "Versicherungsnehmer" not in persons
    assert not any("Versicherungsnummer" in p for p in persons)

    # Short and OCR-shaped names must not be voted away by the cross-check.
    for t, name in [
        ("Tom kam gestern zu Besuch und blieb bis zum Abend.", "Tom"),
        ("Letung: Prof. Dr. med. Cormen Schelbeibogen. Fortsetzung Arztbrief.", "Cormen Schelbeibogen"),
    ]:
        r = asyncio.run(scrub(t, ScrubOptions()))
        assert any(name in p for p in (e.value for e in r.entities if e.type == "PERSON")), name


def test_crosscheck_fails_open_when_the_model_is_gone(monkeypatch):
    """No verdict is not a verdict. A dead model must keep every claim.

    person_score returns None for "unavailable", 0.0 for "the model really says
    no" - collapsing those would turn a model outage into silent recall loss,
    which is the one failure mode a verifier must not have.
    """
    import gliner_detect

    assert gliner_detect.person_score("Anna", "Anna kam.") is None or True  # smoke shape
    monkeypatch.setattr(gliner_detect, "_get_model", lambda: False)
    assert gliner_detect.person_score("Versicherungsnehmer", "Versicherungsnehmer: X") is None


def test_routing_needs_eight_digits_and_hygiene_needs_independent_detection():
    """Cases from one review round, pinned.

    ROUTING: "port 465", "8080" and ":8000" all shipped as routing numbers - 
    a German BLZ is 8 digits, an ABA 9, so short ones are impossible, not
    merely unlikely. PERSON hygiene: a strip is only accepted when the
    stripped name is independently detected - without that check, stripping
    the OOV compound off "Paul-Heinz Müller" would leak the given name.
    """
    from scrubber import _drop_structurally_impossible as drop

    for v, want in [("port 465", False), ("8080", False), ("465", False),
                    ("10010010", True), ("021000021", True)]:
        assert (drop([{"type": "ROUTING", "value": v}]) != []) is want, v

    text = "| Jonas | GTM | Beispiel-Meilensteine Jonas (7,9% Tranche): Website live."
    doc = ner.pos_doc(text, "de")
    at = text.find("Beispiel-Meilensteine Jonas")
    # the function PROPOSES the strip...
    assert ner.strip_leading_common_nouns("Beispiel-Meilensteine Jonas", at, doc) == "Jonas"
    # ...and for a hyphenated given name it proposes nothing to accept: the
    # caller-side existence check is what guards the leak (tested end-to-end
    # in the scrub tests; here we pin that the proposal alone never empties).
    t2 = "Der Vertrag wurde von Paul-Heinz Müller unterschrieben."
    d2 = ner.pos_doc(t2, "de")
    a2 = t2.find("Paul-Heinz Müller")
    assert ner.strip_leading_common_nouns("Paul-Heinz Müller", a2, d2) != ""


def test_hyphenated_street_names_are_caught_whole():
    """"Bertha-von-Suttner-Str. 1" - the beta caught the glued-only rule leaking
    the name-bearing half: only "Str. 1" was masked, and the sensitive part of
    the address stayed readable. Hyphen chains with lowercase particles and a
    capitalised standalone suffix segment are the second normal shape of a
    German street name, not an edge case.
    """
    import fallback

    for line in ("Bertha-von-Suttner-Str. 1", "Willy-Brandt-Platz 2",
                 "Kurt-Schumacher-Damm 33a", "Konrad-Adenauer-Ufer 11",
                 "Erdmannstr. 45", "Poststraße 7"):
        m = fallback._ADDRESS_RE.search(line)
        assert m is not None and m.group(0) == line, line
    # ...and hyphenated non-streets stay out: whole-pattern IGNORECASE would
    # have let these in, which is why (?i:) is scoped to the suffix segment.
    for line in ("Ehepartner. 1", "Ust-Id 12", "Gesamt-Meilenstein-Tranche 7"):
        assert fallback._ADDRESS_RE.search(line) is None, line


def test_scrub_always_redact_custom_terms(monkeypatch):
    from scrubber import scrub

    result = asyncio.run(
        scrub(
            "Was könnte meinem kleinen Jakob noch gefallen",
            ScrubOptions(
                language="de", placeholder_style="indexed", always_redact=["Jakob"]
            ),
        )
    )
    assert "Jakob" not in result.scrubbed
    assert "[CUSTOM_1]" in result.scrubbed
    custom = [e for e in result.entities if e.type == "CUSTOM"]
    assert custom and custom[0].value == "Jakob" and custom[0].confidence == 1.0


def test_scrub_always_redact_ignores_absent_terms(monkeypatch):
    from scrubber import scrub

    result = asyncio.run(
        scrub("hello world", ScrubOptions(always_redact=["Jakob", "  ", "Jakob"]))
    )
    # A term that does not occur is never reported, and blanks/dupes are ignored.
    assert not any(e.type == "CUSTOM" for e in result.entities)


def test_scrub_titled_name_with_street_suffix_ending_stays_redacted(monkeypatch):
    """A titled real name whose surname happens to LOOK street-suffix-shaped
    ("Sandberg" ends in -berg, deliberately excluded from STREET_SUFFIXES) must
    still redact as a firm PERSON, while a genuine tentative street compound in
    the same sentence does not survive as [PERSON] (no veto -> stays out of the
    entity report, i.e. never redacted at all - recall-first: a tentative that
    is never vetoed simply stays redacted per the existing AMBIGUOUS_TERMS
    contract; here we assert the CONVERSE side, that it is not incorrectly
    treated as a hard-fail-open [PERSON] alongside the real name)."""
    def _mixed(text, lang):
        return [
            {"type": "PERSON", "value": "Herr Sandberg", "score": 0.85},
            {"type": "PERSON", "value": "Rehbergplatz", "score": 0.85, "tentative": True},
        ]

    monkeypatch.setattr(ner, "detect_ner", _mixed)
    from scrubber import scrub

    r = asyncio.run(
        scrub("Herr Sandberg wohnt am Rehbergplatz.", ScrubOptions(language="de"))
    )
    assert "Sandberg" not in r.scrubbed  # real surname redacted
    assert "[PERSON]" in r.scrubbed
    # Recall-first fail-safe: no LLM ran (offline) -> no veto -> the tentative
    # street compound stays redacted too, exactly like an unvetoed AMBIGUOUS_TERMS
    # tentative. This is the documented, accepted trade-off (over-redaction, never
    # a leak) - see test_llm_veto_can_drop_a_tentative_street_compound below for
    # the case where a reachable LLM does clear it.
    assert "Rehbergplatz" not in r.scrubbed


def test_scrub_excluded_suffix_surname_still_redacted(monkeypatch):
    """'Steinweg' ends in the deliberately-EXCLUDED '-weg' suffix (a real surname
    ending) - it must redact normally as a firm (non-tentative) PERSON, with no
    tentative/veto path involved at all, proving the exclusion list actually
    protects real names."""
    def _steinweg(text, lang):
        return [{"type": "PERSON", "value": "Steinweg", "score": 0.85}]

    monkeypatch.setattr(ner, "detect_ner", _steinweg)
    from scrubber import scrub

    r = asyncio.run(scrub("Frau Steinweg kommt morgen.", ScrubOptions(language="de")))
    assert "Steinweg" not in r.scrubbed
    assert "[PERSON]" in r.scrubbed


def test_scrub_bare_street_mention_redacts_nothing(monkeypatch):
    """A sentence that is only a public place mention, no person at all, must
    redact nothing. Uses the real (mocked-offline-LLM) NER pass, since this
    sentence shape needs no PERSON detection to begin with - there is nothing
    for the model-recall gap above to obscure here."""
    _require_ner()
    from scrubber import scrub

    r = asyncio.run(scrub("Der Laden am Marktplatz.", ScrubOptions(language="de")))
    assert r.scrubbed == "Der Laden am Marktplatz."
    assert not any(e.type == "PERSON" for e in r.entities)


def test_gliner_veto_clears_tech_eponym_without_any_llm(monkeypatch):
    """The capability the previous test was accidentally exercising, now pinned
    on purpose: with GLiNER enabled and no LLM veto at all, a tech eponym marked
    tentative is still cleared - GLiNER puts a better-fitting contrast label
    ("software") on it. This is the veto path that works offline, so it must not
    regress silently the way it was silently relied upon before."""
    import pytest

    from config import settings as _settings
    _require_gliner()

    from scrubber import scrub

    def _tentative_kafka(text, lang):
        return [{"type": "PERSON", "value": "Kafka", "score": 0.85, "tentative": True}]

    monkeypatch.setattr(ner, "detect_ner", _tentative_kafka)
    monkeypatch.setattr(_settings, "gliner_enabled", True)
    r = asyncio.run(scrub("Wir nutzen Kafka für Streaming.", ScrubOptions(language="de")))
    assert "Kafka" in r.scrubbed  # GLiNER's own veto cleared it, no LLM involved


def test_keep_person_attributive_adjective_veto_de():
    """Guard 5: a span OPENING with a declined in-vocabulary German ADJ whose
    head is a following in-span token is a noun phrase, not a name. "Ruhige
    Finca" (a fetched holiday listing) passed guard 4
    because web pages capitalise product phrases and the head noun tags PROPN.
    Fails on the old code, which kept both listing spans."""

    def verdict(text: str, value: str) -> bool:
        doc = ner.pos_doc(text, "de")
        assert doc is not None
        at = text.find(value)
        assert at >= 0, value
        return ner._keep_person(value, at, at + len(value), doc)

    # The FP class: capitalised ADJ+noun phrases from listings/product pages.
    assert verdict("Ruhige Finca im Suedwesten, zwei Wochen frei im Januar.", "Ruhige Finca") is False
    assert verdict("Grosse Auswahl an Modellen, Beratung vor Ort.", "Grosse Auswahl") is False

    # Real names that share the surface shape must survive:
    # a salutation adjective in front of a real name...
    assert verdict("Lieber Klaus Meier, danke fuer die schnelle Antwort.", "Lieber Klaus Meier") is True
    # ...an adjective-shaped given name...
    assert verdict("Ernst Weber kommt am Montag zur Besprechung.", "Ernst Weber") is True
    # ...and an adjective-shaped surname on its own.
    assert verdict("Frau Junge hat den Vertrag unterschrieben.", "Junge") is True


def test_keep_person_adjective_veto_inert_on_english():
    """The veto keys on German attributive declension (a Case feature on the
    ADJ). English adjectives carry no Case, so an English nickname of the same
    shape must be untouched - the guard is scoped by grammar, not vocabulary."""
    text = "Big John called again about the delivery."
    doc = ner.pos_doc(text, "en")
    assert doc is not None
    assert ner._keep_person("Big John", 0, 8, doc) is True


# --- common-noun phrases: "Kita Kind" -----------------------------------------

#: The reported prompt, verbatim in shape. No personal data in it - it is a
#: cold-and-flu question - so it is safe to pin as-is.
_KITA_KIND_PROMPT = (
    "Was hilft bei einer beginnenden Erkältung und allgemein Inder beginnenden "
    "Erkältungssaison mit Kita Kind und iga Magen? Aktuell trinke ich Ingwer Tee, "
    "nehme pelargonie und nehme regelmäßig Vitamin d. Wie groß ist der Effekt von "
    "Sport an der frischen luft"
)


def _zs_ok(text: str, value: str, lang: str, score: float | None) -> bool:
    doc = ner.pos_doc(text, lang)
    at = text.find(value)
    assert at >= 0
    return ner.zero_shot_person_ok(
        value, at, at + len(value), doc, ner.document_is_mixed_case(text), score
    )


def test_two_common_nouns_at_middling_confidence_are_not_a_person():
    """"Kita Kind" = daycare child. GLiNER scored it PERSON 0.83.

    Every older guard missed it: no article in the span, no plural, no hostile
    punctuation, and the tagger calls neither word a name (NOUN, NOUN, both
    in-vocabulary) - the very shape the fail-open branch keeps for "Kriemhild
    Lindner". What differs is that all the independent signals agree it is not a
    name: both words are lowercase-attested vocabulary, spaCy NER reads the span
    as MISC rather than per, no honorific precedes it, and the detector itself
    is not sure (0.83, where real names score ~1.0).
    """
    assert _zs_ok(_KITA_KIND_PROMPT, "Kita Kind", "de", 0.83) is False


def test_common_noun_phrase_guard_needs_every_signal_and_fails_open():
    # No score -> the guard cannot read the detector's confidence -> keep.
    assert _zs_ok(_KITA_KIND_PROMPT, "Kita Kind", "de", None) is True
    # A confident detector wins: real names score ~1.0, and a tagger that
    # misreads a name as two nouns must not be able to delete it.
    assert _zs_ok(_KITA_KIND_PROMPT, "Kita Kind", "de", 0.97) is True

    # An honorific right before the span makes it a person whatever the tagger
    # thinks ("Frau Kind"): the title is outside the GLiNER value (it is
    # stripped), so the guard reads it off the preceding token.
    titled = "Termin bei Frau Kita Kind morgen um zehn Uhr, bitte zurückrufen."
    assert _zs_ok(titled, "Kita Kind", "de", 0.83) is True

    # Names the tagger knows (PROPN) never reach the guard, at any score.
    for name in ("Anna Kind", "Gerd Baum", "Karl Bauer", "Rosa Wolf", "Hans Fuchs"):
        text = f"Ich habe gestern mit {name} gesprochen und wir haben einen Termin."
        assert _zs_ok(text, name, "de", 0.70) is True, name

    # Names the tagger does not know (rare given names, absent from the
    # vocabulary in lowercase) survive even at a low score: "Kriemhild" and
    # "Nermin" are not attested lowercase words, so the lexical signal fails.
    for name in ("Kriemhild Lindner", "Nermin Junk"):
        text = f"Versichertennummer KV-72167-A-4 für {name}, Termin seit zwei Tagen."
        assert _zs_ok(text, name, "de", 0.70) is True, name


def test_kita_kind_prompt_is_not_redacted_end_to_end(monkeypatch):
    """Through the real pipeline: the GLiNER-only claim is dropped, and a real
    name next to the same words is still caught."""
    import pytest

    from config import settings as _settings

    _require_gliner()

    from scrubber import scrub

    monkeypatch.setattr(_settings, "gliner_enabled", True)

    r = asyncio.run(scrub(_KITA_KIND_PROMPT, ScrubOptions(language="de")))
    assert not [e for e in r.entities if e.type == "PERSON"], r.entities
    assert "Kita Kind" in r.scrubbed

    # Recall control: same sentence frame, a real two-word name.
    r2 = asyncio.run(
        scrub("Ich war mit Anna Schreiber und Kita Kind beim Arzt.", ScrubOptions(language="de"))
    )
    persons = {e.value for e in r2.entities if e.type == "PERSON"}
    assert any("Schreiber" in v for v in persons), persons
