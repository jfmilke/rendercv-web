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
