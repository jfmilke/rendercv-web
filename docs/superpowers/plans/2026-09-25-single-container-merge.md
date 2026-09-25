# Single-Container Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the `backend` + `worker` two-container Docker Compose stack into a single FastAPI process in one container, dropping the internal-network HTTP relay while keeping the worker's subprocess-level sandboxing (temp dir, rlimits, timeout, concurrency cap) exactly as-is.

**Architecture:** `worker/worker_app/executor.py` moves into `backend/backend_app/executor.py` unchanged; `backend_app/render_routes.py` calls `run_render(...)` directly instead of relaying an HTTP request over `internal-net`; `worker/` and `shared/` are deleted entirely. The Dockerfile, compose file, CI image-publish workflow, and docs are updated to describe one image/one container instead of two.

**Tech Stack:** FastAPI, uvicorn, pytest + pytest-asyncio, httpx (test-only after this change), Docker/Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-25-single-container-merge-design.md`

## Global Constraints

- Merged container hardening (compose): `read_only: true`, `tmpfs: ["/tmp:size=64m,mode=1777,noexec,nosuid"]`, `cap_drop: ["ALL"]`, `security_opt: ["no-new-privileges:true"]`, `pids_limit: 150`, `mem_limit: 1536m`, `cpus: 1.5`.
- Non-root container user: `app`, uid 999, `HOME=/home/app`.
- `rendercv[full]==2.8` is the pinned version (unchanged from `worker/requirements.txt` today).
- Published image name: `ghcr.io/jfmilke/rendercv-web` (replacing `-backend` / `-worker`).
- `_MAX_CONCURRENT_RENDERS = 2` (unchanged value, moves from `worker_app/main.py` to `backend_app/render_routes.py`).
- `shared/rendercv_web_schemas`'s `RenderRequest` model is **dropped, not moved** — it only ever existed to define the JSON body sent from backend to worker over HTTP. Calling `run_render()` in-process takes plain `yaml_content: str` and `image: tuple[str, bytes] | None` args directly, so there is nothing left to construct `RenderRequest` for, and the base64 encode (backend) / decode (worker) round-trip on the image bytes it required goes away too — image bytes now pass through as raw `bytes`. `format_sse_event` (from `shared/rendercv_web_schemas/sse.py`) is kept and moves into `backend_app/sse.py`: it's still needed to frame the SSE stream sent to the browser, which is a real protocol requirement independent of process topology. This is a deliberate deviation from the design spec's directory layout (which listed a `models.py`); it was caught while mapping files for this plan — grep confirmed `RenderRequest` has no other consumer.
- Every reference to `worker` in file paths, imports, compose service names, and Docker network config disappears; nothing named `worker` should remain after Task 3.

---

## Task 1: Add `executor.py` and `sse.py` to `backend_app`, unwired

Pure move-and-test-in-isolation: gives `backend_app` its own copies of the two modules the merge needs, each verified independently, before anything in `backend_app` is changed to use them. `worker/` and `shared/` are untouched in this task — nothing else in the repo is affected yet.

**Files:**
- Create: `backend/backend_app/executor.py`
- Create: `backend/backend_app/sse.py`
- Create: `backend/tests/fixtures/minimal_valid.yaml`
- Create: `backend/tests/fixtures/minimal_invalid.yaml`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_executor.py`
- Create: `backend/tests/test_sse.py`

**Interfaces:**
- Produces: `backend_app.executor.run_render(yaml_content: str, image: tuple[str, bytes] | None, timeout_seconds: float = 30.0) -> AsyncIterator[RenderEvent]` where `RenderEvent = LogLine | RenderSuccess | RenderFailure` (dataclasses: `LogLine.text: str`, `RenderSuccess.pdf_bytes: bytes`, `RenderFailure.message: str`).
- Produces: `backend_app.sse.format_sse_event(event: str, data: dict[str, Any]) -> bytes`.

- [ ] **Step 1: Copy `executor.py` verbatim**

```bash
cp worker/worker_app/executor.py backend/backend_app/executor.py
```

No content changes needed — the file has no `worker_app`-specific imports.

- [ ] **Step 2: Copy `sse.py` verbatim**

```bash
cp shared/rendercv_web_schemas/sse.py backend/backend_app/sse.py
```

- [ ] **Step 3: Copy the render fixtures**

```bash
mkdir -p backend/tests/fixtures
cp worker/tests/fixtures/minimal_valid.yaml backend/tests/fixtures/minimal_valid.yaml
cp worker/tests/fixtures/minimal_invalid.yaml backend/tests/fixtures/minimal_invalid.yaml
```

- [ ] **Step 4: Create `backend/tests/conftest.py`**

```python
import os
import sys
from pathlib import Path

# backend's render tests now exercise real `rendercv` subprocess calls (they
# used to be worker-only), so the directory holding the currently running
# interpreter (the virtualenv's bin/ when tests run under it) must be on PATH
# for the executable to resolve.
_interpreter_bin = Path(sys.executable).parent
if _interpreter_bin.is_dir():
    os.environ["PATH"] = f"{_interpreter_bin}{os.pathsep}" + os.environ.get("PATH", "")
```

- [ ] **Step 5: Create `backend/tests/test_executor.py`**

```python
import asyncio
import base64
import tempfile
from pathlib import Path

import pytest

from backend_app.executor import LogLine, RenderFailure, RenderSuccess, run_render

FIXTURES = Path(__file__).parent / "fixtures"

_TINY_PNG_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY"
    "42YAAAAASUVORK5CYII="
)


@pytest.mark.asyncio
async def test_run_render_success_with_valid_yaml():
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    events = [event async for event in run_render(yaml_content, image=None, timeout_seconds=30)]

    log_lines = [e for e in events if isinstance(e, LogLine)]
    terminal = events[-1]
    assert len(log_lines) >= 1
    assert isinstance(terminal, RenderSuccess)
    assert terminal.pdf_bytes.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_run_render_failure_with_invalid_yaml():
    yaml_content = (FIXTURES / "minimal_invalid.yaml").read_text()

    events = [event async for event in run_render(yaml_content, image=None, timeout_seconds=30)]

    terminal = events[-1]
    assert isinstance(terminal, RenderFailure)


@pytest.mark.asyncio
async def test_run_render_places_image_next_to_yaml_and_succeeds():
    yaml_content = (
        "cv:\n"
        "  name: Bob Smith\n"
        "  photo: avatar.png\n"
        "  sections:\n"
        "    experience:\n"
        "    - company: Acme Corp\n"
        "      position: Software Engineer\n"
        "      start_date: 2022-01\n"
        "      end_date: present\n"
        "design:\n"
        "  theme: classic\n"
        "locale:\n"
        "  language: english\n"
    )
    png_bytes = base64.b64decode(_TINY_PNG_BASE64)

    events = [
        event
        async for event in run_render(
            yaml_content, image=("avatar.png", png_bytes), timeout_seconds=30
        )
    ]

    terminal = events[-1]
    log_text = "\n".join(e.text for e in events if isinstance(e, LogLine))
    assert isinstance(terminal, RenderSuccess), log_text


@pytest.mark.asyncio
async def test_run_render_cleans_up_temp_directory(monkeypatch):
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()
    created_dirs: list[Path] = []
    original_mkdtemp = tempfile.mkdtemp

    def tracking_mkdtemp(*args, **kwargs):
        path = original_mkdtemp(*args, **kwargs)
        created_dirs.append(Path(path))
        return path

    monkeypatch.setattr("backend_app.executor.tempfile.mkdtemp", tracking_mkdtemp)

    async for _ in run_render(yaml_content, image=None, timeout_seconds=30):
        pass

    assert len(created_dirs) == 1
    assert not created_dirs[0].exists()


@pytest.mark.asyncio
async def test_run_render_times_out_and_kills_process_group(monkeypatch):
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    class HangingProcess:
        pid = 999999
        stdout = asyncio.StreamReader()

        async def wait(self):
            return 0

    async def fake_create_subprocess_exec(*args, **kwargs):
        return HangingProcess()

    killed = []

    def fake_killpg(pid, sig):
        killed.append((pid, sig))

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr("backend_app.executor.os.killpg", fake_killpg)

    events = [
        event async for event in run_render(yaml_content, image=None, timeout_seconds=0.05)
    ]

    terminal = events[-1]
    assert isinstance(terminal, RenderFailure)
    assert "timed out" in terminal.message
    assert killed


@pytest.mark.asyncio
async def test_run_render_ignores_image_with_path_traversal_filename(monkeypatch):
    """A filename with path components is ignored, not written."""
    created_dirs: list[Path] = []
    original_mkdtemp = tempfile.mkdtemp

    def tracking_mkdtemp(*args, **kwargs):
        path = original_mkdtemp(*args, **kwargs)
        created_dirs.append(Path(path))
        return path

    monkeypatch.setattr("backend_app.executor.tempfile.mkdtemp", tracking_mkdtemp)

    written: list[Path] = []
    real_write_bytes = Path.write_bytes

    def tracking_write_bytes(self, data):
        written.append(Path(self))
        return real_write_bytes(self, data)

    monkeypatch.setattr(Path, "write_bytes", tracking_write_bytes)

    png_bytes = base64.b64decode(_TINY_PNG_BASE64)
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    events = [
        event
        async for event in run_render(
            yaml_content, image=("../../escaped.png", png_bytes), timeout_seconds=30
        )
    ]

    assert written == []
    assert isinstance(events[-1], RenderSuccess | RenderFailure)
    tmpdir = created_dirs[0]
    assert not (tmpdir.parent.parent / "escaped.png").exists()


@pytest.mark.asyncio
async def test_run_render_writes_image_with_plain_filename(monkeypatch):
    """Control case: an ordinary filename is still written."""
    written: list[Path] = []
    real_write_bytes = Path.write_bytes

    def tracking_write_bytes(self, data):
        written.append(Path(self))
        return real_write_bytes(self, data)

    monkeypatch.setattr(Path, "write_bytes", tracking_write_bytes)

    png_bytes = base64.b64decode(_TINY_PNG_BASE64)
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    async for _ in run_render(
        yaml_content, image=("avatar.png", png_bytes), timeout_seconds=30
    ):
        pass

    assert [p.name for p in written] == ["avatar.png"]


@pytest.mark.asyncio
async def test_run_render_kills_process_that_closes_stdout_without_exiting(monkeypatch):
    """Waiting for exit after EOF is itself bounded."""
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()

    stdout = asyncio.StreamReader()
    stdout.feed_data(b"working...\n")
    stdout.feed_eof()

    class StuckProcess:
        pid = 999999

        def __init__(self):
            self.stdout = stdout
            self.wait_calls = 0

        async def wait(self):
            self.wait_calls += 1
            if self.wait_calls == 1:
                await asyncio.sleep(3600)
            return -9

    process = StuckProcess()

    async def fake_create_subprocess_exec(*args, **kwargs):
        return process

    killed = []

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    monkeypatch.setattr("backend_app.executor.os.killpg", lambda pid, sig: killed.append(pid))
    monkeypatch.setattr("backend_app.executor._EXIT_GRACE_SECONDS", 0.05)

    events = [event async for event in run_render(yaml_content, image=None, timeout_seconds=30)]

    terminal = events[-1]
    assert isinstance(terminal, RenderFailure)
    assert "did not exit" in terminal.message
    assert killed == [999999]
```

- [ ] **Step 6: Create `backend/tests/test_sse.py`**

```python
from backend_app.sse import format_sse_event


def test_format_sse_event_produces_valid_frame():
    frame = format_sse_event("log", {"line": "hello"})
    assert frame == b'event: log\ndata: {"line": "hello"}\n\n'


def test_format_sse_event_escapes_embedded_newlines():
    frame = format_sse_event("result", {"message": "line1\nline2"})
    text = frame.decode("utf-8")
    lines = text.split("\n")
    assert lines[0] == "event: result"
    assert lines[1].startswith("data: ")
    assert "\\n" in lines[1]
```

- [ ] **Step 7: Run the new tests**

Run: `pytest backend/tests/test_executor.py backend/tests/test_sse.py -v`
Expected: PASS (9 tests: 7 in `test_executor.py`, 2 in `test_sse.py`, all green).

- [ ] **Step 8: Commit**

```bash
git add backend/backend_app/executor.py backend/backend_app/sse.py \
  backend/tests/fixtures backend/tests/conftest.py \
  backend/tests/test_executor.py backend/tests/test_sse.py
git commit -m "feat(backend): add executor and sse modules, sourced from worker/shared"
```

---

## Task 2: Wire `render_routes.py` to call `run_render()` directly

The core behavioral change: replace the HTTP relay to `worker` with a direct in-process call to `backend_app.executor.run_render`, drop `RenderRequest`/base64 wire round-trip, move the concurrency semaphore in, and make `GET /version` read the installed package version directly instead of asking `worker`.

**Files:**
- Modify: `backend/backend_app/render_routes.py`
- Modify: `backend/backend_app/main.py`
- Modify: `backend/backend_app/config.py`
- Modify: `backend/tests/test_render_routes.py`
- Modify: `backend/tests/test_main.py`

**Interfaces:**
- Consumes: `backend_app.executor.run_render`, `LogLine`, `RenderSuccess`, `RenderFailure` (Task 1); `backend_app.sse.format_sse_event` (Task 1).
- Produces: `backend_app.render_routes._MAX_CONCURRENT_RENDERS: int = 2`, `backend_app.render_routes._render_semaphore: asyncio.Semaphore`, `backend_app.render_routes.run_render` (the name later tests monkeypatch).

- [ ] **Step 1: Replace `backend/tests/test_render_routes.py`**

```python
import asyncio
from pathlib import Path

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import backend_app.render_routes as render_routes
from backend_app.config import settings
from backend_app.render_routes import router

app = FastAPI()
app.include_router(router)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.asyncio
async def test_render_streams_log_then_success_result():
    yaml_content = (FIXTURES / "minimal_valid.yaml").read_text()
    transport = ASGITransport(app=app)
    body = b""
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream(
            "POST", "/render", json={"yaml_content": yaml_content}
        ) as response:
            assert response.status_code == 200
            async for chunk in response.aiter_bytes():
                body += chunk

    text = body.decode("utf-8")
    assert "event: log" in text
    assert '"status": "success"' in text


@pytest.mark.asyncio
async def test_render_streams_error_result_for_invalid_yaml():
    yaml_content = (FIXTURES / "minimal_invalid.yaml").read_text()
    transport = ASGITransport(app=app)
    body = b""
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream(
            "POST", "/render", json={"yaml_content": yaml_content}
        ) as response:
            async for chunk in response.aiter_bytes():
                body += chunk

    text = body.decode("utf-8")
    assert '"status": "error"' in text


@pytest.mark.asyncio
async def test_render_rejects_oversized_yaml_without_running_rendercv(monkeypatch):
    async def exploding_run_render(*args, **kwargs):
        raise AssertionError("run_render must not be called for an oversized payload")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(render_routes, "run_render", exploding_run_render)

    huge_yaml = "cv:\n  name: " + ("x" * 300_000)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/render", json={"yaml_content": huge_yaml})

    assert response.status_code == 413


@pytest.mark.asyncio
async def test_render_rejects_non_string_yaml_content():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post("/render", json={"yaml_content": 12345})

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_render_rejects_malformed_content_length_header():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.request(
            "POST",
            "/render",
            content=b'{"yaml_content": "test"}',
            headers={"content-length": "not-a-number"},
        )

    assert response.status_code == 413


@pytest.mark.asyncio
async def test_render_emits_error_result_when_run_render_raises(monkeypatch):
    """An unexpected exception from run_render must still terminate the SSE stream."""

    async def exploding_run_render(*args, **kwargs):
        raise RuntimeError("boom")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(render_routes, "run_render", exploding_run_render)

    transport = ASGITransport(app=app)
    body = b""
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("POST", "/render", json={"yaml_content": "cv: {}"}) as response:
            async for chunk in response.aiter_bytes():
                body += chunk

    text = body.decode("utf-8")
    assert "event: result" in text
    assert '"status": "error"' in text
    assert "boom" in text


@pytest.mark.asyncio
async def test_render_passes_configured_timeout_to_run_render(monkeypatch):
    settings.render_timeout_seconds = 77.5
    seen: dict[str, float] = {}

    async def recording_run_render(yaml_content, image=None, timeout_seconds=30.0):
        seen["timeout_seconds"] = timeout_seconds
        return
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(render_routes, "run_render", recording_run_render)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("POST", "/render", json={"yaml_content": "cv: {}"}) as response:
            async for _ in response.aiter_bytes():
                pass

    settings.render_timeout_seconds = 30.0
    assert seen["timeout_seconds"] == 77.5


@pytest.mark.asyncio
async def test_render_limits_concurrent_renders(monkeypatch):
    concurrent = 0
    peak = 0
    release = asyncio.Event()

    async def slow_run_render(yaml_content, image=None, timeout_seconds=30.0):
        nonlocal concurrent, peak
        concurrent += 1
        peak = max(peak, concurrent)
        try:
            await release.wait()
        finally:
            concurrent -= 1
        return
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(render_routes, "run_render", slow_run_render)

    transport = ASGITransport(app=app)

    async def one_request():
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            async with client.stream(
                "POST", "/render", json={"yaml_content": "cv: {}"}
            ) as response:
                async for _ in response.aiter_bytes():
                    pass

    tasks = [asyncio.create_task(one_request()) for _ in range(5)]
    for _ in range(20):
        await asyncio.sleep(0)
    observed_peak = peak
    release.set()
    await asyncio.gather(*tasks)

    assert observed_peak <= render_routes._MAX_CONCURRENT_RENDERS
    assert observed_peak >= 1


@pytest.mark.asyncio
async def test_render_rejects_oversized_chunked_body_without_content_length():
    """The size cap must hold when Content-Length is absent (chunked body)."""
    oversized = b'{"yaml_content": "' + b"x" * 400_000 + b'"}'

    async def chunked_body():
        for start in range(0, len(oversized), 16_384):
            yield oversized[start : start + 16_384]

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        request = client.build_request("POST", "/render", content=chunked_body())
        assert "content-length" not in request.headers
        response = await client.send(request)

    assert response.status_code == 413


@pytest.mark.asyncio
async def test_render_rejects_malformed_json_body_with_422():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/render",
            content=b"{not json",
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == "Invalid JSON body"


@pytest.mark.asyncio
async def test_render_rejects_non_utf8_body_with_422():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/render",
            content=b'{"yaml_content": "\xff\xfe invalid"}',
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 422
```

- [ ] **Step 2: Replace `backend/tests/test_main.py`**

```python
import pytest
from httpx import ASGITransport, AsyncClient

from backend_app.config import settings
from backend_app.main import app


@pytest.mark.asyncio
async def test_version_returns_installed_rendercv_version():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/version")

    assert response.status_code == 200
    assert response.json()["rendercv_version"]


@pytest.mark.asyncio
async def test_config_reports_image_upload_flag():
    settings.image_upload_enabled = True
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/config")

    assert response.json() == {"imageUploadEnabled": True}
    settings.image_upload_enabled = False


@pytest.mark.asyncio
async def test_security_headers_present_on_responses():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/config")

    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"

    csp = response.headers["content-security-policy"]
    # The baseline stays restrictive: no third-party or inline scripts, so the
    # editor can only ever come from the locally bundled monaco-editor.
    assert "default-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "unsafe-inline" not in csp.split("style-src")[0]
    assert "script-src" not in csp
    # Monaco styles itself inline; without this the editor renders unstyled.
    assert "style-src 'self' 'unsafe-inline'" in csp
    # The generated PDF reaches the preview as a data: URL rendered to a canvas.
    assert "img-src 'self' data: blob:" in csp
    assert "connect-src 'self' data: blob:" in csp
    assert "worker-src 'self' blob:" in csp


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
@pytest.mark.asyncio
async def test_api_documentation_endpoints_are_disabled(path):
    """The route listing must not be published."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(path)

    assert response.status_code == 404
```

- [ ] **Step 3: Run the updated tests to confirm they fail against the current implementation**

Run: `pytest backend/tests/test_render_routes.py backend/tests/test_main.py -v`
Expected: FAIL — `render_routes` has no attribute `run_render` (monkeypatch targets), and `test_main.py` no longer imports `worker_app` so `/version` still hits the real `httpx` relay to a nonexistent `worker` host and errors instead of returning cleanly. Confirms the tests are exercising code that doesn't exist yet.

- [ ] **Step 4: Rewrite `backend/backend_app/render_routes.py`**

```python
import asyncio
import base64
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend_app.config import settings
from backend_app.executor import LogLine, RenderFailure, RenderSuccess, run_render
from backend_app.session_cache import session_image_cache
from backend_app.sse import format_sse_event

router = APIRouter()

# RLIMIT_NPROC is a per-UID limit enforced across the whole container, and the
# container's memory limit is shared too, so concurrent renders compete for one
# budget and can make each other fail spuriously. Bound how many run at once.
_MAX_CONCURRENT_RENDERS = 2
_render_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_RENDERS)


async def _read_body_with_limit(request: Request, max_bytes: int) -> bytes:
    """Accumulate the request body, aborting the moment it exceeds `max_bytes`.

    `request.json()` would buffer the whole body first, which a client can make
    unbounded simply by using chunked transfer-encoding (no Content-Length).
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Request body too large")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/render")
async def render(request: Request) -> StreamingResponse:
    max_body_bytes = settings.max_yaml_bytes + 10_000

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            content_length_value = int(content_length)
        except ValueError:
            raise HTTPException(status_code=413, detail="Invalid Content-Length header") from None
        if content_length_value > max_body_bytes:
            raise HTTPException(status_code=413, detail="Request body too large")

    raw_body = await _read_body_with_limit(request, max_body_bytes)
    try:
        body = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail="Invalid JSON body") from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Invalid JSON body")

    yaml_content = body.get("yaml_content")
    if not isinstance(yaml_content, str):
        raise HTTPException(status_code=422, detail="yaml_content must be a string")
    if len(yaml_content.encode("utf-8")) > settings.max_yaml_bytes:
        raise HTTPException(status_code=413, detail="yaml_content exceeds maximum size")

    session_id = request.headers.get("x-session-id")
    cached_image = session_image_cache.get(session_id) if session_id else None
    image = (cached_image.filename, cached_image.content) if cached_image else None

    async def event_stream() -> AsyncIterator[bytes]:
        try:
            async with _render_semaphore:
                async for event in run_render(
                    yaml_content, image=image, timeout_seconds=settings.render_timeout_seconds
                ):
                    if isinstance(event, LogLine):
                        yield format_sse_event("log", {"line": event.text})
                    elif isinstance(event, RenderSuccess):
                        pdf_b64 = base64.b64encode(event.pdf_bytes).decode("ascii")
                        yield format_sse_event(
                            "result", {"status": "success", "pdf_base64": pdf_b64}
                        )
                    elif isinstance(event, RenderFailure):
                        yield format_sse_event(
                            "result", {"status": "error", "message": event.message}
                        )
        except Exception as exc:  # noqa: BLE001 - must always terminate the SSE stream
            # Without a terminal `result` event the client waits forever, so any
            # unexpected failure is reported as one instead of silently ending.
            yield format_sse_event("result", {"status": "error", "message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 5: Rewrite `backend/backend_app/main.py`**

```python
from importlib.metadata import version as installed_version
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles

from backend_app.config import settings
from backend_app.image_routes import router as image_router
from backend_app.render_routes import router as render_router

# Interactive docs and the OpenAPI schema are disabled: this app has no built-in
# authentication, and there is no reason to publish a route listing (including
# /image, which exists even when the image-upload feature is disabled).
app = FastAPI(docs_url=None, openapi_url=None, redoc_url=None)
app.include_router(render_router)
app.include_router(image_router)

# No CORS middleware: the frontend is served by this same app, so the
# absence of CORS headers is exactly what locks API access to same-origin.

_version_cache: dict[str, str] = {}


@app.get("/version")
async def get_version() -> dict[str, str]:
    if "rendercv_version" not in _version_cache:
        _version_cache["rendercv_version"] = installed_version("rendercv")
    return {"rendercv_version": _version_cache["rendercv_version"]}


@app.get("/config")
async def get_config() -> dict[str, bool]:
    return {"imageUploadEnabled": settings.image_upload_enabled}


# `default-src 'self'` stays the baseline; the extra directives below are the
# minimum the bundled frontend actually needs (verified in a real browser):
#   style-src  - the Monaco editor positions and colors everything through
#                inline <style> elements and style attributes.
#   img-src    - react-pdf/pdf.js renders pages into blob/data-backed images.
#   worker-src - Monaco and pdf.js web workers; both are same-origin chunks,
#                but pdf.js wraps its worker in a blob URL.
#   connect-src- the generated PDF reaches the preview as a data: URL.
# Notably NOT relaxed: script-src, which still forbids inline scripts and any
# third-party origin (the CDN this app used to pull Monaco from).
_CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "worker-src 'self' blob:; "
    "connect-src 'self' data: blob:; "
    "frame-ancestors 'none'"
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = _CONTENT_SECURITY_POLICY
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "static"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
```

(Only the `/version` handler and imports changed from today's file — the CSP, middleware, and static mount are untouched.)

- [ ] **Step 6: Remove `worker_url` from `backend/backend_app/config.py`**

```python
import os


class Settings:
    def __init__(self) -> None:
        self.image_upload_enabled: bool = (
            os.environ.get("IMAGE_UPLOAD_ENABLED", "false").lower() == "true"
        )
        self.render_timeout_seconds: float = float(
            os.environ.get("RENDER_TIMEOUT_SECONDS", "30")
        )
        self.max_yaml_bytes: int = 256_000
        self.session_ttl_seconds: float = 2 * 60 * 60
        self.max_sessions: int = 20


settings = Settings()
```

- [ ] **Step 7: Run the full backend test suite**

Run: `pytest backend/tests -v`
Expected: PASS — all tests in `test_render_routes.py`, `test_main.py`, `test_image_routes.py`, `test_executor.py`, `test_sse.py` green. (`worker/tests` and `shared/tests` still exist and still pass unchanged at this point — Task 3 removes them.)

- [ ] **Step 8: Commit**

```bash
git add backend/backend_app/render_routes.py backend/backend_app/main.py \
  backend/backend_app/config.py backend/tests/test_render_routes.py backend/tests/test_main.py
git commit -m "feat(backend): call run_render directly instead of relaying to worker over HTTP"
```

---

## Task 3: Delete `worker/` and `shared/`, merge Dockerfile and dependencies

Now that `backend_app` is fully self-sufficient, remove the two directories it no longer needs, and merge the Dockerfile/requirements so `backend/Dockerfile` builds a single image capable of everything the two old images did together.

**Files:**
- Delete: `worker/` (entire directory)
- Delete: `shared/` (entire directory)
- Modify: `backend/Dockerfile`
- Modify: `backend/requirements.txt`
- Modify: `backend/requirements-dev.txt`
- Modify: `pytest.ini`

**Interfaces:**
- Consumes: nothing new — this task only removes dead code and updates the build/test configuration pointing at it.

- [ ] **Step 1: Delete the old directories**

```bash
git rm -r worker shared
```

- [ ] **Step 2: Update `backend/requirements.txt`**

```
fastapi==0.141.1
uvicorn[standard]==0.53.0
python-multipart==0.0.32
rendercv[full]==2.8
```

(`httpx` is removed — it was only ever used for the relay to `worker`, which is now gone. `rendercv[full]==2.8` is added — the pin `worker/requirements.txt` used.)

- [ ] **Step 3: Update `backend/requirements-dev.txt`**

```
-r requirements.txt
pytest==9.1.1
pytest-asyncio==1.4.0
httpx==0.28.1
```

(`httpx` moves here explicitly — the test suite's `ASGITransport`/`AsyncClient` still need it, but it's no longer pulled in transitively via `requirements.txt`.)

- [ ] **Step 4: Update `pytest.ini`**

```ini
[pytest]
addopts = --import-mode=importlib
consider_namespace_packages = true
pythonpath = backend
asyncio_mode = strict
testpaths = backend/tests
```

- [ ] **Step 5: Rewrite `backend/Dockerfile`**

```dockerfile
FROM node:24-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
RUN groupadd --gid 999 app && useradd --uid 999 --gid app --create-home app
WORKDIR /app

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/backend_app ./backend_app
COPY --from=frontend-build /frontend/dist ./static

# Set HOME explicitly rather than relying on it being derived from /etc/passwd:
# the Typst package cache below is keyed off $HOME, and it must resolve to the
# same path at runtime even if compose overrides `user:`.
ENV HOME=/home/app
USER app

# The container runs with dropped capabilities, a read-only root filesystem,
# and (per the operator's deployment) no route to the internet at runtime, for
# security isolation around the code that runs rendercv/Typst on untrusted
# input. rendercv's bundled Typst library unconditionally imports the
# third-party "@preview/fontawesome:0.6.0" Typst package for icon rendering on
# every render, which Typst otherwise tries to download on first use.
# Pre-warm Typst's package cache here at build time (when network access is
# still available) so the exact same cache path Typst resolves at runtime
# ($HOME/.cache/typst/packages, i.e. /home/app/.cache/typst/packages) is
# already populated in the image layer, and no network call is ever needed at
# render time.
RUN printf '#import "@preview/fontawesome:0.6.0": fa-icon\n' > /home/app/_warm.typ \
    && python3 -c "import typst; typst.compile('/home/app/_warm.typ', output='/home/app/_warm.pdf')" \
    && rm -f /home/app/_warm.typ /home/app/_warm.pdf

EXPOSE 8000
CMD ["uvicorn", "backend_app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 6: Run the full test suite**

Run: `pip install -r backend/requirements-dev.txt && pytest -v`
Expected: PASS — all tests under `backend/tests` (this is now the only `testpaths` entry).

- [ ] **Step 7: Build the merged image**

Run: `docker build -t rendercv-web:local -f backend/Dockerfile .`
Expected: image builds successfully, including the Typst package pre-warm step.

- [ ] **Step 8: Smoke-test the built image**

```bash
docker run --rm -p 8000:8000 rendercv-web:local &
sleep 3
curl -sf http://localhost:8000/version
curl -sf -X POST http://localhost:8000/render \
  -H 'content-type: application/json' \
  -d '{"yaml_content": "cv:\n  name: Test User\n  email: test@example.com\n"}'
kill %1
```

Expected: `/version` returns `{"rendercv_version": "2.8..."}`; `/render` streams `event: log` lines followed by `event: result` with `"status": "success"`.

- [ ] **Step 9: Commit**

```bash
git add backend/Dockerfile backend/requirements.txt backend/requirements-dev.txt pytest.ini
git commit -m "chore: delete worker/shared, merge Dockerfile and dependencies into backend"
```

---

## Task 4: Collapse Docker Compose to a single hardened service

Replace the two-service, two-file compose setup with one file, one service, that can either build from source or pull the published image.

**Files:**
- Modify: `docker-compose.yml`
- Delete: `docker-compose.prod.yml`

**Interfaces:**
- Consumes: `backend/Dockerfile` (Task 3), env vars `IMAGE_UPLOAD_ENABLED`, `RENDER_TIMEOUT_SECONDS`, `RENDERCV_WEB_VERSION` (new — selects which published tag `image:` pulls; defaults to `latest`).

- [ ] **Step 1: Rewrite `docker-compose.yml`**

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

- [ ] **Step 2: Delete `docker-compose.prod.yml`**

```bash
git rm docker-compose.prod.yml
```

- [ ] **Step 3: Smoke-test building from source**

```bash
cp .env.example .env   # if not already present
docker compose up --build -d
sleep 3
curl -sf http://localhost:8000/version
curl -sf -X POST http://localhost:8000/render \
  -H 'content-type: application/json' \
  -d '{"yaml_content": "cv:\n  name: Test User\n  email: test@example.com\n"}'
docker compose down
```

Expected: same successful `/version` and `/render` results as Task 3's Step 8, now running under the compose-applied hardening (`read_only`, `cap_drop: [ALL]`, etc.) — confirms the hardened container can still write its render temp files (they go to the `tmpfs` `/tmp`, not the read-only root).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docker-compose.prod.yml
git commit -m "chore: collapse docker-compose to a single hardened backend service"
```

---

## Task 5: Update CI workflows

**Files:**
- Modify: `.github/workflows/release-images.yml`
- Modify: `.github/workflows/tests.yml`

**Interfaces:**
- Consumes: `backend/Dockerfile`, `backend/requirements-dev.txt` (Task 3).

- [ ] **Step 1: Rewrite `.github/workflows/release-images.yml`**

```yaml
name: Build and publish image

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read
  packages: write

jobs:
  test:
    uses: ./.github/workflows/tests.yml

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v4

      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        uses: docker/build-push-action@v7
        with:
          context: .
          file: backend/Dockerfile
          push: true
          tags: |
            ghcr.io/jfmilke/rendercv-web:${{ steps.version.outputs.version }}
            ghcr.io/jfmilke/rendercv-web:latest
```

- [ ] **Step 2: Update the install step in `.github/workflows/tests.yml`**

Change:
```yaml
      - name: Install Python dependencies
        run: pip install -e shared -r worker/requirements-dev.txt -r backend/requirements-dev.txt

      - name: Run backend/worker tests
        run: pytest -v
```
to:
```yaml
      - name: Install Python dependencies
        run: pip install -r backend/requirements-dev.txt

      - name: Run backend tests
        run: pytest -v
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-images.yml .github/workflows/tests.yml
git commit -m "ci: publish a single merged image instead of backend+worker"
```

---

## Task 6: Update README and AGENTS.md

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Update `README.md`**

Replace the `## Compose Files` section:
```markdown
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

Images are published automatically whenever a version is tagged (`v*`) and released; see `.github/workflows/release-images.yml`. Pin `RENDERCV_WEB_VERSION` in `.env` to an exact version instead of `latest` for reproducible deploys.
```

Replace the `## Configuration` table's `WORKER_URL` row by removing it entirely (the two remaining rows, `IMAGE_UPLOAD_ENABLED` and `RENDER_TIMEOUT_SECONDS`, stay as-is).

Replace the `## Security` section's closing paragraph to add:
```markdown
The container itself runs with a read-only root filesystem, all Linux capabilities dropped, and no ability to gain new privileges — the same hardening that used to apply only to the isolated renderer now applies to the whole process, since rendering happens in the same container as the API.
```

Replace the `## How it works` section:
```markdown
## How it works

Two pieces:

- **frontend**: the browser UI (React), built into static files
- **backend**: serves the frontend, exposes the render API, and runs RenderCV itself as a sandboxed subprocess (fresh temp directory per render, CPU/file-descriptor limits, a wall-clock timeout, and a concurrency cap)
```

Replace the `## Contributing` section's install snippet:
```bash
# Python (backend)
pip install -r backend/requirements-dev.txt
pytest -v
```

Update the `AGENTS.md` reference sentence in `## Contributing` (unchanged wording is fine, it already just says "covers the architecture").

- [ ] **Step 2: Update `AGENTS.md`**

Replace the `## Services` section:
```markdown
## Services

One service, one docker-compose stack:

- **`backend`** (`backend/`, FastAPI) — serves the built frontend as static files, exposes `POST /render` (SSE-streamed), `GET /version`, `GET /config`, and the optional `POST`/`DELETE /image`. Runs `rendercv` as a subprocess per render, in a fresh per-request temp directory, with a wall-clock timeout, OS-level `rlimit`s (CPU time, open files, process count — deliberately *not* memory via `RLIMIT_AS`, since Typst's Rust binary reserves large virtual address ranges that make that limit fire spuriously), and a concurrency cap (`asyncio.Semaphore`) since `RLIMIT_NPROC` is a per-UID limit shared across the whole container, not per-subprocess. No database, no persisted files beyond an in-memory, TTL-bounded session→image cache.
- **`frontend`** (`frontend/`, React + Vite + TypeScript + Tailwind v4) — Monaco editor with rendercv's real JSON Schema vendored in (`frontend/src/schema/rendercv-schema.json`, pinned to the same rendercv version the backend runs — re-`curl` it when that version bumps), pdf.js preview, upload/download of YAML and PDF client-side.
```

Replace the `## Security model — why it's shaped this way` section:
```markdown
## Security model — why it's shaped this way

- **No built-in authentication.** Access control is the operator's job via an external reverse proxy (Caddy `basic_auth`, Authelia, VPN, etc.). This app should never be exposed directly to an untrusted network.
- **The code that processes untrusted input** (arbitrary YAML through rendercv/typst, and image bytes when upload is enabled) runs in the same container as the API, so isolation is per-subprocess rather than per-container: each render gets its own temp directory, `rlimit`s (CPU time, open files), a wall-clock timeout, and `os.setsid()` + `killpg` on timeout (`backend/backend_app/executor.py`). The container itself is `read_only` with a `tmpfs` `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, and `pids_limit`/`mem_limit`/`cpus` caps in `docker-compose.yml` — this used to apply only to a network-isolated `worker` container; it's now the outermost defense layer for the whole process, since there is no longer a hard network boundary between the code that renders untrusted YAML and the internet-facing API. Deploying this behind an access-controlled reverse proxy (see above) is what keeps that boundary's absence acceptable.
- **Image upload is opt-in** (`IMAGE_UPLOAD_ENABLED`, default off) and, when enabled, is a *deliberate* exception to the above: uploads are uncapped in size and validated only by magic-byte sniffing (jpg/jpeg/png/webp) plus filename sanitization (no deep decode/re-encode, no dimension caps). This was an explicit scope decision for a feature primarily meant for personal, off-network use — enabling it on a publicly reachable deployment means accepting that reduced hardening.
- **rendercv is pinned** (`rendercv[full]==<version>` in `backend/requirements.txt`) and installed via `pip` into our own image — not derived from the upstream `ghcr.io/rendercv/rendercv` image, which is built for one-shot CLI invocation, not a long-running service. Bump deliberately, not via a floating tag.
- **Typst's package cache is pre-warmed at Docker build time** (`backend/Dockerfile`): rendercv's bundled templates import a third-party Typst package (`@preview/fontawesome`) that Typst otherwise tries to download over the network on first use — which would fail at runtime since the container has no reason to reach the network at render time. If you bump the rendercv pin, re-check this still covers whatever Typst packages the new version's templates import (grep the installed `rendercv` package for `@preview/` imports), or renders will start failing with a network error.
```

Update the `## Dev commands` section's Python install line:
```bash
pip install -r backend/requirements-dev.txt
pytest -v
```

- [ ] **Step 3: Commit**

```bash
git add README.md AGENTS.md
git commit -m "docs: describe the single-container architecture"
```
