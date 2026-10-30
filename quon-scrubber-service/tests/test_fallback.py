"""Regression tests for the deterministic safety net (fallback.py)."""

from __future__ import annotations

from fallback import detect_safety_net

# --- Real-document regressions, 2026-08-20 -------------------------------------
# All four found by an operator testing scanned paperwork locally. Each is a rule
# that worked on single-line prose and broke on the layout real documents have.


def test_labelled_identifier_does_not_run_past_the_line_end():
    """On a form, "\\s" let the value group swallow the newline AND the first letter
    of the next line's label: "Angebots-Nr.: 20240110" captured "20240110\\nK",
    a span that no longer matches cleanly and is dropped — so the identifier
    silently stayed in the clear while the one below it appeared to work."""
    text = "Angebots-Nr.: 20240110\nKunden-Nr.: 10023\nSeite: 1 von 3"
    values = {d["value"] for d in detect_safety_net(text)}
    assert "20240110" in values
    assert "10023" in values
    assert not any("\n" in v for v in values), f"span crossed a line: {values}"


def test_postcode_city_does_not_match_across_a_line_break():
    """A 5-digit CUSTOMER NUMBER at the end of one line matched the capitalised
    first word of the next as "PLZ Stadt": "10023\\nSeite" was redacted as an
    ADDRESS, mislabelling the number and swallowing "Seite"."""
    text = "Kunden-Nr.: 10023\nSeite: 1 von 3"
    addresses = [d["value"] for d in detect_safety_net(text) if d["type"] == "ADDRESS"]
    assert addresses == [], f"postcode rule crossed a line: {addresses}"
    # …while a real address on one line still works.
    ok = [d["value"] for d in detect_safety_net("16540 Hohen Talbach") if d["type"] == "ADDRESS"]
    assert ok == ["16540 Hohen Talbach"]


def test_ocr_split_email_is_detected():
    """PDF extraction splits the last dot: "service@pension-services. de". Presidio
    requires \\S throughout, so every address on a scanned letterhead leaked."""
    for text, want in (
        ("AN service@pension-services. de", "service@pension-services. de"),
        ("info@nuernberger. de", "info@nuernberger. de"),
        ("Mail an support @ firma . de bitte.", "support @ firma . de"),
    ):
        got = [d["value"] for d in detect_safety_net(text) if d["type"] == "EMAIL"]
        assert want in got, f"{text!r} -> {got}"


def test_ocr_split_email_does_not_eat_the_next_sentence():
    """The guard that keeps the above from matching prose: a German sentence
    capitalises, so the TLD must be lowercase or "Der" becomes a domain."""
    for text in (
        "Schreib an a@b. Der Termin steht fest.",
        "Das war es. Der neue Satz beginnt hier.",
        "kontakt@firma.\nDer Rest folgt.",
    ):
        got = [d["value"] for d in detect_safety_net(text) if d["type"] == "EMAIL"]
        assert got == [], f"{text!r} -> {got}"


def test_labelled_identifier_beats_a_postcode_guess():
    """PDF extraction of a two-column form merges the columns onto ONE line:
    "Kunden-Nr.: 10023 Seite: 1 von 3". The postcode branch then read "10023
    Seite" as PLZ+city — mislabelling the customer number AND swallowing the word
    "Seite". Making the rules line-local fixed the newline version of this; an
    explicit label must also beat a shape guess on the same line."""
    got = detect_safety_net("Kunden-Nr.: 10023 Seite: 1 von 3")
    assert [(d["type"], d["value"]) for d in got] == [("OTHER", "10023")]


def test_street_line_is_found_via_the_postcode_anchor():
    """The street-suffix list is a vocabulary and German street names run out of
    it: "Am Dünenwald 60" ends in "-wald", so the city line was redacted while the
    street line survived — a half-removed address. Anchoring on a CONFIRMED
    "PLZ Stadt" needs no street vocabulary at all."""
    for text, street in (
        ("Anschrift:\n„Oysterhüs“ Am Dünenwald 60, 18551 Glowe", "Am Dünenwald 60"),
        ("Julia Talberg\nDünenwald 60\n18551 Glowe", "Dünenwald 60"),
    ):
        addrs = [d["value"] for d in detect_safety_net(text) if d["type"] == "ADDRESS"]
        assert street in addrs, f"{text!r} -> {addrs}"


def test_postcode_anchor_does_not_fire_on_document_furniture():
    """A form row directly above an address block matches the street shape
    perfectly ("Seite 1" over "10243 Berlin"), and the rule must not take it.
    It must also never fire without a postcode to anchor on."""
    for text in ("Seite 1\n10243 Berlin", "Telefon 030 12\n10243 Berlin"):
        addrs = [d["value"] for d in detect_safety_net(text) if d["type"] == "ADDRESS"]
        assert addrs == ["10243 Berlin"], f"{text!r} -> {addrs}"
    assert detect_safety_net("Am Dünenwald 60 ist schön.") == []


def test_identifier_continuation_does_not_bite_the_next_word():
    """"10023 S" — the S of "Seite" — was captured as part of the identifier.
    Real multi-token identifiers must keep working."""
    assert [d["value"] for d in detect_safety_net("Kennzeichen B-XY 1234 wurde erfasst.")] == ["B-XY 1234"]
    assert [d["value"] for d in detect_safety_net("Aktenzeichen 12 O 345/24 liegt vor.")] == ["12 O 345/24"]


def test_bare_kvnr_spec_vectors():
    """The check digit implements GKV Anlage 1 (2023-01-02) — anchored to the
    spec's own two worked examples, not to the synthetic generator, so the
    generator and the validator cannot drift into agreeing by construction."""
    from fallback import kvnr_checksum_ok

    assert kvnr_checksum_ok("A000500015")  # Hauptversicherter example, PZ 5
    assert kvnr_checksum_ok("C000500021")  # Familienversicherter example, PZ 1
    # Every OTHER check digit for the same stem must fail.
    assert [d for d in range(10) if kvnr_checksum_ok(f"A00050001{d}")] == [5]
    assert [d for d in range(10) if kvnr_checksum_ok(f"C00050002{d}")] == [1]


def test_bare_kvnr_unlabelled_caught_invalid_ignored():
    """The 2026-08-14 roadmap entry left the bare KVNR out of the net because
    "the model already catches it" — the model was deleted 2026-08-23, and
    re-measured on 2026-09-04 an unlabelled bare KVNR leaked through the whole
    pipeline. The checksum is what makes the shape safe to match: a random
    letter+9-digit order number passes 1 time in 10, a real KVNR always."""
    got = [d["value"] for d in detect_safety_net("Auf der Karte steht A000500015, die Karte ist neu.")
           if d["type"] == "INSURANCE_ID"]
    assert got == ["A000500015"]
    # Same shape, wrong check digit: an order/tracking number stays readable.
    for text in (
        "Bestellnummer A000500013 bitte bei Rückfragen angeben.",
        "Sendung B123456789 ist unterwegs.",  # checksum for B12345678 is 2, not 9
    ):
        got = [d for d in detect_safety_net(text) if d["type"] == "INSURANCE_ID"]
        assert got == [], f"{text!r} -> {got}"
