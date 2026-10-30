"""Resumable chat streams.

Mobile browsers freeze a backgrounded page: JavaScript stops and the open SSE
connection dies, so switching apps mid-answer used to lose the generation
("Verbindung verloren"). No web page can keep its own socket alive through that
— but the SERVER can keep generating.

So a `/chat/stream` request now runs its provider stream in a background task
that appends every event to an in-memory buffer; the HTTP response merely
FOLLOWS that buffer. A client that comes back reconnects with the job id and
the number of events it already saw, gets the missing ones replayed, and then
rides the live tail (or finds the job finished and takes the rest at once).

Zero-knowledge: the buffered events are exactly the scrubbed, placeholder-only
tokens the server already relays today — re-hydration happens client-side, so
nothing here can hold real values. What changes is RETENTION: seconds in flight
→ minutes in RAM. Never written to disk, evicted on TTL, and gone on restart
(a restart simply degrades to today's behaviour: resume 404s → the client
falls back to its Retry path).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

logger = logging.getLogger("quon.stream_jobs")

# A finished job stays resumable this long (the user switched apps and comes
# back), an unfinished one may idle this long without any reader.
JOB_TTL_SECONDS = 15 * 60
# Hard cap per user: a job holds its whole answer in RAM, so a client that
# reconnects instead of resuming must not pile them up. Oldest evicted first.
MAX_JOBS_PER_USER = 4
# Safety cap per job — a runaway provider stream must not grow unbounded.
MAX_EVENTS_PER_JOB = 20_000


@dataclass
class StreamJob:
    id: str
    user_id: str
    events: list[dict[str, Any]] = field(default_factory=list)
    done: bool = False
    created_at: float = field(default_factory=time.monotonic)
    updated_at: float = field(default_factory=time.monotonic)
    # Signalled whenever events are appended or the job completes, so followers
    # wake without polling.
    _wake: asyncio.Event = field(default_factory=asyncio.Event)

    def append(self, event: dict[str, Any]) -> None:
        if len(self.events) < MAX_EVENTS_PER_JOB:
            self.events.append(event)
        self.updated_at = time.monotonic()
        self._wake.set()

    def finish(self) -> None:
        self.done = True
        self.updated_at = time.monotonic()
        self._wake.set()


_jobs: dict[str, StreamJob] = {}


def _sweep(now: float | None = None) -> None:
    """Drop expired jobs. Called on create (cheap, no background timer needed)."""
    t = time.monotonic() if now is None else now
    for job_id in [j for j, job in _jobs.items() if t - job.updated_at > JOB_TTL_SECONDS]:
        _jobs.pop(job_id, None)


def create(user_id: str) -> StreamJob:
    """Register a new job for this user, evicting expired ones and the user's
    oldest if they are at the cap."""
    _sweep()
    mine = sorted(
        (j for j in _jobs.values() if j.user_id == user_id), key=lambda j: j.created_at
    )
    for old in mine[: max(0, len(mine) - (MAX_JOBS_PER_USER - 1))]:
        _jobs.pop(old.id, None)
    # 32 hex chars of CSPRNG: a job id is a bearer-ish handle, so it must not be
    # guessable — though `get` also checks the session's user id.
    job = StreamJob(id=secrets.token_hex(16), user_id=user_id)
    _jobs[job.id] = job
    return job


def get(job_id: str, user_id: str) -> StreamJob | None:
    """The job, but only for the user who owns it (never cross-account)."""
    job = _jobs.get(job_id)
    if job is None or job.user_id != user_id:
        return None
    if time.monotonic() - job.updated_at > JOB_TTL_SECONDS:
        _jobs.pop(job_id, None)
        return None
    return job


def drop(job_id: str) -> None:
    _jobs.pop(job_id, None)


def count() -> int:
    """Live job count (tests + a future /admin stat)."""
    return len(_jobs)


def reset() -> None:
    """Test hook — the registry is process-global."""
    _jobs.clear()


async def pump(job: StreamJob, agen: AsyncIterator[Any], provider_error: type[Exception]) -> None:
    """Drain the provider stream into the job buffer, INDEPENDENTLY of any HTTP
    response. This is what makes a backgrounded client harmless: the answer
    keeps arriving and simply waits in RAM.

    Normalizes to the same event shapes the endpoint sent before: a plain string
    delta becomes {"delta": …}, dicts (tool_calls/reasoning/annotations) pass
    through, the terminal event is {"done": True} or {"error": …}.
    """
    try:
        async for chunk in agen:
            job.append(chunk if isinstance(chunk, dict) else {"delta": chunk})
        job.append({"done": True})
    except provider_error as exc:  # provider.ProviderError — injected to avoid a cycle
        job.append({"error": str(exc)})
    except asyncio.CancelledError:
        # Shutdown: mark finished so followers don't hang on a dead job.
        job.append({"error": "stream cancelled"})
        raise
    except Exception as exc:  # noqa: BLE001 — never leave a job unfinished
        logger.exception("stream job %s failed", job.id)
        job.append({"error": f"unexpected stream failure: {exc}"})
    finally:
        job.finish()
        with contextlib.suppress(Exception):
            aclose = getattr(agen, "aclose", None)
            if aclose is not None:
                await aclose()


async def follow(
    job: StreamJob, from_index: int, heartbeat_seconds: float
) -> AsyncIterator[dict[str, Any] | None]:
    """Yield the job's events from `from_index` onward, then the live tail until
    it finishes. Yields None when nothing arrived within `heartbeat_seconds` so
    the caller can emit an SSE comment and keep the client leg alive (the
    Cloudflare ~100s idle cut).

    A terminal event ({"done"} / {"error"}) is included in `events`, so a
    follower that reaches the end of a finished job simply stops.
    """
    i = max(0, from_index)
    while True:
        while i < len(job.events):
            yield job.events[i]
            i += 1
        if job.done:
            return
        job._wake.clear()
        try:
            await asyncio.wait_for(job._wake.wait(), timeout=heartbeat_seconds)
        except asyncio.TimeoutError:
            yield None  # keep-alive tick
