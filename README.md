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
- Runs as a single Docker container: a browser UI and an API

## Running it

```bash
cp .env.example .env
docker compose up --build      # build the image from source
```

or, to run the published release instead of building:

```bash
cp .env.example .env
docker compose pull
docker compose up
```

Pin `RENDERCV_WEB_VERSION` in `.env` to an exact version instead of `latest` for reproducible deploys.

Open http://localhost:8000.

## Configuration

Set these in `.env` (copied from `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `IMAGE_UPLOAD_ENABLED` | `false` | Enables the optional profile photo upload feature. See [AGENTS.md](AGENTS.md) for the trade offs this accepts. |
| `RENDER_TIMEOUT_SECONDS` | `30` | Maximum time allowed for a single render, in seconds. |

## Security

This app has no authentication built in, and anyone who can reach it can submit renders.
It's meant for localhost or a trusted network. If you expose it beyond that, put a reverse proxy in front that handles access control and TLS (for example Caddy `basic_auth` or nginx `auth_basic`). See [AGENTS.md](AGENTS.md) for how the container is hardened.

## How it works

One Docker container serves the frontend and runs RenderCV. See [AGENTS.md](AGENTS.md) for the architecture in detail.

## Contributing

To work on the frontend, you can just spin up the docker container and start a seperate frontend session:

```bash
docker compose up -d

cd frontend
npm run dev
```

But to work completely locally, install the dependencies first:

```bash
# Python (backend)
pip install -r backend/requirements-dev.txt
pytest -v

# Frontend
cd frontend
npm install
npm test
```

[AGENTS.md](AGENTS.md) covers the architecture, the security model, and notes worth knowing before changing dependencies (in particular, `monaco-editor`'s pinned version). Please run both test suites before opening a PR.

## Credits

Built on top of [RenderCV](https://github.com/rendercv/rendercv) by the RenderCV project. This repository only adds a web UI around it.
