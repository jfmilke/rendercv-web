# RenderCV Web

> [!NOTE]
> This is a personal convenience project which primarily used AI.
> It's meant as an exploratory playground to test the wits of it and gain something useful

A self-hosted web UI for [RenderCV](https://github.com/rendercv/rendercv): write your CV as YAML in the browser, render it to PDF, and get a live preview — without installing anything locally.

- **YAML editor** with syntax highlighting and inline validation against RenderCV's own schema
- **Live PDF preview** of the rendered CV
- **Upload/download** your YAML and the generated PDF
- **Output log** showing exactly what the RenderCV CLI printed
- Optional **profile photo upload** (off by default)
- Runs as a small Docker Compose stack: a browser UI, an API, and an isolated renderer

## Quick start

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:8000.

## Configuration

Set these in `.env` (copied from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `IMAGE_UPLOAD_ENABLED` | `false` | Enables the optional profile-photo upload feature. See [AGENTS.md](AGENTS.md) for the trade-offs this accepts. |
| `RENDER_TIMEOUT_SECONDS` | `30` | Wall-clock limit for a single render. |
| `WORKER_URL` | `http://worker:8000` | Internal address the backend uses to reach the renderer. Set by `docker-compose.yml`; you normally won't touch this. |

## Security

This app has **no built-in authentication** and anyone who can reach it can submit renders.
It's meant for localhost or a trusted network. If you expose it beyond that, put a reverse proxy in front that handles access control and TLS (e.g. Caddy `basic_auth`, nginx `auth_basic`, an identity-aware proxy).

## How it works

Three services in one Compose stack:

- **frontend** — the browser UI (React), served by the backend
- **backend** — the only service exposed to the network; relays render requests
- **worker** — runs RenderCV itself, network-isolated with no access beyond the backend

## Contributing

```bash
# Python (backend + worker)
pip install -e shared -r worker/requirements-dev.txt -r backend/requirements-dev.txt
pytest -v

# Frontend
cd frontend
npm install
npm test
```

[AGENTS.md](AGENTS.md) covers the architecture, why things are isolated the way they are, and notes worth knowing before changing dependencies (in particular, `monaco-editor`'s pinned version). Please run both test suites before opening a PR.

## Credits

Built on top of [RenderCV](https://github.com/rendercv/rendercv) by the RenderCV project — this repository only adds a web UI around it.
