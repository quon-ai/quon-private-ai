"""Latency budget: the same ratchet detection has, applied to the send path.

Detection numbers are enforced (`test_corpus.py` floors and build-failing
asserts). Latency numbers once lived in prose, and prose does not fail a build:
a blocking fetch added to the send path shipped unnoticed. The usual objection,
that a mocked stream is always instant so no test can catch this, is true and
does not follow through. What can be checked, offline and in CI, is that a
measurement exists for the current send path and that its numbers are inside
the budget.

So this reads the ledger rather than the network. It is the same shape as
FLOORS: a measured value, its provenance, a directionality rule, and an assert.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

import pytest

LEDGER = Path(__file__).parent / "reports" / "LATENCY.md"

#: model -> (max first token s, max total s, min chunks)
#: Raise only after re-measuring with scripts/measure-latency.sh, and never lower
#: silently. min_chunks is the important one: a change can leave the total
#: untouched and still destroy streaming, which is most of what "feels slow" is.
BUDGET = {
    "gemini": (4.0, 25.0, 2),
    "claude": (4.0, 30.0, 2),
}

#: Touching any of these means the answer path changed.
SEND_PATH = re.compile(
    r"^(src/lib/chatRunner|src/lib/agents/|src/lib/tools/"
    r"|quon-scrubber-service/provider\.py)"
)


def _rows() -> list[list[str]]:
    if not LEDGER.exists():
        return []
    rows = []
    for line in LEDGER.read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        # auto-log rows are 8 wide and carry a sha in backticks
        if len(cells) == 8 and cells[1].startswith("`"):
            rows.append(cells)
    return rows


def test_recorded_latencies_are_inside_the_budget() -> None:
    """Every measured row must sit inside the budget for its model."""
    breaches: list[str] = []
    for ts, sha, _state, _note, model, first, total, chunks in _rows():
        if first == "ERR":
            continue
        key = next((k for k in BUDGET if k in model), None)
        if key is None:
            continue
        max_first, max_total, min_chunks = BUDGET[key]
        if float(first) > max_first:
            breaches.append(f"{ts} {sha} {model}: first token {first}s > {max_first}s")
        if float(total) > max_total:
            breaches.append(f"{ts} {sha} {model}: total {total}s > {max_total}s")
        if int(chunks) < min_chunks:
            breaches.append(
                f"{ts} {sha} {model}: {chunks} chunk(s) — streaming is gone, "
                "which the total alone would not show"
            )
    assert not breaches, "Latency budget breached:\n  " + "\n  ".join(breaches)


@pytest.mark.skipif(
    not Path(__file__).parents[2].joinpath(".git").exists(),
    reason="needs a git checkout to diff the send path",
)
def test_send_path_changes_come_with_a_measurement() -> None:
    """Every send-path change needs a ledger row for HEAD: a mocked stream
    cannot measure latency, so the ledger is the only place it is recorded.

    Advisory rather than fatal on a branch with no upstream: the point is to be
    impossible to *forget*, not to block unrelated work.
    """
    root = Path(__file__).parents[2]
    try:
        changed = subprocess.run(
            ["git", "-C", str(root), "diff", "--name-only", "origin/main...HEAD"],
            capture_output=True, text=True, timeout=20,
        ).stdout.splitlines()
        head = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=20,
        ).stdout.strip()
    except (subprocess.SubprocessError, OSError):  # pragma: no cover
        pytest.skip("git unavailable")

    if not any(SEND_PATH.match(p) for p in changed):
        return
    assert any(head in row[1] for row in _rows()), (
        f"The send path changed but LATENCY.md has no row for {head}.\n"
        "A mocked stream is always instant, so no other test here can see a "
        "regression on this path. Measure it:\n"
        '  scripts/measure-latency.sh --baseline "before"\n'
        '  scripts/measure-latency.sh --after    "<what changed>"'
    )
