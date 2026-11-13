# syntax=docker/dockerfile:1
# The Thread API for deployment. Build from the repository root (it needs ../database too):
#
#   docker build -f backend/Dockerfile -t thread-api .
#
# The image model (~577 MiB) is built in, so starting never downloads it. By default it is
# fetched from its pinned Hugging Face revision and its SHA-256 checked. To reuse weights you
# already have (no download; still checked), pass them as a build context:
#
#   docker build -f backend/Dockerfile --build-context model-weights=.cache/models -t thread-api .
#
# Likewise, a PyTorch wheel you already downloaded and checked can be supplied with
# --build-context torch-wheel=<folder holding torch-2.14.1+cpu-...whl>; it must match the
# SHA-256 pinned below, or the build stops.

# Empty unless overridden with --build-context model-weights=<folder>.
FROM scratch AS model-weights
# Empty unless overridden with --build-context torch-wheel=<folder>.
FROM scratch AS torch-wheel

FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN useradd --create-home --uid 10001 thread
WORKDIR /app/backend

# PyTorch first, from its CPU-only index: the default Linux wheel bundles CUDA libraries
# (gigabytes this CPU-only service never uses). requirements.txt then finds it installed.
# pip checks every download against the index's published SHA-256; a supplied wheel is
# checked against the same hash here.
ARG TORCH_WHEEL=torch-2.14.1+cpu-cp311-cp311-manylinux_2_28_x86_64.whl
ARG TORCH_SHA256=5e38154c8896d426a5df58bf2276b603e82184dfae4f54d77dbb212f36e34f37
COPY --from=torch-wheel / /tmp/wheels/
COPY backend/requirements.txt ./requirements.txt
RUN set -e; \
    if [ -f "/tmp/wheels/$TORCH_WHEEL" ]; then \
      echo "$TORCH_SHA256  /tmp/wheels/$TORCH_WHEEL" | sha256sum -c -; \
      torch="/tmp/wheels/$TORCH_WHEEL"; \
    else \
      torch="torch==2.14.1"; \
    fi; \
    pip install --index-url https://download.pytorch.org/whl/cpu "$torch" torchvision==0.29.1; \
    pip install -r requirements.txt; \
    rm -rf /tmp/wheels

COPY backend/ /app/backend/
COPY database/migrations/ /app/database/migrations/

# Verifies the weights' SHA-256, downloading them only if they aren't already here. Settings
# need a database URL to load; this placeholder is never connected to.
COPY --from=model-weights / /app/.cache/models/
RUN THREAD_DATABASE_URL=postgresql+psycopg://build-only/none python -m scripts.fetch_model \
 && mkdir -p /data/storage \
 && chown -R thread:thread /app/.cache /data

USER thread

# Uploaded images live on a volume mounted at /data. THREAD_DATABASE_URL and the account
# settings come from the host (see DEPLOY.md); nothing secret is baked into the image.
ENV THREAD_STORAGE_DIR=/data/storage \
    THREAD_MODEL_CACHE_DIR=/app/.cache/models \
    PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/health', timeout=4)"

# Migrations run as a separate pre-deploy step (alembic upgrade head), not on every start.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
