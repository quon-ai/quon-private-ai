"""Automated API test runner.

Spins up the FastAPI app in-process with ``TestClient``, runs every case from
``test_texts.py`` through ``POST /scrub``, grades each one, and prints a summary
table (run with ``pytest -s`` to see it). The latest run is written to
``tests/REPORT.md`` with a metadata header describing the actual pipeline (NER
models + active extraction backend/model). Every run is also preserved as a
timestamped snapshot under ``tests/reports/`` and appended as one row to
``tests/reports/HISTORY.md`` so prior results are never overwritten and setup
changes can be compared over time.

Grading (per spec):
    A = 0 missed, 0 false positives
    B = 0 missed, 1 false positive
    C = 1 missed, 0 false positives
    D = 1+ missed OR 2+ false positives
    F = more than 30% missed

If no LLM extraction runs the table is still printed but LLM-quality assertions
are skipped. Optional CI gates (0 = disabled): ``QUON_TEST_MIN_SCORE`` or
``QUON_TEST_MIN_RECALL`` (recall %), ``QUON_TEST_MIN_PRECISION`` (must_not kept %),
``QUON_TEST_MAX_FP`` (false-positive token cap). Run the slow suite with
``pytest -m integration -s``; fast tests with ``pytest -m \"not integration\"``.
"""

from __future__ import annotations

import datetime
import os
import re
import subprocess
from math import sqrt
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from config import settings
from expectations import DEFAULT_POLICY, normalize_tokens, token_values
from main import app
from tests.test_texts import TEST_CASES

import auth as _auth

client = TestClient(app)


@pytest.fixture(autouse=True)
def _bypass_auth():
    """/scrub and /chat now require an active session. This suite tests detection
    quality, not auth — override the dependency to a fixed active user, scoped to
    each test so it never leaks into the real auth/sync tests."""
    app.dependency_overrides[_auth.current_active_user] = lambda: _auth.User(
        id="test-user", email="test@quon.local", status="active", session_id="test"
    )
    yield
    app.dependency_overrides.pop(_auth.current_active_user, None)

from tests.report_paths import WRITE_BASELINE, report_path_for

# Tracked baselines only under QUON_WRITE_BASELINE=1 — see report_paths.py.
REPORT_PATH = report_path_for("REPORT.md")
# Past runs are preserved here (never overwritten) so setup changes can be
# compared over time; REPORT.md only mirrors the most recent run.
REPORTS_DIR = REPORT_PATH.parent if not WRITE_BASELINE else Path(__file__).parent / "reports"
HISTORY_PATH = report_path_for("HISTORY.md")


def _git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            cwd=Path(__file__).parent,
            timeout=5,
        )
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _run_metadata(fallback_count: int, n_cases: int) -> dict:
    """Describe the detection pipeline actually exercised by this run."""
    health = client.get("/health").json()
    settings_resp = client.get("/settings").json()
    backend = health.get("pii_backend", "cloud")
    if backend == "cloud":
        extractor = f"cloud:{settings_resp.get('pii_cloud_model', '?')}"
    else:
        extractor = f"local:{settings.ollama_model}"
    ner_part = (
        f"NER({settings.spacy_model_de}, {settings.spacy_model_en})"
        if health.get("ner_ready")
        else "NER off"
    )
    if fallback_count == 0:
        llm_status = f"active ({extractor})"
    elif fallback_count < n_cases:
        llm_status = (
            f"partial ({extractor}; {fallback_count}/{n_cases} cases fell back to NER+regex)"
        )
    else:
        llm_status = f"inactive (all cases fell back to NER+regex; configured {extractor})"
    return {
        "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pipeline": f"{ner_part} + {extractor}",
        "extractor": extractor,
        "llm_status": llm_status,
        "ner_ready": bool(health.get("ner_ready")),
        "git": _git_sha(),
    }


# --------------------------------------------------------------------------- #
# Grading
# --------------------------------------------------------------------------- #
# Name particles too generic to count as a leak on their own ("von der Leyen" →
# only "leyen" is distinctive).
# Non-distinctive components of a gold name. A surviving particle is not a leak:
# "von" alone identifies nobody, so counting it as one would score a correct
# redaction as a failure.
#
# HONORIFICS belong in the same class, added 2026-08-19. The pipeline
# deliberately KEEPS them — test_titled_name_redacted_end_to_end_without_llm
# asserts `"Herr" in result.scrubbed  # the honorific stays (not PII)` — while
# the corpus lists the full "Dr. Stefan Weber" as must_anonymize. Those two are
# consistent only if "Dr" is non-distinctive; otherwise the grader marks
# intended behaviour as a leak. It did, and it did so UNEVENLY across models
# (the 7B redacted the name and kept the title, the 24B swallowed both), which
# silently biased a model comparison. Academic qualifiers ("med", "rer", "nat")
# are the same class for the same reason.
#
# ⚠️ This shifts historical figures in HISTORY.md slightly UPWARD: runs before
# this date counted such cases as leaks. Compare across the boundary with care.
_NAME_PARTICLES = frozenset(
    {
        "von", "van", "de", "der", "den", "da", "di", "du", "del", "della", "le",
        "la", "of", "the", "bin", "al", "ibn", "zu", "zur", "und", "mc", "mac",
        "dos", "das", "el", "ben",
        # honorifics + academic qualifiers — kept in the output by design
        "dr", "prof", "herr", "frau", "mr", "mrs", "ms", "mx", "mister", "madam",
        "med", "rer", "nat", "phil", "jur", "oec", "habil", "ing",
    }
)
# Atomic types: a leak only if the WHOLE value survives (substring). Multi-part
# types (names, addresses) are checked component-by-component, so a partially
# redacted "Anna Müller" (only "Müller" removed) counts as a leak, not a pass.
_ATOMIC_TYPES = frozenset(
    {
        "EMAIL", "IBAN", "PHONE", "FINANCIAL_AMOUNT", "DATE", "ROUTING",
        "INTERNAL_URL", "URL", "TAX_ID", "INSURANCE_ID", "PIN", "CREDENTIAL",
        "CREDIT_CARD", "OTHER", "CUSTOM",
    }
)


def _value_components(token: dict) -> list[str]:
    """The pieces of a value that each, if left in clear, constitute a leak.
    Atomic types → the whole value; names/addresses → their distinctive words."""
    value = token["value"]
    if token.get("type") in _ATOMIC_TYPES:
        return [value]
    words = re.findall(r"[^\W\d_]+", value, re.UNICODE)
    distinct = [w for w in words if len(w) >= 2 and w.lower() not in _NAME_PARTICLES]
    return distinct or [value]


def _value_leaked(token: dict, haystack: str) -> bool:
    """True if any component of the gold value is still present in the (lowercased)
    scrubbed text. Atomic values use substring; name parts use word boundaries so a
    surname isn't matched inside an unrelated word."""
    if token.get("type") in _ATOMIC_TYPES:
        return token["value"].lower() in haystack
    return any(
        re.search(rf"\b{re.escape(comp.lower())}\b", haystack)
        for comp in _value_components(token)
    )


def _wilson(found: int, total: int) -> tuple[float, float]:
    """95% Wilson score interval for a proportion — report a range, never a bare
    point estimate on a small sample."""
    if total == 0:
        return (1.0, 1.0)
    z = 1.96
    p = found / total
    denom = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denom
    half = (z * sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def grade_case(case: dict, scrubbed: str, *, fallback_mode: bool = False) -> dict:
    haystack = scrubbed.lower()
    must_tokens = normalize_tokens(case["must_anonymize"])
    must_not_raw = case["must_not_anonymize"]
    must_not = [t["value"] if isinstance(t, dict) else t for t in must_not_raw]

    # A token is "missed" (leaked) if any component of its value survived.
    missed_tokens = [t for t in must_tokens if _value_leaked(t, haystack)]
    missed_values = [t["value"] for t in missed_tokens]
    false_pos = [v for v in must_not if v.lower() not in haystack]

    total = len(must_tokens)
    n_missed = len(missed_tokens)
    n_false = len(false_pos)
    found = total - n_missed

    if total > 0 and (n_missed / total) > 0.30:
        grade = "F"
    elif n_missed == 0 and n_false == 0:
        grade = "A"
    elif n_missed == 0 and n_false == 1:
        grade = "B"
    elif n_missed == 1 and n_false == 0:
        grade = "C"
    else:
        grade = "D"

    return {
        "id": case["id"],
        "category": case["category"],
        "language": case["language"],
        "policy": case.get("policy", DEFAULT_POLICY),
        "pair_id": case.get("pair_id"),
        "fallback_mode": fallback_mode,
        "found": found,
        "total": total,
        "missed": n_missed,
        "false": n_false,
        "must_not_total": len(must_not),
        "grade": grade,
        "missed_values": missed_values,
        "false_values": false_pos,
        "missed_tokens": missed_tokens,
        "found_tokens": [t for t in must_tokens if t not in missed_tokens],
    }


def _scrub(text: str) -> dict:
    resp = client.post(
        "/scrub",
        json={"text": text, "options": {"language": "auto", "show_entities": True, "placeholder_style": "typed"}},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _metrics_from_rows(rows: list[dict]) -> dict:
    """Aggregate recall, precision, grades, and per-type stats from graded rows."""
    tot_found = sum(r["found"] for r in rows)
    tot_must = sum(r["total"] for r in rows)
    tot_missed = sum(r["missed"] for r in rows)
    tot_fp = sum(r["false"] for r in rows)
    tot_must_not = sum(r["must_not_total"] for r in rows)
    tot_must_not_kept = tot_must_not - tot_fp
    grade_counts = {"A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
    by_type: dict[str, dict[str, int]] = {}
    by_policy: dict[str, list[dict]] = {}
    for r in rows:
        grade_counts[r["grade"]] += 1
        by_policy.setdefault(r["policy"], []).append(r)
        for t in r.get("found_tokens", []):
            bucket = by_type.setdefault(t["type"], {"found": 0, "total": 0, "fp": 0})
            bucket["found"] += 1
            bucket["total"] += 1
        for t in r.get("missed_tokens", []):
            bucket = by_type.setdefault(t["type"], {"found": 0, "total": 0, "fp": 0})
            bucket["total"] += 1
    return {
        "found": tot_found,
        "must": tot_must,
        "missed": tot_missed,
        "false": tot_fp,
        "must_not_total": tot_must_not,
        "must_not_kept": tot_must_not_kept,
        "grades": grade_counts,
        "recall_pct": round((tot_found / tot_must) * 100) if tot_must else 100,
        "precision_pct": round((tot_must_not_kept / tot_must_not) * 100) if tot_must_not else 100,
        # The honest user-facing number: share of messages that leak ≥1 value.
        "sample_leak_rate": round(100 * sum(1 for r in rows if r["missed"] > 0) / len(rows))
        if rows
        else 0,
        "fallback_count": sum(1 for r in rows if r.get("fallback_mode")),
        "by_type": by_type,
        "by_policy": by_policy,
    }


def _totals(rows: list[dict]) -> dict:
    """Backward-compatible summary dict used by assertions."""
    m = _metrics_from_rows(rows)
    return {
        "found": m["found"],
        "must": m["must"],
        "missed": m["missed"],
        "false": m["false"],
        "grades": m["grades"],
        "pct": m["recall_pct"],
        "recall_pct": m["recall_pct"],
        "precision_pct": m["precision_pct"],
        "fallback_count": m["fallback_count"],
    }


def _section_per_type(by_type: dict[str, dict[str, int]]) -> str:
    if not by_type:
        return ""
    lines = [
        "\n## Per entity type\n",
        "Leak rate = 1 − recall (primary). 95% CI is the Wilson interval on recall.\n",
        "Type          | Recall     | Leak%  | 95% CI (recall)  | FP\n",
        "--------------|------------|--------|------------------|----",
    ]
    for etype in sorted(by_type):
        b = by_type[etype]
        if not b["total"]:
            lines.append(f"{etype:<13} | {'—':<10} | {'—':<6} | {'—':<16} | {b.get('fp', 0)}")
            continue
        recall = f"{b['found']}/{b['total']}"
        leak = 100 * (b["total"] - b["found"]) / b["total"]
        lo, hi = _wilson(b["found"], b["total"])
        ci = f"{lo * 100:.0f}–{hi * 100:.0f}%"
        lines.append(
            f"{etype:<13} | {recall:<10} | {leak:>4.1f}% | {ci:<16} | {b.get('fp', 0)}"
        )
    return "\n".join(lines)


def _section_per_policy(by_policy: dict[str, list[dict]]) -> str:
    if not by_policy:
        return ""
    lines = [
        "\n## Per policy\n",
        "Policy          | Recall | Precision | Cases\n",
        "----------------|--------|-----------|------",
    ]
    for policy in sorted(by_policy):
        m = _metrics_from_rows(by_policy[policy])
        lines.append(
            f"{policy:<15} | {m['recall_pct']:>5}% | {m['precision_pct']:>8}% | {len(by_policy[policy])}"
        )
    return "\n".join(lines)


def _section_paired(rows: list[dict]) -> str:
    pairs: dict[str, dict[str, dict]] = {}
    for r in rows:
        pid = r.get("pair_id")
        if not pid:
            continue
        pairs.setdefault(pid, {})[r["language"]] = r
    if not pairs:
        return ""
    lines = [
        "\n## Paired DE/EN scenarios\n",
        "Pair               | DE recall   | EN recall\n",
        "-------------------|-------------|------------",
    ]
    for pid in sorted(pairs):
        de = pairs[pid].get("de")
        en = pairs[pid].get("en")
        de_cell = f"{de['found']}/{de['total']}" if de and de["total"] else "—"
        en_cell = f"{en['found']}/{en['total']}" if en and en["total"] else "—"
        lines.append(f"{pid:<18} | {de_cell:<11} | {en_cell}")
    return "\n".join(lines)


def _section_fallback_split(rows: list[dict]) -> str:
    fb = [r for r in rows if r.get("fallback_mode")]
    full = [r for r in rows if not r.get("fallback_mode")]
    if not fb and not full:
        return ""
    lines = ["\n## Fallback split\n"]
    for label, subset in [("LLM active", full), ("Fallback (NER+regex)", fb)]:
        if not subset:
            continue
        m = _metrics_from_rows(subset)
        lines.append(
            f"- {label} ({len(subset)} cases): recall {m['recall_pct']}% "
            f"({m['found']}/{m['must']}), precision {m['precision_pct']}%, FP {m['false']}"
        )
    return "\n".join(lines)


def _render_report(rows: list[dict], meta: dict) -> str:
    m = _metrics_from_rows(rows)
    head_block = (
        "# QUON Detection Quality Report\n\n"
        f"- Date: {meta['date']}\n"
        f"- Pipeline: {meta['pipeline']}\n"
        f"- LLM enrichment: {meta['llm_status']}\n"
        f"- NER ready: {str(meta['ner_ready']).lower()}\n"
        f"- Git commit: {meta['git']}\n"
        f"- Recall: {m['recall_pct']}% ({m['found']}/{m['must']})\n"
        f"- **Leak rate: {100 - m['recall_pct']}% per value · "
        f"{m['sample_leak_rate']}% of messages leak ≥1** (primary metric)\n"
        f"- Precision: {m['precision_pct']}% ({m['must_not_kept']}/{m['must_not_total']})\n"
        f"- False positives: {m['false']}\n"
        f"- Fallback cases: {m['fallback_count']}/{len(rows)}\n"
    )
    header = (
        "ID      | Category             | ✅ Found | ❌ Missed | 🔴 False+ | Grade\n"
        "--------|----------------------|----------|-----------|-----------|------"
    )
    lines = [header]
    for r in rows:
        found_cell = f"{r['found']}/{r['total']}"
        lines.append(
            f"{r['id']:<7} | {r['category']:<20} | {found_cell:<8} | "
            f"{r['missed']:<9} | {r['false']:<9} | {r['grade']}"
        )
    total_cell = f"{m['found']}/{m['must']}"
    lines.append("--------|----------------------|----------|-----------|-----------|------")
    lines.append(
        f"{'TOTAL':<7} | {'':<20} | {total_cell:<8} | "
        f"{m['missed']:<9} | {m['false']:<9} | {m['recall_pct']}%"
    )
    g = m["grades"]
    summary = (
        f"\nGrades: A={g['A']} B={g['B']} C={g['C']} D={g['D']} F={g['F']}\n"
        f"Recall: {m['recall_pct']}% | Precision: {m['precision_pct']}% | "
        f"False positives: {m['false']}"
    )
    extra = (
        _section_per_type(m["by_type"])
        + _section_per_policy(m["by_policy"])
        + _section_paired(rows)
        + _section_fallback_split(rows)
    )
    return head_block + "\n" + "\n".join(lines) + summary + extra


def _append_history(rows: list[dict], meta: dict) -> None:
    """Append one row per run to a cumulative table — never overwrites prior runs."""
    REPORTS_DIR.mkdir(exist_ok=True)
    m = _metrics_from_rows(rows)
    g = m["grades"]
    grades_cell = f"A={g['A']} B={g['B']} C={g['C']} D={g['D']} F={g['F']}"
    row = (
        f"| {meta['date']} | {meta['git']} | {meta['pipeline']} | "
        f"{m['recall_pct']}% | {m['precision_pct']}% | {m['false']} | "
        f"{m['fallback_count']}/{len(rows)} | {grades_cell} |\n"
    )
    header = (
        "# QUON Quality History\n\n"
        "Each row is one `test_quality_suite` run. Newest entries are appended; "
        "prior results are never overwritten so setup changes can be compared.\n\n"
        "| Date | Commit | Pipeline | Recall | Precision | FP | Fallback | Grades |\n"
        "|------|--------|----------|--------|-----------|----|---------|--------|\n"
    )
    if not HISTORY_PATH.exists():
        HISTORY_PATH.write_text(header, encoding="utf-8")
    elif "| Recall |" not in HISTORY_PATH.read_text(encoding="utf-8"):
        # Migrate header if an old-format history file exists.
        HISTORY_PATH.write_text(header, encoding="utf-8")
    with HISTORY_PATH.open("a", encoding="utf-8") as fh:
        fh.write(row)


# --------------------------------------------------------------------------- #
# Contract tests (run with or without Ollama)
# --------------------------------------------------------------------------- #
def test_health_contract():
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["version"]
    assert isinstance(body["pii_ready"], bool)


def test_health_reports_the_detection_stack_not_the_retired_llm_tier():
    """The LLM tier is REMOVED (2026-08-23). /health must carry no trace of it —
    a field like ollama_available answering about a component that cannot even
    be configured is exactly the stale confidence this endpoint once had."""
    body = client.get("/health").json()
    assert body["status"] == "ok"
    for gone in ("ollama_available", "model_loaded", "pii_backend", "llm_enrichment"):
        assert gone not in body, gone
    # Readiness IS the in-process stack (NER, and GLiNER when enabled).
    assert isinstance(body["pii_ready"], bool)
    assert isinstance(body["ner_ready"], bool)


def test_health_does_not_load_gliner_just_to_answer(monkeypatch):
    """/health is polled. Reporting GLiNER readiness must never trigger its lazy
    load, or the first probe pays a ~24s cold start while serving traffic."""
    from config import settings as _settings
    import gliner_detect

    monkeypatch.setattr(_settings, "gliner_enabled", True)
    called = False

    def _boom():
        nonlocal called
        called = True
        raise AssertionError("/health must not load the model")

    monkeypatch.setattr(gliner_detect, "_get_model", _boom)
    body = client.get("/health").json()
    assert called is False
    assert body["gliner_enabled"] is True
    assert isinstance(body["gliner_loaded"], bool)


def test_entities_contract():
    body = client.get("/entities").json()
    assert isinstance(body, list) and len(body) >= 13
    types = {e["type"] for e in body}
    assert {"PERSON", "EMAIL", "PHONE", "IBAN", "TAX_ID", "INSURANCE_ID", "ADDRESS", "CUSTOM"} <= types
    for e in body:
        assert e["placeholder"].startswith("[") and e["placeholder"].endswith("]")


def test_models_contract(monkeypatch):
    # Pin to the CODE default list — without this the test reads whatever
    # catalog happens to sit in the dev machine's runtime_settings.json.
    import settings_store

    monkeypatch.setattr(settings_store, "get_openrouter_models", lambda: [])
    body = client.get("/models").json()
    assert isinstance(body, list) and len(body) >= 1
    # Each entry carries a composite id, the provider-local slug and its connection.
    slugs = {m["model"] for m in body}
    assert "~anthropic/claude-sonnet-latest" in slugs
    # The intended default must be FIRST — the client's validity fallback picks
    # the first enabled entry.
    assert body[0]["model"] == "~anthropic/claude-sonnet-latest"
    sonnet = body[0]
    assert sonnet["id"] == "openrouter::~anthropic/claude-sonnet-latest"
    assert sonnet["connection_id"] == "openrouter"


def test_connections_contract():
    body = client.get("/settings").json()
    conns = {c["id"]: c for c in body["connections"]}
    assert "openrouter" in conns and conns["openrouter"]["builtin"] is True
    assert conns["openrouter"]["kind"] == "openrouter"


def test_chat_requires_messages():
    # Empty messages -> 422 (schema min_length), never a provider call.
    assert client.post("/chat", json={"model": "openrouter/auto", "messages": []}).status_code == 422


def test_scrub_basic_shape():
    body = _scrub("Email me at test.person@example.com please.")
    assert "scrubbed" in body and "entities" in body and "metadata" in body
    assert body["original_length"] == len("Email me at test.person@example.com please.")
    assert "test.person@example.com" not in body["scrubbed"]  # email always redacted
    assert "[EMAIL]" in body["scrubbed"]


def test_placeholder_style_generic():
    body = client.post(
        "/scrub",
        json={"text": "Reach me at a@b.com", "options": {"placeholder_style": "generic"}},
    ).json()
    assert "[PII]" in body["scrubbed"]
    assert "a@b.com" not in body["scrubbed"]


def test_show_entities_false_hides_report():
    body = client.post(
        "/scrub",
        json={"text": "Reach me at a@b.com", "options": {"show_entities": False}},
    ).json()
    assert body["entities"] == []
    assert "a@b.com" not in body["scrubbed"]  # still scrubbed


# --------------------------------------------------------------------------- #
# Full 58-case quality suite (slow — needs cloud key or Ollama)
# --------------------------------------------------------------------------- #
@pytest.mark.integration
def test_quality_suite():
    health = client.get("/health").json()

    rows: list[dict] = []
    fallback_count = 0
    email_total = 0
    email_redacted = 0
    for case in TEST_CASES:
        result = _scrub(case["input"])
        scrubbed = result["scrubbed"]
        if result["metadata"]["fallback_mode"]:
            fallback_count += 1
        rows.append(grade_case(case, scrubbed, fallback_mode=result["metadata"]["fallback_mode"]))

        # Track email redaction as a mode-independent invariant.
        for value in token_values(case["must_anonymize"]):
            if "@" in value:
                email_total += 1
                if value.lower() not in scrubbed.lower():
                    email_redacted += 1

    meta = _run_metadata(fallback_count, len(rows))
    report = _render_report(rows, meta)
    # Latest run -> REPORT.md; a preserved, timestamped snapshot + history row so
    # earlier results are never lost and setup changes can be compared over time.
    REPORT_PATH.write_text(report + "\n", encoding="utf-8")
    REPORTS_DIR.mkdir(exist_ok=True)
    stamp = meta["date"].replace(":", "").replace("-", "")
    (REPORTS_DIR / f"{stamp}_{meta['git']}.md").write_text(report + "\n", encoding="utf-8")
    _append_history(rows, meta)
    print("\n" + report)

    assert len(rows) == 58

    # Both the LLM and the Presidio fallback redact emails reliably, so this
    # holds regardless of the active backend — it guards the replacement pipe.
    email_rate = email_redacted / email_total if email_total else 1.0
    assert email_rate >= 0.9, f"email redaction rate too low: {email_rate:.0%}"

    # Skip the LLM-quality assertion only when no LLM extraction happened at all
    # (every case fell back to NER+regex) — e.g. cloud key missing and Ollama down.

    t = _totals(rows)
    min_score = float(os.environ.get("QUON_TEST_MIN_SCORE", "0"))
    min_recall = float(os.environ.get("QUON_TEST_MIN_RECALL", str(min_score)))
    min_precision = float(os.environ.get("QUON_TEST_MIN_PRECISION", "0"))
    max_fp = int(os.environ.get("QUON_TEST_MAX_FP", "0"))

    if min_score > 0:
        assert t["recall_pct"] >= min_score, (
            f"overall redaction {t['recall_pct']:.0f}% < required {min_score:.0f}%"
        )
    if min_recall > 0:
        assert t["recall_pct"] >= min_recall, (
            f"recall {t['recall_pct']:.0f}% < required {min_recall:.0f}%"
        )
    if min_precision > 0:
        assert t["precision_pct"] >= min_precision, (
            f"precision {t['precision_pct']:.0f}% < required {min_precision:.0f}%"
        )
    if max_fp > 0:
        assert t["false"] <= max_fp, f"false positives {t['false']} > max {max_fp}"
