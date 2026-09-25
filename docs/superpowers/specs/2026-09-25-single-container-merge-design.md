# Single-container merge: design

Date: 2026-09-25
Status: approved, ready for implementation planning

## Goal

Collapse `backend` + `worker` from two containers (talking over an
internal-only Docker network) into one FastAPI process in one container,
for a self-hoster who wants a single-operator, trusted-network deployment
with less to build/run/reason about — without losing the subprocess-level
sandboxing that keeps a malicious CV YAML from doing anything beyond
rendering it.

## Context

Today: `frontend` (React, built into static files), `backend` (FastAPI,
the only externally-reachable service, relays render requests over HTTP),
`worker` (FastAPI, not reachable from outside the compose stack, runs
`rendercv` as a subprocess per render). See `AGENTS.md` for the full
rationale as it stood before this change.

The worker's real security value has always been two independent layers:

1. **Subprocess-level sandboxing** inside `worker/worker_app/executor.py`:
   fresh temp dir per render, `RLIMIT_CPU`/`RLIMIT_NOFILE`, a wall-clock
   timeout, `os.setsid()` + `killpg` on timeout, a concurrency cap. This is
   independent of container topology and is unaffected by this change.
2. **Network segmentation**: the worker container sits on a Docker network
   declared `internal: true`, so it has no route to the internet at all,
   with or without a successful exploit inside it. This *is* a
   container-topology property and is what this change gives up.

Backend already runs an in-process ASGI test seam
(`worker_transport_override`, `httpx.ASGITransport`) to call the worker
app without a real network hop in tests, and both Python test suites
already run from one shared virtualenv today — confirming a merge is a
natural fit for the existing code, not a re-architecture.

## Decisions made during design

- **Scope: full replacement**, not a side-by-side prototype. `worker/` and
  `shared/` are deleted; docs and CI are updated in the same pass.
- **Security tradeoff accepted**: the merged container's render code no
  longer has a hard network boundary from the rest of the app. This is
  acceptable for the stated threat model (single-operator, trusted-network
  or behind an auth reverse proxy) and is called out explicitly in
  `README.md` and `AGENTS.md`.
- **Container hardening is kept and applied to the whole merged
  container**: `read_only` root fs + `tmpfs /tmp`, `cap_drop: [ALL]`,
  `no-new-privileges`, `pids_limit`. This costs nothing functionally
  (backend never wrote outside `/tmp` and its in-memory session cache
  anyway) and stays as the outermost defense layer now that network
  segmentation is gone.
- **`shared/rendercv_web_schemas` is folded into `backend_app`.** It only
  ever existed to define a wire contract between two processes; with one
  process there's nothing left for a separate installable package to do.
- **Compose collapses to one file** (`docker-compose.yml`) with both
  `build:` and `image:` set on the single service, instead of maintaining
  parallel `docker-compose.yml` (build) / `docker-compose.prod.yml`
  (pull) files.
- **Directory name stays `backend/`** (not renamed to e.g. `app/`) — it
  remains the counterpart to `frontend/`, still literally the backend of
  the browser UI.

## Target architecture

One FastAPI process (`backend_app`), one container, one image. It:

- Serves the built frontend as static files (`backend_app/static`).
- Exposes `POST /render` (SSE-streamed), `GET /version`, `GET /config`,
  optional `POST`/`DELETE /image` — all unchanged from today's backend
  API surface.
- On `/render`, calls `executor.run_render(...)` directly — an
  `async for` loop over the same `LogLine` / `RenderSuccess` /
  `RenderFailure` events the worker's HTTP handler used to translate into
  SSE — instead of relaying an HTTP request to a separate worker process.
- Holds `_MAX_CONCURRENT_RENDERS` / `asyncio.Semaphore(2)` at module scope
  in the merged app (moved from `worker_app/main.py`, unchanged in
  value/rationale).
- `GET /version` reads `importlib.metadata.version("rendercv")` directly
  instead of making an HTTP call to a worker's `/version`.
- Session image cache, `/image` routes, CSP/security headers, static
  mount: unchanged.

## Directory layout

```
backend/
  Dockerfile
  requirements.txt         # gains rendercv[full]==2.8, drops httpx (runtime)
  requirements-dev.txt      # adds httpx directly (ASGITransport tests still need it; no longer transitive via requirements.txt)
  backend_app/
    __init__.py
    main.py                 # drops httpx relay + worker_url version fetch
    config.py                # drops worker_url
    render_routes.py         # calls executor.run_render() directly
    image_routes.py          # unchanged
    session_cache.py         # unchanged
    executor.py               # moved verbatim from worker/worker_app/executor.py
    models.py                  # moved from shared/rendercv_web_schemas/models.py
    sse.py                       # moved from shared/rendercv_web_schemas/sse.py
  tests/
    conftest.py               # gains worker/tests/conftest.py's PATH fix
    fixtures/                  # moved from worker/tests/fixtures/
    test_main.py
    test_render_routes.py       # worker-mocking replaced by run_render monkeypatching
    test_image_routes.py
    test_executor.py             # moved from worker/tests/test_executor.py
    test_models.py                # moved from shared/tests/test_models.py
    test_sse.py                    # moved from shared/tests/test_sse.py

worker/    # deleted
shared/    # deleted
```

## Code changes

- `render_routes.py`: delete `worker_transport_override`, the `httpx`
  import, and the `relay()`/`StreamingResponse` HTTP-client logic. Replace
  with an `event_stream()` that calls `run_render(yaml_content, image=...,
  timeout_seconds=...)` under the module-level semaphore (same pattern
  `worker_app/main.py` used), translating `LogLine`/`RenderSuccess`/
  `RenderFailure` into `format_sse_event(...)` calls — this logic moves
  essentially unchanged from `worker_app/main.py`'s `render()` handler,
  just inlined into `backend_app`.
- `main.py`: `GET /version` becomes a synchronous
  `importlib.metadata.version("rendercv")` lookup (still cached in
  `_version_cache`), no `httpx.AsyncClient` involved.
- `config.py`: drop `worker_url`. Keep
  `image_upload_enabled`, `render_timeout_seconds`, `max_yaml_bytes`,
  `session_ttl_seconds`, `max_sessions`.
- `executor.py`, `models.py`, `sse.py`: moved with import paths updated
  (`worker_app.executor` → `backend_app.executor`,
  `rendercv_web_schemas.models`/`.sse` → `backend_app.models`/`.sse`), no
  logic changes.

## Dockerfile

Single `backend/Dockerfile`, frontend-build stage unchanged, runtime stage
merges both of today's Dockerfiles:

- `pip install -r backend/requirements.txt` (now includes
  `rendercv[full]==2.8`).
- One non-root user `app` (uid 999), `HOME=/home/app`.
- Typst package-cache pre-warm step (unchanged logic, path becomes
  `/home/app/.cache/typst/packages`) — still required so the read-only,
  network-segmented-by-hardening-not-topology container never needs to
  reach the internet at render time.
- `CMD ["uvicorn", "backend_app.main:app", "--host", "0.0.0.0", "--port", "8000"]`.

## docker-compose.yml

Single file, single service, `build:` and `image:` both set so both
existing workflows keep working:

```yaml
services:
  backend:
    image: ghcr.io/jfmilke/rendercv-web:${RENDERCV_WEB_VERSION:-latest}
    build:
      context: .
      dockerfile: backend/Dockerfile
    ports:
      - "8000:8000"
    environment:
      IMAGE_UPLOAD_ENABLED: ${IMAGE_UPLOAD_ENABLED:-false}
      RENDER_TIMEOUT_SECONDS: ${RENDER_TIMEOUT_SECONDS:-30}
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777,noexec,nosuid
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    pids_limit: 150
    mem_limit: 1536m
    cpus: 1.5
    restart: unless-stopped
```

- Build from source: `docker compose up --build`.
- Run the published release: `docker compose pull && docker compose up`.
- `docker-compose.prod.yml` is deleted.
- Resource limits sized up from worker's solo limits (512m/1.0/100) to
  cover backend + rendering in one box; still a container-level safety
  net layered on top of, not instead of, the per-subprocess `rlimit`s in
  `executor.py`.

## CI

`.github/workflows/release-images.yml`: one `docker/build-push-action`
step, `file: backend/Dockerfile`, tags
`ghcr.io/jfmilke/rendercv-web:<version>` and `:latest` (replacing the
current `-backend`/`-worker` pair).

`.github/workflows/tests.yml`: `pip install -e shared -r
worker/requirements-dev.txt -r backend/requirements-dev.txt` becomes
`pip install -r backend/requirements-dev.txt`.

## Tests

- `worker/tests/test_executor.py` → `backend/tests/test_executor.py`,
  import path updated, logic unchanged (already tests `run_render`
  directly).
- `worker/tests/conftest.py`'s `PATH` fix for resolving the real
  `rendercv` executable moves to `backend/tests/conftest.py` — it now
  applies to the render-route tests too, since they exercise the real
  subprocess directly rather than through a second ASGI app.
- `worker/tests/fixtures/*.yaml` → `backend/tests/fixtures/`.
- `worker/tests/test_main.py`'s cases (version passthrough, SSE
  success/error streaming, exception-safety, timeout propagation,
  concurrency cap) fold into `backend/tests/test_render_routes.py` /
  `test_main.py`: `monkeypatch.setattr` targets `render_routes.run_render`
  directly; the `worker_transport_override` / `ASGITransport(app=
  worker_app)` / `failing_worker` plumbing in `test_render_routes.py` and
  `test_main.py` is deleted.
- `shared/tests/test_models.py`, `shared/tests/test_sse.py` →
  `backend/tests/`, imports updated to `backend_app.models` /
  `backend_app.sse`.
- `pytest.ini`: `testpaths = backend/tests`, `pythonpath = backend`.

## Docs

- `README.md`: "How it works" describes two components (frontend,
  backend — the latter running `rendercv` directly through a sandboxed
  subprocess) instead of three. Quick Start becomes the `--build` /
  `pull` pair above. Configuration table drops `WORKER_URL`. Security
  section keeps the reverse-proxy guidance, adds that container hardening
  (read-only rootfs, dropped capabilities) plus the per-render subprocess
  limits are now the layers standing in for the old network segmentation.
- `AGENTS.md`: "Services" becomes one entry for `backend/`. "Security
  model" drops the internal-network bullet, keeps the subprocess
  sandboxing / rendercv-pinning / Typst-prewarm bullets (paths updated to
  `/home/app/...`), adds an explicit statement that hardening is now the
  outermost defense layer instead of network topology.

## Out of scope

- Authentication/access control (unchanged — still the operator's job via
  reverse proxy).
- Changing the subprocess sandboxing itself (`executor.py`'s rlimits,
  timeout, temp-dir handling) — carried over as-is.
- Any frontend changes — the API surface it talks to is unchanged.
