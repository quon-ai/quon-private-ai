"""Large synthetic-corpus eval — opt-in, measures leak-rate at SCALE against
config 1 (NER + regex, the guaranteed floor; LLM enrichment forced off for speed
and determinism).

    QUON_RUN_CORPUS=1 pytest tests/test_corpus.py -q -s
    QUON_RUN_CORPUS=1 QUON_CORPUS_N=300 pytest tests/test_corpus.py -q -s   # quick subset

Writes tests/CORPUS_REPORT.md (leak-rate per entity type with Wilson CIs, per
slice, plus a triage list of leaks). Gating floors are layered on later.
"""

from __future__ import annotations

import os
from collections import Counter
from pathlib import Path

import pytest

import auth as _auth
from config import settings
from main import app
from tests.synth import generate_corpus
from tests.test_api import _metrics_from_rows, _scrub, _section_per_type, _wilson, grade_case

from tests.report_paths import report_path_for

# Tracked baseline ONLY under QUON_WRITE_BASELINE=1 (CI, and the explicit eval
# command). Otherwise this lands in a gitignored dir — see report_paths.py for
# why: an ordinary gate run used to rewrite a tracked file, which dirtied the
# tree, changed tree-fingerprint.sh's hash and invalidated every deploy stamp.
CORPUS_REPORT = report_path_for("CORPUS_REPORT.md")

# Config-1 (NER + regex) recall floors as a RATCHET: each is locked at/below today's
# baseline so a regression FAILS the gate; raise them as the scrubber improves.
# LLM-dependent types (caught by enrichment, not regex) sit at 0 here — their real
# floors belong to the config 2/3 LLM run. (floor%, target%)
FLOORS: dict[str, tuple[float, float]] = {
    "EMAIL": (99, 99.9),
    "IBAN": (99, 99.9),
    "PHONE": (98, 99.9),  # Presidio + format-based supplement (was 95)
    "FINANCIAL_AMOUNT": (98, 99.9),  # regex now covers plain 4+ digit amounts (was 74)
    "PERSON": (90, 95),
    "DATE": (95, 99),  # dotted/spelled German dates are now deterministic
    "TAX_ID": (55, 99),  # US SSN shape moved into the net
    # 2026-09-04: bare-KVNR checksum net + UNLABELLED templates (the old 95 was
    # earned on labelled-only templates — the corpus could not see the bare
    # shape). Measured 98/98 with the harder population, GLiNER on AND off.
    "INSURANCE_ID": (98, 99.5),
    "ROUTING": (0, 95),
    "INTERNAL_URL": (95, 99),
    "PIN": (0, 95),
    # 100% in config 1 once UNMARKED secrets are out of scope (2026-08-20): what
    # remains in scope is exactly the marked forms, and those are deterministic.
    # 2026-09-04 re-derivation: 55/55 measured — the roadmap's "17.6% leak" was
    # an LLM-tier number; the tier and the leak died together. Raised 95 -> 98.
    "CREDENTIAL": (98, 99.5),
    # Deterministic street-address regex (config-1, no LLM) — real floor.
    "ADDRESS": (90, 98),
}

# Over-redaction guard: precision (must-NOT values left intact) is measured but was
# never gated, so a "recall fix" that shredded precision could pass silently. Locked
# below the observed config-1 baseline (~89–91% in tests/reports/HISTORY.md); raise
# as precision improves. Config 1 only — the LLM run is non-deterministic (band, not gate).
PRECISION_FLOOR = 85.0

# Casual-register slice ratchet (config 1 only; see tests/synth.py's
# generate_casual_register_corpus): the FP guard for the class of false positive
# that shipped three times in production because the corpus was entirely
# formal-register (see the module docstring there). Locked at the MEASURED
# post-fix baseline below, not just asserted at 0 aspirationally — raise this
# comment/value only after re-measuring, never lower it silently.
CASUAL_NEG_FP_FLOOR = 0

# Street/place-compound PERSON-mistag ratchet (config 1 only; P3 defense-in-
# depth — see ner_gazetteer.STREET_SUFFIXES). Type-aware and independent of
# must_not_anonymize (see the check below): a street/square compound must never
# be tagged PERSON specifically, regardless of whether it's otherwise left in
# clear text or (in the future) redacted as some non-PERSON type.
STREET_MISTAG_FLOOR = 0


def _section_floors(by_type: dict[str, dict[str, int]]) -> tuple[str, list[str]]:
    """Render a floor-status table and return (markdown, breaches)."""
    lines = [
        "\n## Floors (config 1: NER + regex — ratchet)\n",
        "Type          | Recall | Floor | Target | Status\n",
        "--------------|--------|-------|--------|-------",
    ]
    breaches: list[str] = []
    for etype in sorted(by_type):
        b = by_type[etype]
        if not b["total"]:
            continue
        recall = 100 * b["found"] / b["total"]
        floor, target = FLOORS.get(etype, (0, 100))
        ok = recall + 1e-9 >= floor
        if not ok:
            breaches.append(f"{etype}: recall {recall:.1f}% < floor {floor}%")
        lines.append(
            f"{etype:<13} | {recall:>5.1f}% | {floor:>4}% | {target:>5}% | "
            f"{'ok' if ok else 'BREACH'}"
        )
    return "\n".join(lines), breaches


@pytest.fixture(autouse=True)
def _bypass_auth():
    """/scrub requires an active session; this suite tests detection, not auth."""
    app.dependency_overrides[_auth.current_active_user] = lambda: _auth.User(
        id="test-user", email="test@quon.local", status="active", session_id="test"
    )
    yield
    app.dependency_overrides.pop(_auth.current_active_user, None)


def _section_per_slice(rows: list[dict]) -> str:
    by_slice: dict[str, list[dict]] = {}
    for r in rows:
        by_slice.setdefault(r.get("slice", "—"), []).append(r)
    lines = [
        "\n## Per slice\n",
        "Slice               | Recall     | Leak%  | FP\n",
        "--------------------|------------|--------|----",
    ]
    for s in sorted(by_slice):
        m = _metrics_from_rows(by_slice[s])
        leak = 100 - m["recall_pct"]
        lines.append(f"{s:<19} | {m['found']:>4}/{m['must']:<5} | {leak:>4}% | {m['false']}")
    return "\n".join(lines)


def _triage(rows: list[dict], limit: int = 25) -> str:
    leaks = [r for r in rows if r["missed"] > 0]
    lines = [f"\n## Leaks (first {limit} of {len(leaks)}) — for triage\n"]
    for r in leaks[:limit]:
        vals = ", ".join(t["value"] for t in r["missed_tokens"])
        lines.append(f"- {r['id']} [{r['slice']}]: {vals}")
    return "\n".join(lines)


@pytest.mark.skipif(
    not os.environ.get("QUON_RUN_CORPUS"),
    reason="opt-in heavy eval; set QUON_RUN_CORPUS=1 (optionally QUON_CORPUS_N=…)",
)
def test_synthetic_corpus():
    # Config 1 (default): NER + regex only — the floor users get without the LLM,
    # gated by the ratchet. (Config 2/3 — the LLM-enriched comparison modes —
    # were removed with the LLM tier on 2026-08-23; the historical numbers live
    # in tests/reports/SCRUB_LATENCY.md and cannot be re-measured.)
    llm_on = False
    n = int(os.environ.get("QUON_CORPUS_N", "1500"))
    corpus = generate_corpus(target=n)
    label = "config 1: NER + regex"
    rows: list[dict] = []
    street_mistags: list[str] = []
    for case in corpus:
        res = _scrub(case["input"])
        row = grade_case(case, res["scrubbed"], fallback_mode=res["metadata"]["fallback_mode"])
        row["slice"] = case.get("slice", "—")
        rows.append(row)
        # Type-aware street/place check (see synth.py's labeling-rule note):
        # a street/square compound must never be tagged PERSON specifically.
        # This is intentionally NOT expressed via must_not_anonymize (that
        # grading is type-blind — see grade_case — so it would assert "must
        # never be redacted at all," fighting a future ADDRESS type). Reads
        # the real entity report directly instead.
        street_terms = case.get("street_terms") or []
        if street_terms:
            person_values = {
                e["value"].strip().lower() for e in res.get("entities", []) if e["type"] == "PERSON"
            }
            for term in street_terms:
                if term.strip().lower() in person_values:
                    street_mistags.append(f"{case['id']}: {term!r} tagged PERSON")

    # Split OUT-OF-SCOPE cases before the primary metric. These are secrets with
    # no marker at all (see expectations.Policy "unmarked_secret") — declared out
    # of scope 2026-08-20. They are still generated, still graded and still
    # PRINTED below; they simply do not drag the headline number for something
    # nobody can detect. Never fold them back in silently: if the scope decision
    # is ever revisited, this split is where to look.
    oos = [r for r in rows if r.get("policy") == "unmarked_secret"]
    rows = [r for r in rows if r.get("policy") != "unmarked_secret"]
    m_oos = _metrics_from_rows(oos) if oos else None

    m = _metrics_from_rows(rows)
    langs = Counter(r["language"] for r in rows)
    lo, hi = _wilson(m["found"], m["must"])
    fb = sum(1 for r in rows if r.get("fallback_mode"))
    # An "LLM run" where (nearly) every case fell back to NER+regex is NOT an
    # LLM measurement — it is the floor wearing a costume. This happened for
    # real (2026-08-14): the model name pointed at a never-pulled Ollama model,
    # every request 404'd, and the report silently printed floor numbers under
    # a config-2/3 heading. Fail loudly instead of mismeasuring quietly.
    head = (
        f"# QUON Scrubber — Synthetic Corpus Report ({label})\n\n"
        f"- Cases: {len(rows)} (DE {langs['de']} / EN {langs['en']})\n"
        f"- Gold values: {m['must']}\n"
        f"- **Leak rate: {100 - m['recall_pct']}% per value · "
        f"{m['sample_leak_rate']}% of messages leak ≥1** (primary)\n"
        f"- Recall: {m['recall_pct']}% (95% CI {lo * 100:.1f}–{hi * 100:.1f}%)\n"
        f"- Precision (must-not kept): {m['precision_pct']}% · FP: {m['false']}\n"
        + (
            f"- Out of scope (unmarked secrets, excluded from the above): "
            f"{len(oos)} cases · {m_oos['must'] - m_oos['found']}/{m_oos['must']} "
            f"values undetected — see expectations.Policy\n"
            if m_oos
            else ""
        )
        + (f"- Fallback (LLM unavailable) on {fb}/{len(rows)} cases\n" if llm_on else "")
    )
    if llm_on:
        floors_md = (
            "\n## Floors\n\nFloors gate config 1 only. This is the LLM run — read the "
            "per-type numbers above as tolerance bands (the LLM is non-deterministic).\n"
        )
        breaches: list[str] = []
        report_path = CORPUS_REPORT.with_name("CORPUS_REPORT_LLM.md")
    else:
        floors_md, breaches = _section_floors(m["by_type"])
        report_path = CORPUS_REPORT
    casual_rows = [r for r in rows if r["slice"].startswith("casual_negative")]
    casual_fp = sum(r["false"] for r in casual_rows)
    casual_md = (
        f"\n## Casual-register slice (FP guard)\n\n"
        f"- Casual-negative cases: {len(casual_rows)} · FP: {casual_fp} "
        f"(ratchet floor: {CASUAL_NEG_FP_FLOOR})\n"
        f"- Street/place-compound PERSON mistags: {len(street_mistags)} "
        f"(ratchet floor: {STREET_MISTAG_FLOOR})\n"
        + ("".join(f"  - {s}\n" for s in street_mistags) if street_mistags else "")
    )
    report = (
        head + _section_per_type(m["by_type"]) + floors_md + casual_md
        + _section_per_slice(rows) + _triage(rows)
    )
    report_path.write_text(report + "\n", encoding="utf-8")
    print("\n" + report)

    # Every case must have been graded. `rows` no longer holds all of them —
    # out-of-scope cases are split off above — so count both halves, or this
    # sanity check silently becomes "did the split happen", which is not the
    # question. It caught exactly that when the split was added.
    assert len(rows) + len(oos) == len(corpus)
    # The ratchet (config 1 only): fail if any type fell through its floor.
    assert not breaches, "Config-1 recall floor breached:\n" + "\n".join(breaches)
    # Precision ratchet (config 1 only): fail if over-redaction regressed past the floor.
    if not llm_on:
        assert m["precision_pct"] + 1e-9 >= PRECISION_FLOOR, (
            f"Config-1 precision {m['precision_pct']}% < floor {PRECISION_FLOOR}% "
            "(over-redaction regression)."
        )
        # Casual-register FP ratchet: the class of false positive that shipped
        # three times because the corpus was entirely formal-register.
        assert casual_fp <= CASUAL_NEG_FP_FLOOR, (
            f"Casual-negative slice FP count {casual_fp} > floor {CASUAL_NEG_FP_FLOOR} "
            "(casual-register over-redaction regression) — see triage in "
            f"{report_path.name}."
        )
        # Street/place PERSON-mistag ratchet (P3 defense-in-depth).
        assert len(street_mistags) <= STREET_MISTAG_FLOOR, (
            f"{len(street_mistags)} street/place compound(s) tagged PERSON > floor "
            f"{STREET_MISTAG_FLOOR}:\n" + "\n".join(street_mistags)
        )
