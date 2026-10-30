"""Where eval reports get written — and why it is not simply "next to the tests".

The reports (REPORT.md, CORPUS_REPORT.md, reports/HISTORY.md) are *tracked*, and
the test suite rewrote them on every run. That looked harmless and was not:

    pytest  ->  tracked file changes
            ->  `git status` is dirty
            ->  deploy/tree-fingerprint.sh hashes a different tree
            ->  every .claude/.preflight-ok stamp is invalidated
            ->  deploy/ci-gate.sh's clean-tree requirement can never be met

i.e. running the gate destroyed the gate's own output, and the deploy path was
unsatisfiable while looking like a stamp problem. It also produced a stream of
"refresh the corpus report" noise commits on main.

So: by default reports go to a gitignored directory. The tracked baselines are
rewritten only when explicitly asked for -- CI sets QUON_WRITE_BASELINE=1, and so
does the deliberate eval command -- which keeps the curated ledger in
reports/HISTORY.md meaningful instead of churning on every unrelated test run.
"""

from __future__ import annotations

import os
from pathlib import Path

_TESTS_DIR = Path(__file__).parent

#: Set to "1" to rewrite the tracked baselines (CI, explicit eval runs).
WRITE_BASELINE = os.environ.get("QUON_WRITE_BASELINE") == "1"

#: Gitignored destination for ordinary runs. Overridable so a parallel session
#: (or a worktree) can keep its artefacts entirely to itself.
LOCAL_REPORT_DIR = Path(
    os.environ.get("QUON_REPORT_DIR", str(_TESTS_DIR / "reports" / "local"))
)


def report_path_for(name: str) -> Path:
    """Resolve a report file, creating the directory when it is the local one."""
    if WRITE_BASELINE:
        # HISTORY.md lives one level down; everything else sits beside the tests.
        return _TESTS_DIR / "reports" / name if name == "HISTORY.md" else _TESTS_DIR / name
    LOCAL_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    return LOCAL_REPORT_DIR / name
