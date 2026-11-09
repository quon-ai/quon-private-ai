"""GLiNER as a third detector, beside spaCy NER and the deterministic net.

Why a span-scoring encoder rather than another generative model:

- It does not generate. Spans come back as data, so the whole failure class this
  project spent a week on - malformed JSON, a model that answers in prose, output
  tokens dominating latency, dense pages blowing a timeout - cannot occur.
- Latency scales with TEXT LENGTH only, never with how many entities a page
  contains. That is the property the cloud path did not have.
- It runs in-process on CPU: nothing to be unreachable, no endpoint, no timeout,
  no reclaimed spot instance.
- Above all it GENERALISES over meaning rather than membership. A gazetteer is a
  list, so every new product name is a new patch forever; an encoder that scores
  "Kafka" against `software` versus `person` gets Redis and Django for free.

Deliberately complementary to the regex net rather than a replacement. GLiNER
reads PIN and password confidently (the net's two biggest floor leaks) and walks
past structured identifiers like "Versicherungsnummer VN-2024-88421", which the
morpheme rule already owns. Each covers what the other misses; neither is asked
to do the other's job.

LABELS are the INTERFACE, and the main overfitting hazard. They are written as
ordinary, generic descriptions - the kind of words anyone would use for the
concept - not tuned per document type. A label chosen to make one corpus score
well is the same mistake as a fitted word list, one level up.

Off by default (`gliner_enabled`); the model is lazy-loaded on first use so
importing this module stays cheap and a deployment without the dependency is
unaffected.
"""

from __future__ import annotations

import logging
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import fallback
from config import settings

logger = logging.getLogger("quon.gliner")

# GLiNER label -> QUON entity type. Generic wording on purpose: these are the
# words a person would use for the concept, not phrasings reverse-engineered
# from a test set.
LABEL_MAP: dict[str, str] = {
    "person": "PERSON",
    "address": "ADDRESS",
    "phone number": "PHONE",
    "email address": "EMAIL",
    "iban": "IBAN",
    "credit card number": "CREDIT_CARD",
    "date of birth": "DATE",
    "password": "CREDENTIAL",
    "pin": "PIN",
    "identification number": "OTHER",
    "insurance number": "INSURANCE_ID",
    "tax number": "TAX_ID",
    # ROUTING and the non-password credential shapes were DECLARED types
    # (entities.py ships a [ROUTING-NR] placeholder) that this detector was
    # never asked about - so it could not possibly have found them. That is a
    # wiring gap, not a tuning knob: the label set must cover the product's own
    # taxonomy. Measured on the corpus templates, naming the type is worth far
    # more than moving the threshold - "routing number" scores 1.00 where the
    # unnamed type scored 0.62 and was mislabelled as a phone number.
    "routing number": "ROUTING",
    "bank code": "ROUTING",
    "api key": "CREDENTIAL",
    "access token": "CREDENTIAL",
}

# Scored but never emitted: these exist so the model can put a competing,
# BETTER-FITTING label on something the other detectors would otherwise call a
# person. That is the veto signal - see gliner_verdict().
CONTRAST_LABELS: tuple[str, ...] = ("company", "software", "product", "job title", "place")

#: The subset that may actually VETO a PERSON. "place" is scored but never vetoes:
#: QUON redacts addresses regardless of owner, so a person/place confusion must
#: resolve by REDACTING, not by clearing. Vetoing on it leaked "Rehbergplatz" - a
#: street name - straight through, which the titled-name test caught.
VETO_LABELS: frozenset[str] = frozenset({"company", "software", "product", "job title"})

_ALL_LABELS = list(LABEL_MAP) + list(CONTRAST_LABELS)

_model: Any = None
_lock = threading.Lock()


def _get_model() -> Any:
    """Lazy, thread-safe load of the model, or a FALSY sentinel when unavailable.

    A missing dependency degrades to "this detector contributes nothing" rather
    than breaking the scrub - same fail-soft shape as the LLM tier.

    Returns the model, or ``False`` once a load has failed (cached, so a broken
    install is not retried on every request). Callers must test truthiness, not
    ``is None``: an ``is None`` check reads a failed load as a working model -
    a test guard that never skips, a health probe that reports a broken
    detector as loaded.
    """
    global _model
    if _model is not None:
        return _model
    with _lock:
        if _model is not None:
            return _model
        try:
            from gliner import GLiNER

            # One intra-op thread per chunk by default. GLiNER does not
            # thread-scale within a chunk (1579ms on one thread vs 1506ms on two),
            # so the cores are far better spent on CONCURRENT chunks - and without
            # this, N workers x M torch threads oversubscribe a 2-vCPU box and
            # both get slower. Set gliner_torch_threads=0 to leave torch alone.
            if settings.gliner_torch_threads > 0:
                try:
                    import torch

                    torch.set_num_threads(settings.gliner_torch_threads)
                except Exception:  # noqa: BLE001 - never break the load over this
                    logger.debug("could not pin torch threads", exc_info=True)

            kwargs = {"quantize": settings.gliner_quantize} if settings.gliner_quantize else {}
            _model = GLiNER.from_pretrained(settings.gliner_model, **kwargs)
            logger.info(
                "gliner model loaded: %s (quantize=%s)",
                settings.gliner_model,
                settings.gliner_quantize or "off",
            )
        except Exception as exc:  # noqa: BLE001 - never break the scrub
            logger.warning("gliner unavailable (%s) — detector contributes nothing", exc)
            _model = False
    return _model


# Occurrence cap for the cross-check below - same rationale as scrubber's
# _MAX_OCCURRENCES: past a handful of windows the verdict does not change.
_CROSSCHECK_MAX_WINDOWS = 4


def person_score(value: str, text: str, context_chars: int = 120) -> float | None:
    """Best GLiNER person score for ``value`` in its own context, or None.

    The verifier's question, not the detector's: "given ±context_chars around
    an occurrence, does the model see a person AT all?" - asked at threshold
    0.05, far below the 0.65 detection bar, because the caller is looking for
    any corroboration rather than an independent detection.

    Returns None when the model is unavailable or anything throws: None means
    "no verdict", and the caller must treat it as keep. A verifier that can
    drop detections has to fail open, so the unavailable case must be
    distinguishable from "scored 0.0" - which is a real verdict and a real no.

    Checks up to _CROSSCHECK_MAX_WINDOWS occurrences and keeps the best score:
    a value redacted everywhere it appears needs only one occurrence that
    genuinely looks like a name (mirrors the majority-vote reasoning - the
    cross-check is corroboration, and corroboration anywhere is corroboration).
    """
    model = _get_model()
    if not model:
        return None
    try:
        return _window_scores(model, value, text, context_chars)[0]
    except Exception:  # noqa: BLE001 - no verdict, never a crash
        return None


def _window_scores(model, value: str, text: str, context_chars: int) -> tuple[float, list[float]]:
    """(best score, per-window best scores) over up to _CROSSCHECK_MAX_WINDOWS."""
    scores: list[float] = []
    at = text.find(value)
    while at >= 0 and len(scores) < _CROSSCHECK_MAX_WINDOWS:
        window = text[max(0, at - context_chars): at + len(value) + context_chars]
        w = 0.0
        for e in model.predict_entities(window, ["person"], threshold=0.05):
            ev = e.get("text", "").lower()
            if value.lower() in ev or ev in value.lower():
                w = max(w, float(e.get("score", 0.0)))
        scores.append(w)
        at = text.find(value, at + 1)
    return (max(scores) if scores else 0.0, scores)


def person_crosscheck_keep(
    value: str, text: str, floor: float, majority: bool = True
) -> bool | None:
    """The cross-check verdict. None = no verdict (caller must keep).

    ``majority=False`` is the trial's original rule: keep if any sampled window
    corroborates. That is fail-open per occurrence, and for high-frequency
    generic nouns it repeats the "applicant x372" failure one layer up:
    measured on this project's own ARCHITECTURE.md, "user" occurs dozens of
    times and one window of the four sampled was enough to keep it everywhere.

    ``majority=True`` keeps only when more than HALF of the sampled windows
    corroborate. A single-occurrence value is unchanged (1 of 1 is a
    majority), so rare values - which is what real names are - keep the
    original fail-open behaviour; only values frequent enough to be sampled
    several times face the vote, and frequency is itself evidence of a
    common noun."""
    model = _get_model()
    if not model:
        return None
    try:
        _best, scores = _window_scores(model, value, text, 120)
        if not scores:
            return None
        hits = sum(1 for w in scores if w >= floor)
        if majority:
            return hits * 2 > len(scores)
        return hits > 0
    except Exception:  # noqa: BLE001
        return None


def _worker_count(n_chunks: int) -> int:
    """Concurrency for chunk scoring - never more workers than chunks."""
    if n_chunks <= 1:
        return 1
    configured = settings.gliner_max_workers
    if configured <= 0:
        configured = os.cpu_count() or 1
    return max(1, min(configured, n_chunks))


def _chunks(text: str, size: int) -> list[tuple[int, str]]:
    """Fixed windows with their offsets. GLiNER has a token limit, and unlike the
    LLM path the cost here is linear in length, so plain windows are enough."""
    return [(i, text[i : i + size]) for i in range(0, len(text), size)] or [(0, "")]


# GLiNER includes the honorific in a PERSON span ("Herr Sandberg"). The title is
# not PII, and swallowing it costs readability for nothing - the same vocabulary
# the regex net already uses is reused here so the two cannot drift apart.
_LEADING_TITLE_RE = re.compile(rf"^(?:{fallback.TITLE_PATTERN}\s+)+")


def _strip_leading_title(value: str) -> str:
    """"Herr Sandberg" -> "Sandberg"; a bare title alone -> "" (dropped)."""
    return _LEADING_TITLE_RE.sub("", value).strip()


def warm() -> bool:
    """Load the model now, off the request path. Returns True if it is usable.

    Cold load measured 24.2s on the production box. Without this the first real
    user after every deploy or restart pays it - an unlucky person waits half a
    minute and concludes the product is broken. Called from the app's startup
    hook in a background task, so readiness is not delayed either.
    """
    return bool(_get_model())


def is_loaded() -> bool:
    """Is a usable model loaded? Deliberately does not trigger a load.

    /health is polled; calling _get_model() here would make the first probe pay
    the ~24s cold start (and, on a small box, do it while serving traffic).

    bool(), not "is not None": a failed load is cached as the sentinel ``False``
    (see _get_model), so "is not None" reports a broken detector as loaded - on
    a box where the dependency is missing, /health would have claimed
    gliner_loaded: true forever. Exactly the silent degradation this endpoint
    exists to surface.
    """
    return bool(_model)


def detect_gliner_with_spans(text: str) -> tuple[list[dict], list[dict]]:
    """``(detections, raw_spans)`` - the mapped output AND every scored span.

    The raw spans exist so the VETO can reuse this single pass. Calling
    gliner_verdict() over the whole text once per PERSON candidate turns the
    veto into O(persons) full forward passes. Measured on the production box:
    1.90s -> 8.41s at 1000 chars and 8.23s -> 23.46s at 4000, for identical
    detections. The model has already scored every span against every label by
    the time detect runs; asking it again is pure waste.
    """
    raw: list[dict] = []
    dets = _detect(text, raw)
    return dets, raw


def detect_gliner(text: str) -> list[dict]:
    """Return ``{type, value, score}`` dicts, or [] when the model is unavailable."""
    return _detect(text, None)


def _detect(text: str, raw_out: list[dict] | None) -> list[dict]:
    model = _get_model()
    if not model or not text.strip():
        return []
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    try:
        chunks = [c for _o, c in _chunks(text, settings.gliner_chunk_chars) if c.strip()]
        # Score chunks CONCURRENTLY - they are independent, so this is wall clock
        # only and cannot change the result. Order is preserved so the output stays
        # deterministic (executor.map yields in submission order), which matters:
        # `seen` dedupes by first occurrence and the ratchet compares exact output.
        workers = _worker_count(len(chunks))
        if workers > 1:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                scored = list(
                    pool.map(
                        lambda ch: model.predict_entities(
                            ch, _ALL_LABELS, threshold=settings.gliner_threshold
                        ),
                        chunks,
                    )
                )
        else:
            scored = [
                model.predict_entities(ch, _ALL_LABELS, threshold=settings.gliner_threshold)
                for ch in chunks
            ]
        for ents in scored:
            for ent in ents:
                if raw_out is not None:
                    raw_out.append(
                        {"label": ent["label"], "text": ent["text"], "score": float(ent["score"])}
                    )
                quon_type = LABEL_MAP.get(ent["label"])
                if quon_type is None:  # a contrast label - never emitted
                    continue
                value = ent["text"].strip()
                if quon_type == "PERSON":
                    value = _strip_leading_title(value)
                if not value:
                    continue
                key = (quon_type, value.lower())
                if key in seen:
                    continue
                seen.add(key)
                out.append({"type": quon_type, "value": value, "score": float(ent["score"])})
    except Exception as exc:  # noqa: BLE001
        logger.warning("gliner detection failed (%s) — keeping other detectors", exc)
        return []
    return out


def verdict_from_spans(spans: list[dict], candidate: str) -> tuple[str | None, float, float]:
    """Same answer as gliner_verdict, from spans already scored - no model call.

    Note the threshold difference this inherits: detect runs at
    settings.gliner_threshold while gliner_verdict uses 0.3, so a weak competing
    label that gliner_verdict would see is not in these spans. That is the
    right trade - a veto acts on a label that BEAT "person", and the caller
    additionally requires a margin, so labels near the floor never vetoed anyway.
    """
    cand = candidate.strip().lower()
    best, best_score, person_score = None, 0.0, 0.0
    for e in spans:
        v = e["text"].strip().lower()
        if v == cand or cand in v or v in cand:
            if e["score"] > best_score:
                best, best_score = e["label"], e["score"]
            if e["label"] == "person" and e["score"] > person_score:
                person_score = e["score"]
    return best, best_score, best_score - person_score


def gliner_verdict(text: str, candidate: str) -> tuple[str | None, float, float]:
    """``(label, score, margin_over_person)``, or ``(None, 0.0, 0.0)``.

    The veto question the LLM was never actually asked: is this span a person, or
    is it a company/software/place? Returns the winning label so the caller can
    decide - a judgement, not an action.

    The second element is the margin over the person label, not the raw score,
    because the raw score cannot separate the two classes. Measured:

        Nokia / Apple / Arvato Bertelsmann   company 1.00, person 0.00  -> +1.00
        Kafka                                software 0.83, person 0.00 -> +0.83
        "Mercedes Jacobi Jäckel"             company 0.95, person 0.93  -> +0.03

    An absolute bar of 0.95 vetoes that last one and LEAKS a real person's name - 
    Mercedes is an ordinary given name. The margin says what actually matters: for
    a genuine brand GLiNER sees no person in the span at all.
    """
    model = _get_model()
    if not model or not candidate.strip():
        return None, 0.0, 0.0
    try:
        ents = model.predict_entities(text, _ALL_LABELS, threshold=0.3)
    except Exception:  # noqa: BLE001
        return None, 0.0, 0.0
    cand = candidate.strip().lower()
    best, best_score, person_score = None, 0.0, 0.0
    for e in ents:
        v = e["text"].strip().lower()
        if v == cand or cand in v or v in cand:
            if e["score"] > best_score:
                best, best_score = e["label"], e["score"]
            if e["label"] == "person" and e["score"] > person_score:
                person_score = e["score"]
    return best, best_score, best_score - person_score
