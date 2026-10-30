"""Cross-language parity for the redaction span matcher.

The client mirrors ``scrubber.find_spans`` in ``src/lib/redactSpans.ts`` so it can
tell the user, before sending, whether a hand-redaction will actually match — and
so it can verify afterwards that the backend honoured it. If the two drift, the
product either promises a redaction that never happens (fail-open, the whole point
of the feature lost) or blocks a send that would have been fine.

This asserts the Python side of the shared fixture; ``src/lib/redactSpans.test.ts``
asserts the JavaScript side of the SAME file. The fixture was generated from this
function, so a change here that is not mirrored in the client fails there, and a
change to the fixture that does not match this function fails here.

The cases that matter are the boundary ones. Python's ``\\w`` under ``re.UNICODE``
matches ``ä ö ü ß``; JavaScript's ``\\w`` is ASCII-only, so the client has to use
``[\\p{L}\\p{N}_]``. Without that, the client believes ``Öl`` occurs inside
``Größe`` and this function does not.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scrubber import _normalize_value, find_spans

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "find-spans-cases.json"


def _cases() -> list[dict]:
    data = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return data["cases"]


def test_fixture_exists_and_has_the_biting_cases() -> None:
    """Guard against the fixture being emptied or trimmed to something toothless."""
    cases = _cases()
    assert len(cases) >= 12
    names = " ".join(c["name"] for c in cases)
    assert "umlaut" in names
    assert "underscore" in names


@pytest.mark.parametrize("case", _cases(), ids=lambda c: c["name"])
def test_find_spans_matches_the_shared_fixture(case: dict) -> None:
    expected = [tuple(span) for span in case["spans"]]
    assert find_spans(case["text"], case["value"]) == expected


def test_umlauts_are_word_characters_here() -> None:
    """The specific divergence the client had to work around."""
    assert find_spans("Größe der Kiste", "Öl") == []
    assert find_spans("Öl ist teuer", "Öl") == [(0, 2)]


def test_normalize_value_strips_one_layer_of_quotes() -> None:
    assert _normalize_value("  Anna  ") == "Anna"
    assert _normalize_value('"Anna"') == "Anna"
    assert _normalize_value('""Anna""') == '"Anna"'
    assert _normalize_value('"Anna') == '"Anna'
    assert _normalize_value("   ") == ""
