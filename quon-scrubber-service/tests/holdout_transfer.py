"""Does a detection change GENERALISE, or did it just memorise our paperwork?

The question this answers, and the reason it exists:

    A regex over digit-group shape ("15.04.2025") works on every German date
    forever. A LIST of identifier labels ("Versicherungsnummer", "Zaehlernummer")
    works on the documents it was read from. Both raise corpus recall. Only one
    of them helps a user whose insurer words things differently.

Real documents carry no gold labels, so recall cannot be measured here. What can
be measured without labels is TRANSFER: how often each rule fires per 10k
characters on the tune set versus a holdout the author never inspected. A rule
fires at a similar rate on both. A fitted list falls off a cliff.

    transfer ratio = holdout rate / tune rate
      ~1.0  generalises
      <0.5  substantially fitted to the tune documents

DISCIPLINE, ENFORCED here rather than PROMISED: this module never prints a
detected value, and never a holdout filename. It emits counts and ratios only.
That is deliberate - an author who reads the holdout's misses and then "fixes"
them has converted the holdout into a second tune set, and the number stops
meaning anything. Values stay in the private per-set report for a human.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from pathlib import Path


def load(store: Path) -> list[dict]:
    f = store / "documents.jsonl"
    if not f.exists():
        return []
    # split("\n"), not splitlines(): json.dumps escapes real newlines but leaves
    # U+2028/U+2029 (LINE/PARAGRAPH SEPARATOR) raw, and str.splitlines() breaks on
    # those - so one OCR'd page split a record in half and the reader died on
    # "Unterminated string". Latent in every JSONL reader written this way.
    return [json.loads(l) for l in f.read_text(encoding="utf-8").split("\n") if l.strip()]


def measure(docs: list[dict]) -> tuple[Counter, int]:
    """Detections by type per set, plus total characters. Config-1 only: this is
    about the deterministic net, and it must never make a network call."""
    from config import settings
    from models import ScrubOptions
    import scrubber
    import asyncio
    by_type: Counter = Counter()
    chars = 0

    async def run():
        nonlocal chars
        for d in docs:
            res = await scrubber.scrub(d["text"], ScrubOptions(language="de"))
            chars += len(d["text"])
            for e in res.entities:
                by_type[e.type] += 1

    try:
        asyncio.run(run())
    finally:
    return by_type, chars


def main() -> int:
    base = Path(os.environ.get("QUON_REALWORLD_DIR", "~/.quon/realworld")).expanduser()
    tune = load(base)
    hold = load(base / "holdout")
    if not tune or not hold:
        print("need both stores: documents.jsonl in the base dir and in holdout/")
        return 2

    t_types, t_chars = measure(tune)
    h_types, h_chars = measure(hold)

    def rate(c: Counter, chars: int, k: str) -> float:
        return 10_000.0 * c[k] / chars if chars else 0.0

    print(f"tune    : {len(tune):3} docs  {t_chars:>8,} chars  {sum(t_types.values()):5} detections")
    print(f"holdout : {len(hold):3} docs  {h_chars:>8,} chars  {sum(h_types.values()):5} detections")
    print(f"\noverall detection rate per 10k chars: "
          f"tune {10_000*sum(t_types.values())/t_chars:.1f}  ·  "
          f"holdout {10_000*sum(h_types.values())/h_chars:.1f}  ·  "
          f"transfer {(10_000*sum(h_types.values())/h_chars)/(10_000*sum(t_types.values())/t_chars):.2f}")

    print(f"\n{'type':18} {'tune/10k':>9} {'hold/10k':>9} {'transfer':>9}   reading")
    print("-" * 64)
    for k in sorted(set(t_types) | set(h_types), key=lambda x: -t_types[x]):
        tr, hr = rate(t_types, t_chars, k), rate(h_types, h_chars, k)
        ratio = (hr / tr) if tr else float("nan")
        # A low ratio has two possible causes and this metric cannot separate them:
        # a fitted rule, or a holdout that simply contains less of that thing.
        # EMAIL sits at 0.60 here and is pure Presidio - never fitted by anyone - 
        # so the low end must be read as "look closer", never as a verdict. Only
        # the high end is safe to conclude from: a rule cannot transfer well by
        # accident.
        if tr == 0:
            reading = "absent from tune"
        elif ratio >= 0.75:
            reading = "transfers"
        elif ratio >= 0.4:
            reading = "check: fitted, or rarer here?"
        else:
            reading = "CHECK — fitted, or much rarer here?"
        print(f"{k:18} {tr:9.2f} {hr:9.2f} {ratio:9.2f}   {reading}")
    print("\nNo values printed, by design — see the module docstring.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
