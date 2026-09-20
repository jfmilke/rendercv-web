# RenderCV Web

> [!NOTE]
> This is a personal convenience project which primarily used AI.
> It's meant as an exploratory playground to test the wits of it and gain something useful.

A web UI you host yourself for [RenderCV](https://github.com/rendercv/rendercv): write your CV as YAML in the browser, render it to PDF, and get a live preview, all without installing anything locally.

- **YAML editor** with syntax highlighting and inline validation against RenderCV's own schema
- **Live PDF preview** of the rendered CV
- **Download** the generated PDF
- **Output log** showing exactly what the RenderCV CLI printed
- Optional **profile photo upload** (off by default)
- Runs as a small Docker Compose stack: a browser UI, an API, and an isolated renderer

## Quick start

Pull the latest release from the GitHub Container Registry:

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml up
```

Or build from source:

```bash
cp .env.example .env
docker compose up --build
```

Open http://localhost:8000.

## Compose Files

Two Compose files are provided:

- `docker-compose.yml` builds all images from source. Use this when developing or when you want full control over what runs.
- `docker-compose.prod.yml` pulls prebuilt images from the GitHub Container Registry (`ghcr.io/jfmilke/rendercv-web-backend` and `ghcr.io/jfmilke/rendercv-web-worker`). Use this to run the latest release without building anything yourself.

Images are published automatically whenever a version is tagged (`v*`) and released; see `.github/workflows/release-images.yml`. Pin an exact version instead of `latest` in `docker-compose.prod.yml` for reproducible deploys.

## Configuration

Set these in `.env` (copied from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `IMAGE_UPLOAD_ENABLED` | `false` | Enables the optional profile photo upload feature. See [AGENTS.md](AGENTS.md) for the trade offs this accepts. |
| `RENDER_TIMEOUT_SECONDS` | `30` | Maximum time allowed for a single render, in seconds. |
| `WORKER_URL` | `http://worker:8000` | Internal address the backend uses to reach the renderer. Set by `docker-compose.yml`; you normally won't touch this. |

## Security

This app has no authentication built in, and anyone who can reach it can submit renders.
It's meant for localhost or a trusted network. If you expose it beyond that, put a reverse proxy in front that handles access control and TLS (for example Caddy `basic_auth` or nginx `auth_basic`).

## How it works

Three services in one Compose stack:

- **frontend**: the browser UI (React), served by the backend
- **backend**: the only service exposed to the network; relays render requests
- **worker**: runs RenderCV itself, isolated from the network with no access beyond the backend

## Contributing

To work on the frontend, you can just spin up the docker container and start a seperate frontend session:

```bash
docker compose up -d

cd frontend
npm run dev
```

But to work completely locally, install the dependencies first:

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

Built on top of [RenderCV](https://github.com/rendercv/rendercv) by the RenderCV project. This repository only adds a web UI around it.
