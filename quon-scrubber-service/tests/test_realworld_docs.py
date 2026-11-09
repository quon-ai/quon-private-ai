"""Real-DOCUMENT eval - the user's own paperwork (insurance, invoices, medical,
tax, utilities), opt-in and offline by default.

    python tests/realworld_docs_ingest.py ~/Downloads/Test_Documents
    QUON_RUN_REALWORLD_DOCS=1 pytest tests/test_realworld_docs.py -q -s

Why this exists alongside ``test_realworld.py``: that one covers chat PROMPTS -
short, casual, and the register where the PERSON false positives lived. Real
documents are the opposite register, and they carry identifier FORMATS no
synthetic generator invents: policy numbers, Steuernummern, Aktenzeichen, meter
readings, Versichertennummern. The value showed immediately - the first run over
45 files found that the dotted German date, the single most common shape in the
set (126 occurrences), was excluded from PHONE but never DETECTED, a hole the
synthetic corpus could not see because the cloud LLM was covering it.

Documents have no gold labels, so like the prompt eval this measures false
positives and coverage, never recall. Recall stays with the synthetic corpus.

- Report: ``~/.quon/realworld/REALWORLD_DOCS_REPORT.md`` - every detection with
  context, for HUMAN review. Real data: outside the repo, never printed here.
- Ratchet: the same ``labels.json``, under document-specific keys so a prompt FP
  and a document FP cannot mask each other::

      {"doc_false_positives": [...], "doc_open_false_positives": [...]}

  ``doc_false_positives`` is the hard ratchet: each value asserts as
  never-detected-again, so every fixed FP becomes a permanent regression test
  against the real documents.

There is no LLM-enriched comparison mode: the deterministic in-process pipeline
is the only one measured, so the document text never leaves the machine.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

import pytest

from config import settings
from models import ScrubOptions


def _data_dir() -> Path:
    return Path(os.environ.get("QUON_REALWORLD_DIR", "~/.quon/realworld")).expanduser()


def _context(text: str, value: str, width: int = 45) -> str:
    i = text.lower().find(value.lower())
    if i < 0:
        return ""
    start, end = max(0, i - width), min(len(text), i + len(value) + width)
    return text[start:end].replace("\n", " ").replace("|", "/")


def _load() -> list[dict]:
    path = _data_dir() / "documents.jsonl"
    if not path.exists():
        return []
    out = []
    # split("\n"), not splitlines() - see holdout_transfer.load(): U+2028 in an
    # OCR'd page is left raw by json.dumps and splits a record in half.
    for line in path.read_text(encoding="utf-8").split("\n"):
        line = line.strip()
        if line:
            out.append(json.loads(line))
    return out


@pytest.mark.skipif(
    not os.environ.get("QUON_RUN_REALWORLD_DOCS"),
    reason="opt-in private eval; ingest documents, then set QUON_RUN_REALWORLD_DOCS=1",
)
def test_realworld_documents():
    docs = _load()
    if not docs:
        pytest.skip("no documents.jsonl — run tests/realworld_docs_ingest.py first")

    import scrubber

    llm_on = False  # there is no LLM-enriched mode

    labels_path = _data_dir() / "labels.json"
    fixed_fps: set[str] = set()
    open_fps: set[str] = set()
    if labels_path.exists():
        labels = json.loads(labels_path.read_text(encoding="utf-8"))
        fixed_fps = {v.strip().lower() for v in labels.get("doc_false_positives", []) if v.strip()}
        open_fps = {v.strip().lower() for v in labels.get("doc_open_false_positives", []) if v.strip()}

    async def run_all():
        rows = []
        for d in docs:
            res = await scrubber.scrub(d["text"], ScrubOptions(language="de"))
            rows.append((d, res))
        return rows
    rows = asyncio.run(run_all())

    by_type: Counter = Counter()
    by_value: Counter = Counter()
    contexts: dict[str, list[str]] = defaultdict(list)
    ocr_docs = sum(1 for d, _ in rows if d.get("ocr"))
    regressed: list[str] = []

    for d, res in rows:
        for e in res.entities:
            by_type[e.type] += 1
            key = e.value.strip()
            by_value[key] += 1
            if len(contexts[key]) < 3:
                ctx = _context(d["text"], key)
                if ctx:
                    contexts[key].append(f"{d['source'][:34]}: …{ctx}…")
            if key.lower() in fixed_fps:
                regressed.append(key)

    lines = [
        "# Real-document detection report",
        "",
        "⚠️ REAL personal data — never commit, never paste into a transcript.",
        "",
        f"- Documents: {len(rows)} ({ocr_docs} recovered via OCR)",
        f"- Characters: {sum(d['chars'] for d, _ in rows):,}",
        f"- Mode: {'config 2/3 (NER + regex + LLM)' if llm_on else 'config 1 (NER + regex)'}",
        f"- Detections: {sum(by_type.values())}",
        f"- Distinct values: {len(by_value)}",
        f"- Fixed FPs asserted: {len(fixed_fps)} · open FPs tracked: {len(open_fps)}",
        "",
        "Documents have no gold labels: this hunts FALSE POSITIVES and shows",
        "coverage. Reviewed FPs go into labels.json under `doc_open_false_positives`;",
        "migrate to `doc_false_positives` once the detector fix lands, and it becomes",
        "a permanent regression test.",
        "",
        "## Detections by type",
        "",
        "| type | count |",
        "| --- | --- |",
    ]
    lines += [f"| {t} | {n} |" for t, n in by_type.most_common()]
    for t, _n in by_type.most_common():
        lines += ["", f"## {t}", "", "| value | n | open FP? | context |", "| --- | --- | --- | --- |"]
        vals = sorted(
            ((v, c) for v, c in by_value.items()
             if any(e.type == t for _d, r in rows for e in r.entities if e.value.strip() == v)),
            key=lambda x: -x[1],
        )
        for v, c in vals[:120]:
            flag = "OPEN-FP" if v.lower() in open_fps else ""
            lines.append(f"| `{v}` | {c} | {flag} | {(contexts[v] or [''])[0][:110]} |")

    report = _data_dir() / ("REALWORLD_DOCS_REPORT_LLM.md" if llm_on else "REALWORLD_DOCS_REPORT.md")
    report.write_text("\n".join(lines) + "\n", encoding="utf-8")

    # stdout stays aggregate-only: this report names real people.
    print(f"\n[realworld-docs] {len(rows)} documents ({ocr_docs} OCR), "
          f"{sum(by_type.values())} detections, {len(by_value)} distinct")
    print(f"[realworld-docs] by type: {dict(by_type.most_common())}")
    print(f"[realworld-docs] report -> {report}")

    assert not regressed, (
        f"{len(set(regressed))} value(s) in doc_false_positives were detected again — "
        "a fixed false positive regressed. See the report."
    )
