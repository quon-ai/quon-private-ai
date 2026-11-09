"""Ingest a folder of real DOCUMENTS into the private real-world eval set.

    python tests/realworld_docs_ingest.py ~/Downloads/Test_Documents
    QUON_RUN_REALWORLD_DOCS=1 pytest tests/test_realworld_docs.py -q -s

Why documents and not just prompts: ``test_realworld.py`` covers the user's chat
prompts, which are casual-register and short. Real paperwork is the opposite - 
long, formal, German, and dense with identifier FORMATS that no synthetic
generator invents (policy numbers, Steuernummern, Aktenzeichen, meter readings).
Running the net over 45 such files immediately surfaced that the dotted German
date, the most common shape in the whole set at 126 occurrences, was excluded
from PHONE but never detected.

Output: ``~/.quon/realworld/documents.jsonl`` - one ``{"text", "source",
"chars", "ocr"}`` record per file. Real data: it lives outside the repo (the repo
is published by scripts/export-public.sh) and is never printed to stdout.

Scanned PDFs have no text layer and would otherwise be silently skipped - which
loses exactly the register that matters, because OCR mangles the characters
identifiers are made of (0/O, 1/l, 8/B). They are OCR'd ON-DEVICE via macOS
Vision when PyObjC is present; elsewhere they are recorded as skipped rather
than silently dropped, so the count never lies about coverage.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

MIN_TEXT = 50  # below this a PDF is treated as scanned, not as a short document


def default_out_dir() -> Path:
    return Path(os.environ.get("QUON_REALWORLD_DIR", "~/.quon/realworld")).expanduser()


def _pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    try:
        reader = PdfReader(str(path))
        return "\n".join((p.extract_text() or "") for p in reader.pages[:60])
    except Exception:
        return ""


def _docx_text(path: Path) -> str:
    """textutil ships with macOS; no dependency, no network."""
    try:
        out = subprocess.run(
            ["textutil", "-convert", "txt", "-stdout", str(path)],
            capture_output=True, text=True, timeout=120,
        )
        return out.stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _ocr_pdf(path: Path, max_pages: int = 12) -> str:
    """On-device OCR via macOS Vision. Returns "" when unavailable - the caller
    records that as a skip, so a machine without Vision reports honest coverage
    instead of pretending the file was empty."""
    try:
        import Quartz  # noqa: F401  (PyObjC)
        import Vision
        from Foundation import NSURL
    except ImportError:
        return ""
    if not shutil_which("pdftoppm"):
        return ""

    def _one(img: Path) -> str:
        src = Quartz.CGImageSourceCreateWithURL(NSURL.fileURLWithPath_(str(img)), None)
        if src is None:
            return ""
        cg = Quartz.CGImageSourceCreateImageAtIndex(src, 0, None)
        if cg is None:
            return ""
        req = Vision.VNRecognizeTextRequest.alloc().init()
        req.setRecognitionLevel_(1)  # accurate
        req.setUsesLanguageCorrection_(True)
        req.setRecognitionLanguages_(["de-DE", "en-US"])
        handler = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg, None)
        ok, _ = handler.performRequests_error_([req], None)
        if not ok:
            return ""
        lines = []
        for obs in (req.results() or []):
            cands = obs.topCandidates_(1)
            if cands and len(cands):
                lines.append(cands[0].string())
        return "\n".join(lines)

    with tempfile.TemporaryDirectory() as td:
        subprocess.run(
            ["pdftoppm", "-r", "200", "-png", "-l", str(max_pages), str(path),
             os.path.join(td, "p")],
            capture_output=True, timeout=900, check=False,
        )
        pages = sorted(f for f in os.listdir(td) if f.endswith(".png"))
        return "\n".join(_one(Path(td) / p) for p in pages)


def shutil_which(cmd: str) -> str | None:
    from shutil import which

    return which(cmd)


def extract(path: Path) -> tuple[str, bool]:
    """Return ``(text, used_ocr)``."""
    suffix = path.suffix.lower()
    if suffix in (".txt", ".md", ".csv"):
        # Plain text was silently skipped in the first version, which is the worst
        # kind of gap in an ingest: the count said "37/40" and nothing said why one
        # of the three was trivially readable.
        try:
            return path.read_text(encoding="utf-8", errors="replace"), False
        except OSError:
            return "", False
    if suffix == ".docx":
        return _docx_text(path), False
    if suffix != ".pdf":
        return "", False
    text = _pdf_text(path)
    if len(text.strip()) >= MIN_TEXT:
        return text, False
    return _ocr_pdf(path), True


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    src = Path(argv[0]).expanduser()
    if not src.is_dir():
        print(f"not a directory: {src}", file=sys.stderr)
        return 1

    out_dir = default_out_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "documents.jsonl"

    files = sorted(p for p in src.iterdir() if p.is_file() and not p.name.startswith("."))
    records, ocr_used, skipped = [], 0, []
    for f in files:
        text, used_ocr = extract(f)
        if len(text.strip()) < MIN_TEXT:
            skipped.append(f.name)
            continue
        ocr_used += int(used_ocr)
        records.append({"text": text, "source": f.name, "chars": len(text), "ocr": used_ocr})

    with out.open("w", encoding="utf-8") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    # Counts only - never a filename's content, never a detected value.
    print(f"ingested {len(records)}/{len(files)} files -> {out}")
    print(f"  via OCR: {ocr_used}")
    print(f"  chars:   {sum(r['chars'] for r in records):,}")
    if skipped:
        print(f"  SKIPPED (no extractable text, {len(skipped)}): {', '.join(skipped[:6])}"
              f"{' …' if len(skipped) > 6 else ''}")
        print("  → install pyobjc-framework-Vision + poppler (pdftoppm) to OCR these")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
