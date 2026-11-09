"""Ingest Open WebUI chat history into the private real-world eval set.

Companion to ``realworld_ingest.py`` (Google Takeout / Gemini-Apps activity).
Open WebUI stores every conversation in a SQLite DB (``webui.db``, table
``chat``, one JSON blob per conversation). This extracts just the **user-typed
prompts** - the same production register the Takeout corpus captures, from a
second real source - and MERGES them into the shared prompts file, keeping the
existing Takeout prompts.

Privacy posture (identical to realworld_ingest.py - this is real personal data,
treat like .env / quon.db):
- Reads a webui.db that lives outside the repo (pulled to ~/.quon/realworld/
  _import/ or given as an argument); output stays in ~/.quon/realworld/.
- Extracts only role=="user" message content - never assistant replies.
- Never prints prompt content to stdout - only aggregate counts.
- The output file (prompts.jsonl) is git-ignored by living outside the repo and
  must never be committed or included in a deploy rsync.

Usage:
    python tests/realworld_openwebui.py /path/to/webui.db [more.db ...]
    # default: ~/.quon/realworld/_import/webui.db if no path is given

Output: appended to ``~/.quon/realworld/prompts.jsonl`` - one
``{"text","source":"openwebui","date"}`` per new line (existing prompts kept,
exact-duplicate texts - within OpenWebUI and against the existing corpus - 
collapsed). Override the dir with ``QUON_REALWORLD_DIR``.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

# Minimum characters for a prompt to count (drops "ok", "danke", stray blanks) - 
# mirror realworld_ingest.py's len<2 guard, a touch higher for chat noise.
_MIN_LEN = 3
# Cap very long pasted blobs so one giant paste can't dominate the eval; the
# Takeout corpus is short questions, keep the register comparable.
_MAX_LEN = 4000


def _iter_user_prompts(chat_json: str) -> list[str]:
    """Every user-typed message text in one Open WebUI chat blob.

    The blob carries the same messages under two shapes across app versions:
    a flat ``messages`` list and a ``history.messages`` id->message map. Read
    both and dedupe by text so a version that fills both doesn't double-count.
    """
    try:
        chat = json.loads(chat_json)
    except (json.JSONDecodeError, TypeError):
        return []
    out: list[str] = []
    seen: set[str] = set()

    def take(msg: object) -> None:
        if not isinstance(msg, dict):
            return
        if msg.get("role") != "user":
            return
        content = msg.get("content")
        # Newer multimodal messages store content as a list of parts.
        if isinstance(content, list):
            content = " ".join(
                p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"
            )
        if not isinstance(content, str):
            return
        text = content.strip()
        if len(text) < _MIN_LEN or text in seen:
            return
        seen.add(text)
        out.append(text[:_MAX_LEN])

    for m in chat.get("messages", []) or []:
        take(m)
    history = chat.get("history")
    if isinstance(history, dict):
        for m in (history.get("messages") or {}).values():
            take(m)
    return out


def parse_webui_db(path: Path) -> tuple[list[dict], Counter]:
    """Extract ``{"text","source","date"}`` records from one webui.db."""
    records: list[dict] = []
    skipped: Counter = Counter()
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT chat, created_at FROM chat").fetchall()
    except sqlite3.OperationalError:
        # Older/newer schema: chat JSON only.
        rows = [(r[0], None) for r in con.execute("SELECT chat FROM chat").fetchall()]
    finally:
        con.close()

    for chat_json, created in rows:
        prompts = _iter_user_prompts(chat_json)
        if not prompts:
            skipped["no_user_text"] += 1
            continue
        date = ""
        if isinstance(created, (int, float)) and created > 0:
            date = datetime.fromtimestamp(created, tz=timezone.utc).date().isoformat()
        for text in prompts:
            records.append({"text": text, "source": "openwebui", "date": date})
    return records, skipped


def default_db() -> Path:
    root = Path(os.environ.get("QUON_REALWORLD_DIR", "~/.quon/realworld")).expanduser()
    return root / "_import" / "webui.db"


def out_path() -> Path:
    root = Path(os.environ.get("QUON_REALWORLD_DIR", "~/.quon/realworld")).expanduser()
    return root / "prompts.jsonl"


def main(argv: list[str]) -> int:
    paths = [Path(a).expanduser() for a in argv] or [default_db()]
    paths = [p for p in paths if p.exists()]
    if not paths:
        print("[owui] no webui.db found (pass a path or place it at "
              f"{default_db()})", file=sys.stderr)
        return 1

    new_records: list[dict] = []
    for p in paths:
        recs, skipped = parse_webui_db(p)
        new_records.extend(recs)
        skip_note = ", ".join(f"{k}={v}" for k, v in sorted(skipped.items())) or "none"
        print(f"[owui] {p.name}: {len(recs)} user prompts (chats skipped: {skip_note})")

    out = out_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    os.chmod(out.parent, 0o700)

    # Merge: keep existing corpus, add only texts not already present.
    existing: dict[str, dict] = {}
    if out.exists():
        for line in out.read_text(encoding="utf-8").splitlines():
            if line.strip():
                r = json.loads(line)
                existing.setdefault(r["text"], r)
    before = len(existing)
    added = 0
    for r in new_records:
        if r["text"] not in existing:
            existing[r["text"]] = r
            added += 1

    with out.open("w", encoding="utf-8") as fh:
        for r in existing.values():
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    by_source = Counter(r["source"] for r in existing.values())
    print(f"[owui] corpus {before} -> {len(existing)} unique prompts (+{added} new "
          f"from OpenWebUI, {len(new_records) - added} were duplicates) -> {out}")
    print(f"[owui] by source: {dict(by_source)}")
    print("[owui] NOTE: this file holds your real conversations — outside the repo "
          "on purpose; never commit or sync it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
