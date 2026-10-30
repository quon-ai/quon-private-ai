"""Resumable chat streams (stream_jobs.py).

The point of the module: generation must survive a client that goes away
(mobile backgrounding freezes the page and drops the SSE socket). These tests
pin exactly that — the pump keeps filling the buffer with no reader attached,
a follower replays from an offset, and jobs are user-scoped + TTL-bounded.

No pytest-asyncio in this project's dependencies, so the async parts run via
`asyncio.run` from plain sync tests rather than shipping a new dep to prod.
"""

from __future__ import annotations

import asyncio

import pytest

import stream_jobs


class FakeProviderError(Exception):
    pass


async def _agen(items, delay: float = 0.0):
    for it in items:
        if delay:
            await asyncio.sleep(delay)
        yield it


async def _drain(job, from_index: int = 0, heartbeat: float = 5.0):
    """Collect a follower's events (None entries are heartbeat ticks)."""
    out = []
    async for ev in stream_jobs.follow(job, from_index, heartbeat):
        out.append(ev)
    return out


@pytest.fixture(autouse=True)
def _clean_registry():
    stream_jobs.reset()
    yield
    stream_jobs.reset()


def test_pump_fills_the_buffer_with_no_reader_attached():
    """The whole point: nobody is following, the answer still completes."""
    job = stream_jobs.create("u1")
    asyncio.run(stream_jobs.pump(job, _agen(["Hallo", " Welt"]), FakeProviderError))
    assert job.done is True
    assert job.events == [{"delta": "Hallo"}, {"delta": " Welt"}, {"done": True}]


def test_dict_events_pass_through_unchanged():
    job = stream_jobs.create("u1")
    tool = {"tool_calls": [{"id": "c1", "name": "x", "arguments": "{}"}]}
    asyncio.run(stream_jobs.pump(job, _agen(["hi", tool, {"annotations": []}]), FakeProviderError))
    assert job.events[:3] == [{"delta": "hi"}, tool, {"annotations": []}]


def test_provider_error_is_buffered_and_replayed_not_lost():
    async def failing():
        yield "teil"
        raise FakeProviderError("budget exhausted")

    job = stream_jobs.create("u1")

    async def main():
        await stream_jobs.pump(job, failing(), FakeProviderError)
        # A late follower still sees the partial answer AND the honest error.
        return await _drain(job)

    replayed = asyncio.run(main())
    assert job.events == [{"delta": "teil"}, {"error": "budget exhausted"}]
    assert job.done is True
    assert replayed == [{"delta": "teil"}, {"error": "budget exhausted"}]


def test_unexpected_exception_still_finishes_the_job():
    """A follower must never hang because generation blew up unexpectedly."""

    async def boom():
        yield "a"
        raise ValueError("kaboom")

    job = stream_jobs.create("u1")
    asyncio.run(stream_jobs.pump(job, boom(), FakeProviderError))
    assert job.done is True
    assert "kaboom" in job.events[-1]["error"]


def test_resume_replays_only_the_missing_events():
    """The client applied 2 events before backgrounding → resume from index 2."""
    job = stream_jobs.create("u1")

    async def main():
        await stream_jobs.pump(job, _agen(["A", "B", "C"]), FakeProviderError)
        return await _drain(job, from_index=2)

    assert asyncio.run(main()) == [{"delta": "C"}, {"done": True}]
    # Concatenating what the client had with the replay reproduces the answer
    # exactly — the incremental `raw += delta` accumulation stays correct.
    first_leg = "".join(e["delta"] for e in job.events[:2])
    replay = "".join(e["delta"] for e in job.events[2:] if "delta" in e)
    assert first_leg + replay == "ABC"


def test_follower_rides_the_live_tail_of_a_running_job():
    job = stream_jobs.create("u1")

    async def main():
        task = asyncio.ensure_future(
            stream_jobs.pump(job, _agen(["x", "y", "z"], delay=0.01), FakeProviderError)
        )
        got = await asyncio.wait_for(_drain(job), timeout=5)
        await task
        return got

    assert asyncio.run(main()) == [
        {"delta": "x"},
        {"delta": "y"},
        {"delta": "z"},
        {"done": True},
    ]


def test_follow_emits_heartbeat_ticks_while_the_provider_is_silent():
    """None = "emit an SSE comment" — the Cloudflare idle-cut guard."""

    async def slow():
        await asyncio.sleep(0.15)
        yield "spät"

    job = stream_jobs.create("u1")

    async def main():
        task = asyncio.ensure_future(stream_jobs.pump(job, slow(), FakeProviderError))
        got = await asyncio.wait_for(_drain(job, heartbeat=0.02), timeout=5)
        await task
        return got

    got = asyncio.run(main())
    assert None in got  # at least one keep-alive tick before the token
    assert [e for e in got if e is not None] == [{"delta": "spät"}, {"done": True}]


def test_get_is_user_scoped_and_rejects_unknown_ids():
    job = stream_jobs.create("u1")
    assert stream_jobs.get(job.id, "u1") is job
    assert stream_jobs.get(job.id, "u2") is None  # another account: never
    assert stream_jobs.get("nope", "u1") is None


def test_expired_jobs_are_dropped():
    job = stream_jobs.create("u1")
    job.updated_at -= stream_jobs.JOB_TTL_SECONDS + 1
    assert stream_jobs.get(job.id, "u1") is None
    assert stream_jobs.count() == 0


def test_per_user_cap_evicts_the_oldest_but_never_another_user():
    keep_other = stream_jobs.create("u2")
    made = [stream_jobs.create("u1") for _ in range(stream_jobs.MAX_JOBS_PER_USER + 2)]
    mine = [j for j in made if stream_jobs.get(j.id, "u1") is not None]
    assert len(mine) <= stream_jobs.MAX_JOBS_PER_USER
    assert mine[-1] is made[-1]  # newest survives
    assert stream_jobs.get(keep_other.id, "u2") is keep_other


def test_job_ids_are_unguessable():
    ids = {stream_jobs.create(f"u{i}").id for i in range(20)}
    assert len(ids) == 20
    assert all(len(i) == 32 for i in ids)
