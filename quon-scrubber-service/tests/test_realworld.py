"""Real-world prompt eval — the user's own exported Gemini/KI-Modus history.

Opt-in and strictly offline:

    # one-time: ingest the Takeout export (writes ~/.quon/realworld/prompts.jsonl)
    python tests/realworld_ingest.py "~/Downloads/Takeout 3/Meine Aktivitäten"
    # run the eval
    QUON_RUN_REALWORLD=1 pytest tests/test_realworld.py -q

Why this exists: the synthetic corpus is formal-register (invoices, business
email, tax letters), but all three user-reported PERSON false positives lived
in casual chat questions. Real prompts are the production register — this eval
runs every one of them through config 1 (NER + regex, ``llm_enrichment=False``,
ZERO cloud calls) and writes every detection to a private report for human
review. Real prompts have no gold labels, so this is primarily an FP-hunting
harness, plus a growing regression gate:

- Report: ``~/.quon/realworld/REALWORLD_REPORT.md`` — every detection with
  context, grouped by type. REAL personal data: lives outside the repo, is
  never printed to stdout (aggregate counts only), never commit it.
- Ratchet: ``~/.quon/realworld/labels.json`` — reviewed false positives, in
  two tiers (values matched case-insensitively against detected entity values)::

      {
        "false_positives": ["Rehbergplatz"],          // FIXED: asserted never-detected-again
        "open_false_positives": ["Kafka", "Mach"]      // confirmed FP, detector fix pending
      }

  ``false_positives`` is the hard ratchet: each value ASSERTS as
  never-detected-again, so every fixed FP becomes a permanent regression test
  against the real-world data. ``open_false_positives`` is the reviewed
  work-queue: still detected today, flagged in the report and counted in the
  summary, but not asserted — migrate a value to ``false_positives`` when the
  detector change that kills it lands (if it resurfaces after that, the suite
  goes red).

The data dir is ``QUON_REALWORLD_DIR`` (default ``~/.quon/realworld``). The
test SKIPS cleanly when the data file is absent, so CI / other machines and
the preflight gate are unaffected.

The config-2 (LLM-enriched) comparison mode was removed with the LLM tier on
2026-08-23; historical numbers live in the archived REALWORLD_REPORT_LLM.md.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

import pytest

import auth as _auth
import scrubber
from config import settings
from main import app
from models import ScrubOptions
from tests.test_api import _scrub


@pytest.fixture(autouse=True)
def _bypass_auth():
    """Same dependency-override as test_api's autouse fixture (module-scoped
    there, so it does NOT apply here automatically): this eval measures
    detection quality, not auth."""
    app.dependency_overrides[_auth.current_active_user] = lambda: _auth.User(
        id="realworld-eval", email="eval@quon.local", status="active", session_id="eval"
    )
    yield
    app.dependency_overrides.pop(_auth.current_active_user, None)


def _data_dir() -> Path:
    return Path(os.environ.get("QUON_REALWORLD_DIR", "~/.quon/realworld")).expanduser()


def _context(text: str, value: str, width: int = 45) -> str:
    """±width chars around the first occurrence of value (for the report only)."""
    idx = text.lower().find(value.lower())
    if idx < 0:
        return text[: 2 * width]
    start, end = max(0, idx - width), min(len(text), idx + len(value) + width)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    snippet = text[start:end].replace("\n", " ")
    return f"{prefix}{snippet}{suffix}"


@pytest.mark.skipif(
    not os.environ.get("QUON_RUN_REALWORLD"),
    reason="opt-in private eval; ingest a Takeout export, then set QUON_RUN_REALWORLD=1",
)
def test_realworld_prompts():
    data_path = _data_dir() / "prompts.jsonl"
    if not data_path.exists():
        pytest.skip(f"no real-world data at {data_path} (run tests/realworld_ingest.py first)")

    prompts = [json.loads(line) for line in data_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    assert prompts, "prompts.jsonl exists but is empty"

    labels_path = _data_dir() / "labels.json"
    labeled_fps: set[str] = set()  # fixed → asserted
    open_fps: set[str] = set()  # reviewed, fix pending → tracked only
    if labels_path.exists():
        labels = json.loads(labels_path.read_text(encoding="utf-8"))
        labeled_fps = {v.strip().lower() for v in labels.get("false_positives", []) if v.strip()}
        open_fps = {v.strip().lower() for v in labels.get("open_false_positives", []) if v.strip()}

    # Deterministic, local-only — the ONLY pipeline there is since the LLM
    # extraction tier was removed (2026-08-23). Nothing to toggle off anymore.
    rows: list[dict] = []
    for p in prompts:
        res = _scrub(p["text"])
        ents = res.get("entities") or []
        rows.append({"prompt": p, "entities": ents})

    # ---- aggregate stats (the ONLY thing that may reach stdout) ----
    n = len(rows)
    with_det = [r for r in rows if r["entities"]]
    type_counts: Counter = Counter(e["type"] for r in rows for e in r["entities"])
    src_counts: Counter = Counter(r["prompt"]["source"] for r in rows)

    # ---- private report (real data — file only, never stdout) ----
    by_type: dict[str, Counter] = defaultdict(Counter)
    contexts: dict[tuple[str, str], list[str]] = defaultdict(list)
    for r in rows:
        for e in r["entities"]:
            key = (e["type"], e["value"])
            by_type[e["type"]][e["value"]] += 1
            if len(contexts[key]) < 3:
                contexts[key].append(_context(r["prompt"]["text"], e["value"]))

    open_det = sorted(
        {
            e["value"]
            for r in rows
            for e in r["entities"]
            if e["value"].strip().lower() in open_fps
        }
    )
    open_det_count = sum(
        1 for r in rows for e in r["entities"] if e["value"].strip().lower() in open_fps
    )

    lines = [
        "# Real-world prompt eval (config 1: NER + regex, LLM off)",
        "",
        "PRIVATE — built from your own exported conversations. Never commit/sync.",
        "",
        f"- Prompts: {n} ({dict(src_counts)})",
        f"- Prompts with ≥1 detection: {len(with_det)} ({100 * len(with_det) / n:.1f}%)",
        f"- Detections by type: {dict(type_counts) or '—'}",
        f"- Fixed false positives (asserted ratchet): {len(labeled_fps)}",
        f"- Open false positives (reviewed, fix pending): {len(open_fps)} labeled, "
        f"{len(open_det)} still detected ({open_det_count} detections)",
        "",
        "Review guide: casual questions usually contain no PII — most PERSON hits",
        "below are FP candidates. Reviewed FPs go into labels.json under",
        '`"open_false_positives"`; migrate a value to `"false_positives"` once the',
        "detector fix lands — from then on it is asserted never-detected-again.",
    ]
    for etype in sorted(by_type):
        lines += ["", f"## {etype} ({sum(by_type[etype].values())} detections, {len(by_type[etype])} distinct)", ""]
        for value, cnt in by_type[etype].most_common():
            key = value.strip().lower()
            flag = ""
            if key in labeled_fps:
                flag = "  🔴 FIXED-labeled FP — detected again (regression!)"
            elif key in open_fps:
                flag = "  ⚠️ reviewed FP — fix pending"
            lines.append(f"- `{value}` ×{cnt}{flag}")
            for c in contexts[(etype, value)]:
                lines.append(f"    - {c}")
    report_path = _data_dir() / "REALWORLD_REPORT.md"
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(
        f"\n[realworld] {n} prompts ({dict(src_counts)}) | "
        f"{len(with_det)} with detections ({100 * len(with_det) / n:.1f}%) | "
        f"by type: {dict(type_counts) or '—'} | "
        f"open FPs still detected: {len(open_det)}/{len(open_fps)} | report -> {report_path}"
    )

    # ---- the growing ratchet: every reviewed FP stays fixed ----
    still_detected = sorted(
        {
            e["value"]
            for r in rows
            for e in r["entities"]
            if e["value"].strip().lower() in labeled_fps
        }
    )
    assert not still_detected, (
        f"{len(still_detected)} labeled false positive(s) are detected again "
        f"(see {report_path} for context; values withheld from test output on purpose)"
    )
