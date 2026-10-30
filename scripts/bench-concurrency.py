#!/usr/bin/env python3
"""Concurrency benchmark for the scrub path — the dimension the ledger never had.

Every latency number this project has recorded is ONE request at a time:
`bench-scrub.sh` and `measure-latency.sh` both measure a lone caller. That
answers "is the filter fast?" and is silent on "does it hold N users", which is
a different question with a different answer on a box with ONE physical core.
The production t3.large reports CoreCount 1 / ThreadsPerCore 2 — the second
vCPU is a hyperthread, which is exactly why GLiNER measured no thread scaling
(1579 ms vs 1506 ms for one thread vs two). Two concurrent detections contend
for one core; they do not run side by side.

What it measures: the CPU-bound detection base (spaCy/Presidio + regex, plus
GLiNER when GLINER_ENABLED=true) under N concurrent callers, with NO cloud
enrichment (api_key=None), so the number is this machine's compute rather than
OpenRouter's queue. Reports per-request p50/p95/max, throughput and peak RSS.

⚠️ Read the output as a CEILING, not a forecast. All N callers press send in the
same millisecond, which real users never do. The useful signal is the SHAPE —
how p95 degrades as N grows, and where RSS lands against the host's memory.

    python scripts/bench-concurrency.py --levels 1,2,5,10 --chars 400 --rounds 3
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import resource
import statistics
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SERVICE = os.path.join(os.path.dirname(HERE), "quon-scrubber-service")
sys.path.insert(0, os.environ.get("QUON_SERVICE_DIR", SERVICE))

import scrubber  # noqa: E402
from models import ScrubOptions  # noqa: E402

# A realistic German chat message carrying several PII shapes, padded to length.
# Synthetic on purpose — never pin a benchmark with real personal data.
SEED = (
    "Hallo, hier ist Martin Schneider aus Duesseldorf. Meine Nummer ist "
    "0211 44556677 und die Mail martin.schneider@beispiel.de. Die Rechnung "
    "vom 14. Juni ueber 289,90 Euro an IBAN DE02120300000000202051 ist noch "
    "offen - kannst du dem Kollegen Bescheid geben? "
)


def make_text(chars: int) -> str:
    out = SEED
    while len(out) < chars:
        out += SEED
    return out[:chars]


def peak_rss_mb() -> float:
    ru = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return ru / 1024 if sys.platform.startswith("linux") else ru / (1024 * 1024)


async def one(text: str, opts: ScrubOptions) -> float:
    t0 = time.perf_counter()
    await scrubber.scrub(text, opts, api_key=None, pii=None)
    return time.perf_counter() - t0


async def level(n: int, text: str, opts: ScrubOptions, rounds: int) -> dict:
    lat: list[float] = []
    wall0 = time.perf_counter()
    for _ in range(rounds):
        lat.extend(await asyncio.gather(*(one(text, opts) for _ in range(n))))
    wall = time.perf_counter() - wall0
    lat.sort()
    idx = min(len(lat) - 1, int(len(lat) * 0.95))
    return {
        "concurrency": n,
        "requests": len(lat),
        "p50_s": round(statistics.median(lat), 2),
        "p95_s": round(lat[idx], 2),
        "max_s": round(lat[-1], 2),
        "throughput_rps": round(len(lat) / wall, 2),
        "wall_s": round(wall, 1),
        "peak_rss_mb": round(peak_rss_mb()),
    }


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", default="1,2,5,10")
    ap.add_argument("--chars", type=int, default=400)
    ap.add_argument("--rounds", type=int, default=3)
    args = ap.parse_args()

    text = make_text(args.chars)
    opts = ScrubOptions(language="de", show_entities=True)

    # WARM FIRST, ALWAYS. GLiNER's model load is 23.9s and spaCy's is seconds;
    # folding either into the first measured request reports a cold start as a
    # concurrency problem. Same reason main.py warms in lifespan.
    t0 = time.perf_counter()
    await scrubber.scrub(text, opts, api_key=None, pii=None)
    warm = round(time.perf_counter() - t0, 1)

    rows = []
    for n in [int(x) for x in args.levels.split(",")]:
        rows.append(await level(n, text, opts, args.rounds))
        print(json.dumps(rows[-1]), flush=True)

    print(
        json.dumps(
            {
                "meta": {
                    "chars": args.chars,
                    "rounds": args.rounds,
                    "warm_s": warm,
                    "gliner_enabled": os.environ.get("GLINER_ENABLED", "false"),
                    "cpu_count": os.cpu_count(),
                },
                "rows": rows,
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
