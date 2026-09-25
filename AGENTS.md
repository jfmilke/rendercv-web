# RenderCV Web — Architecture & Conventions

A self-hosted web GUI for [rendercv](https://github.com/rendercv/rendercv): edit a CV as YAML in the browser, render it to PDF, preview and download the result.

## Services

One service, one docker-compose stack:

- **`backend`** (`backend/`, FastAPI) — serves the built frontend as static files, exposes `POST /render` (SSE-streamed), `GET /version`, `GET /config`, and the optional `POST`/`DELETE /image`. Runs `rendercv` as a subprocess per render, in a fresh per-request temp directory, with a wall-clock timeout, OS-level `rlimit`s (CPU time, open files — deliberately *not* memory via `RLIMIT_AS`, since Typst's Rust binary reserves large virtual address ranges that make that limit fire spuriously), and a concurrency cap (`asyncio.Semaphore`) since `RLIMIT_NPROC` is a per-UID limit shared across the whole container, not per-subprocess. No database, no persisted files beyond an in-memory, TTL-bounded session→image cache.
- **`frontend`** (`frontend/`, React + Vite + TypeScript + Tailwind v4) — Monaco editor with rendercv's real JSON Schema vendored in (`frontend/src/schema/rendercv-schema.json`, pinned to the same rendercv version the backend runs — re-`curl` it when that version bumps), pdf.js preview, upload/download of YAML and PDF client-side.

## Security model — why it's shaped this way

- **No built-in authentication.** Access control is the operator's job via an external reverse proxy (Caddy `basic_auth`, Authelia, VPN, etc.). This app should never be exposed directly to an untrusted network.
- **The code that processes untrusted input** (arbitrary YAML through rendercv/typst, and image bytes when upload is enabled) runs in the same container as the API, so isolation is per-subprocess rather than per-container: each render gets its own temp directory, `rlimit`s (CPU time, open files), a wall-clock timeout, and `os.setsid()` + `killpg` on timeout (`backend/backend_app/executor.py`). The container itself is `read_only` with a `tmpfs` `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, and `pids_limit`/`mem_limit`/`cpus` caps in `docker-compose.yml` — this used to apply only to a network-isolated `worker` container; it's now the outermost defense layer for the whole process, since there is no longer a hard network boundary between the code that renders untrusted YAML and the internet-facing API. Deploying this behind an access-controlled reverse proxy (see above) is what keeps that boundary's absence acceptable.
- **Image upload is opt-in** (`IMAGE_UPLOAD_ENABLED`, default off) and, when enabled, is a *deliberate* exception to the above: uploads are uncapped in size at the application layer (bounded in practice by the container's 64 MB `tmpfs` `/tmp`, shared with render scratch space) and validated only by magic-byte sniffing (jpg/jpeg/png/webp) plus filename sanitization (no deep decode/re-encode, no dimension caps). This was an explicit scope decision for a feature primarily meant for personal, off-network use — enabling it on a publicly reachable deployment means accepting that reduced hardening.
- **rendercv is pinned** (`rendercv[full]==<version>` in `backend/requirements.txt`) and installed via `pip` into our own image — not derived from the upstream `ghcr.io/rendercv/rendercv` image, which is built for one-shot CLI invocation, not a long-running service. Bump deliberately, not via a floating tag.
- **Typst's package cache is pre-warmed at Docker build time** (`backend/Dockerfile`): rendercv's bundled templates import a third-party Typst package (`@preview/fontawesome`) that Typst otherwise tries to download over the network on first use — which would fail at runtime since the container has no reason to reach the network at render time. If you bump the rendercv pin, re-check this still covers whatever Typst packages the new version's templates import (grep the installed `rendercv` package for `@preview/` imports), or renders will start failing with a network error.

## Dev commands

Python (backend), from the repo root with the venv active (`.venv/bin/<tool>` if you haven't sourced it):
```bash
pip install -r backend/requirements-dev.txt
pytest -v
```

Frontend, from `frontend/`:
```bash
npm install
npm test
npm run build
```

Full stack:
```bash
cp .env.example .env
docker compose up --build
```

## Monaco/monaco-yaml version note

`frontend/src/lib/monacoSetup.ts` pins `monaco-editor` to `0.52.2`, older than what's in a fresh install — `monaco-yaml` depends on a worker-creation API that `monaco-editor` removed in `0.53`. Don't bump `monaco-editor` without checking `monaco-yaml`'s compatibility first (the failure mode is silent: the editor still renders, but schema validation quietly stops working).
