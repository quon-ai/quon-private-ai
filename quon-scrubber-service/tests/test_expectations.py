"""Unit tests for evaluation-corpus helpers (no network)."""

from __future__ import annotations

from expectations import infer_entity_type, normalize_tokens, token_values
from test_texts import TEST_CASES


def test_normalize_tokens_accepts_string_and_dict():
    out = normalize_tokens(["a@b.com", {"value": "Stefan Weber", "type": "PERSON"}])
    assert out[0] == {"value": "a@b.com", "type": "EMAIL"}
    assert out[1] == {"value": "Stefan Weber", "type": "PERSON"}


def test_infer_entity_type_spot_checks():
    assert infer_entity_type("stephen@acme.com") == "EMAIL"
    assert infer_entity_type("KV-98234-A-7") == "INSURANCE_ID"
    assert infer_entity_type("+49 170 1234567") == "PHONE"
    assert infer_entity_type("DE89 3704 0044 0532 0130 00") == "IBAN"
    assert infer_entity_type("Stefan Weber") == "PERSON"
    assert infer_entity_type("https://api.internal.gs.com/v2/users") == "URL"
    assert infer_entity_type("998877") == "PIN"
    assert infer_entity_type("Xy#9mK2!") == "CREDENTIAL"


def test_token_values_legacy_compat():
    assert token_values(["Maria Gonzalez", {"value": "VN-2024-88421", "type": "INSURANCE_ID"}]) == [
        "Maria Gonzalez",
        "VN-2024-88421",
    ]


def test_grade_case_recall_and_precision():
    from test_api import grade_case

    case = {
        "id": "T-001",
        "language": "en",
        "category": "sample",
        "must_anonymize": ["secret@x.com"],
        "must_not_anonymize": ["PublicCo", "meeting"],
    }
    row = grade_case(case, "Email PublicCo about meeting: [EMAIL]", fallback_mode=False)
    assert row["found"] == 1
    assert row["false"] == 0
    assert row["grade"] == "A"


def test_all_cases_tokens_appear_in_input():
    for case in TEST_CASES:
        for tok in token_values(case["must_anonymize"]):
            assert tok.lower() in case["input"].lower(), f"{case['id']}: must_anonymize {tok!r}"
        for tok in case["must_not_anonymize"]:
            val = tok["value"] if isinstance(tok, dict) else tok
            assert val.lower() in case["input"].lower(), f"{case['id']}: must_not {val!r}"
