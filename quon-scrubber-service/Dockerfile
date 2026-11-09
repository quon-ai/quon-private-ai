FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
# CPU-ONLY torch, installed first so gliner's dependency is already satisfied.
#
# PyPI's default torch wheel bundles the CUDA runtime: measured in this image,
# site-packages/nvidia was 2.7 GB of NVIDIA libraries on a box with no GPU. It is
# not just dead weight - extracting it can fill the disk of a small box and fail
# the build while the service is down for the rebuild. The CPU index ships the
# same torch without the CUDA payload.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch

# Installs deps AND the spaCy NER models (pinned wheels in requirements.txt), so
# the image ships ready for primary NER detection. To use different model sizes,
# change the wheels in requirements.txt and the SPACY_MODEL_* env vars below.
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status==200 else 1)"

# --workers 1, EXPLICITLY. The detection stack is loaded per PROCESS: spaCy and
# Presidio are ~680 MB, and GLiNER measured 3.1 GB peak RSS on the production box.
# A second worker means a second full copy - 2 workers would need ~7.6 GB on a
# 7.8 GB host, i.e. an OOM kill under load rather than a slowdown. One process was
# already the effective default; this makes it a decision instead of an accident.
# Concurrency does not suffer for it: GLiNER shows no thread scaling (measured
# 1579 ms vs 1506 ms for one thread vs two), so extra workers would not buy
# throughput on 2 vCPU either.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
