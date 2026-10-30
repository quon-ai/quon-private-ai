"""Ingest Google Takeout "Meine Aktivitäten" HTML into a private real-world eval set.

Parses the user's own exported Gemini-Apps / KI-Modus (AI-Mode search) activity
HTML and extracts just the typed prompts — the closest thing to QUON's real
production register (short, casual, mixed-language chat questions; the exact
register where all three reported PERSON false positives lived, which the
formal-register synthetic corpus never covered).

Privacy posture (this is REAL personal data — treat like .env / quon.db):
- Output goes to ``~/.quon/realworld/`` (0700), OUTSIDE the repo, so the raw
  prompts can never end up in git, on GitHub, or in the mini-PC deploy rsync.
- This module never prints prompt content to stdout — only aggregate counts.
- The companion eval (tests/test_realworld.py) is equally offline: config 1
  (NER + regex, in-process only), zero cloud calls.

Usage:
    python tests/realworld_ingest.py "<path to MeineAktivitäten.html>" [more...]
    # or point it at the Takeout "Meine Aktivitäten" directory to auto-discover
    python tests/realworld_ingest.py "~/Downloads/Takeout 3/Meine Aktivitäten"

Output: ``~/.quon/realworld/prompts.jsonl`` — one ``{"text", "source", "date"}``
per line (exact-duplicate texts collapsed, first date kept). Override the
directory with ``QUON_REALWORLD_DIR``.
"""

from __future__ import annotations

import html as htmllib
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

# Google Takeout "My Activity" body cell (the one carrying the typed prompt —
# the sibling caption cells hold product/details boilerplate).
_BODY_CELL_RE = re.compile(
    r'<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">(.*?)</div>',
    re.S,
)
_TAG_RE = re.compile(r"<[^>]+>")

# Fixed per-locale prefixes Google puts before the user's text. (German export
# verified against the real files; English equivalents included for robustness.)
_PROMPT_PREFIXES = ("Eingegebener Prompt:", "Prompted")
_SEARCH_PREFIXES = ("Gesucht nach", "Searched for")

# A segment is the activity timestamp, not prompt text, if it carries a clock
# time plus a year or month token — ORDER-INDEPENDENT: the German export writes
# "8. Juli 2026, 12:34:56 MESZ" (year BEFORE the time), so a single ordered
# regex silently misses every date and the timestamp + trailing boilerplate get
# joined into the prompt text (caught on the first real run: median prompt
# length was implausibly high).
_CLOCK_RE = re.compile(r"\b\d{1,2}:\d{2}(:\d{2})?\b")
_YEAR_RE = re.compile(r"\b20\d\d\b")
_MONTH_RE = re.compile(
    r"\b(Jan|Feb|Mär|Mar|Apr|Mai|May|Jun|Jul|Aug|Sep|Okt|Oct|Nov|Dez|Dec)[a-zä]*\b",
    re.IGNORECASE,
)


# Google appends attachment markers to the exported prompt text ("1
# generiertes Bild.", "2 generierte Dateien.", "1 Datei angehängt. -
# foo.png"). They are not something the user typed, and they polluted the
# first eval run (the marker itself was the single most-frequent PERSON
# false positive, and an attached filename's number tripped the PHONE
# supplement) — strip them from the tail, repeatedly, before storing.
_ATTACH_MARKER_RES = [
    re.compile(r"\s*\d+\s+generierte[sn]?\s+(Bild(er)?|Datei(en)?)\.?\s*$", re.I),
    re.compile(r"\s*\d+\s+(Datei(en)?\s+angehängt|attachments?\s+attached|file[s]?\s+attached)\.?\s*$", re.I),
    re.compile(r"\s*-\s+\S+\.(png|jpe?g|pdf|webp|wav|m4a|gif|docx?|pptx?|xlsx?)\s*$", re.I),
]


def _strip_attachment_markers(text: str) -> str:
    while True:
        for rx in _ATTACH_MARKER_RES:
            new = rx.sub("", text)
            if new != text:
                text = new.strip()
                break
        else:
            return text.strip()


def _seg_text(seg: str) -> str:
    return htmllib.unescape(_TAG_RE.sub(" ", seg)).replace("\xa0", " ").strip()


def _is_date_seg(text: str) -> bool:
    return bool(
        _CLOCK_RE.search(text) and (_YEAR_RE.search(text) or _MONTH_RE.search(text))
    )


def parse_activity_html(path: Path) -> tuple[list[dict], Counter]:
    """Extract ``{"text", "source", "date"}`` prompt records from one export file.

    Returns ``(records, skip_stats)``. Never raises on malformed cells — they
    are counted and skipped (this is best-effort ingestion of a Google export
    format we don't control).
    """
    raw = path.read_text(encoding="utf-8")
    source = "ki-modus" if "KI‑Modus" in str(path) or "KI-Modus" in str(path) else "gemini"
    records: list[dict] = []
    skipped: Counter = Counter()

    for cell in _BODY_CELL_RE.findall(raw):
        segs = [_seg_text(s) for s in cell.split("<br>")]
        segs = [s for s in segs if s]
        if not segs:
            skipped["empty-cell"] += 1
            continue
        head = segs[0]

        prompt_prefix = next((p for p in _PROMPT_PREFIXES if head.startswith(p)), None)
        search_prefix = next((p for p in _SEARCH_PREFIXES if head.startswith(p)), None)
        if not prompt_prefix and not search_prefix:
            # Other activity kinds ("opened Gemini", etc.) — not typed text.
            skipped["non-prompt-cell"] += 1
            continue

        prefix = prompt_prefix or search_prefix
        segs[0] = head[len(prefix) :].lstrip(" : ")

        # The typed text spans segments 0..first-date-segment (multi-line prompts).
        text_parts: list[str] = []
        date = ""
        for s in segs:
            if _is_date_seg(s):
                date = s
                break
            text_parts.append(s)
        text = _strip_attachment_markers("\n".join(p for p in text_parts if p).strip())
        if len(text) < 2:
            skipped["too-short"] += 1
            continue
        records.append({"text": text, "source": source, "date": date})

    return records, skipped


def discover(paths: list[str]) -> list[Path]:
    """Expand files/directories into the activity HTML files to parse."""
    out: list[Path] = []
    for p in paths:
        path = Path(os.path.expanduser(p))
        if path.is_dir():
            out.extend(sorted(path.rglob("MeineAktivitäten.html")))
            out.extend(sorted(path.rglob("MyActivity.html")))
        elif path.is_file():
            out.append(path)
        else:
            print(f"[ingest] WARNING: not found, skipping: {path}", file=sys.stderr)
    return out


def default_out_dir() -> Path:
    return Path(os.environ.get("QUON_REALWORLD_DIR", "~/.quon/realworld")).expanduser()


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    files = discover(argv)
    if not files:
        print("[ingest] no activity HTML files found", file=sys.stderr)
        return 1

    all_records: list[dict] = []
    for f in files:
        records, skipped = parse_activity_html(f)
        all_records.extend(records)
        skip_note = ", ".join(f"{k}={v}" for k, v in sorted(skipped.items())) or "none"
        print(f"[ingest] {f.name} ({records[0]['source'] if records else '?'}): "
              f"{len(records)} prompts (skipped: {skip_note})")

    # Collapse exact duplicates (repeat questions are common in real usage);
    # keep first-seen order and date.
    seen: dict[str, dict] = {}
    for r in all_records:
        seen.setdefault(r["text"], r)
    deduped = list(seen.values())

    out_dir = default_out_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(out_dir, 0o700)
    out_path = out_dir / "prompts.jsonl"
    with out_path.open("w", encoding="utf-8") as fh:
        for r in deduped:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    by_source = Counter(r["source"] for r in deduped)
    print(f"[ingest] wrote {len(deduped)} unique prompts "
          f"({len(all_records) - len(deduped)} duplicates collapsed) -> {out_path}")
    print(f"[ingest] by source: {dict(by_source)}")
    print("[ingest] NOTE: this file contains your real conversations — it lives "
          "outside the repo on purpose; never commit or sync it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
