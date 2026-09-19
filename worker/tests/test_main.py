import asyncio
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

import worker_app.main as worker_main
from worker_app.main import app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.mark.asyncio
async def test_get_version_returns_installed_rendercv_version():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/version")

    assert response.status_code == 200
    assert response.json()["rendercv_version"]


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
    assert 'event: result\ndata: {"status": "success"' in text


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
async def test_render_emits_error_result_when_run_render_raises(monkeypatch):
    """Fix 3b: an unexpected exception must still terminate the SSE stream."""

    async def exploding_run_render(*args, **kwargs):
        raise RuntimeError("boom")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(worker_main, "run_render", exploding_run_render)

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
    """Fix 5: RENDER_TIMEOUT_SECONDS from the environment must reach run_render."""
    monkeypatch.setenv("RENDER_TIMEOUT_SECONDS", "77.5")
    seen: dict[str, float] = {}

    async def recording_run_render(yaml_content, image=None, timeout_seconds=30.0):
        seen["timeout_seconds"] = timeout_seconds
        return
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(worker_main, "run_render", recording_run_render)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("POST", "/render", json={"yaml_content": "cv: {}"}) as response:
            async for _ in response.aiter_bytes():
                pass

    assert seen["timeout_seconds"] == 77.5


@pytest.mark.asyncio
async def test_render_limits_concurrent_renders(monkeypatch):
    """Fix 7: no more than _MAX_CONCURRENT_RENDERS run at the same time."""
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

    monkeypatch.setattr(worker_main, "run_render", slow_run_render)

    transport = ASGITransport(app=app)

    async def one_request():
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            async with client.stream(
                "POST", "/render", json={"yaml_content": "cv: {}"}
            ) as response:
                async for _ in response.aiter_bytes():
                    pass

    tasks = [asyncio.create_task(one_request()) for _ in range(5)]
    # Let the semaphore admit as many as it will before anything completes.
    for _ in range(20):
        await asyncio.sleep(0)
    observed_peak = peak
    release.set()
    await asyncio.gather(*tasks)

    assert observed_peak <= worker_main._MAX_CONCURRENT_RENDERS
    assert observed_peak >= 1
    assert peak <= worker_main._MAX_CONCURRENT_RENDERS
