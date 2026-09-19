from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import Response
from httpx import ASGITransport, AsyncClient

import backend_app.render_routes as render_routes
from backend_app.render_routes import router
from worker_app.main import app as worker_app

app = FastAPI()
app.include_router(router)

FIXTURES = Path(__file__).resolve().parents[2] / "worker" / "tests" / "fixtures"


@pytest.fixture(autouse=True)
def use_in_process_worker():
    render_routes.worker_transport_override = ASGITransport(app=worker_app)
    yield
    render_routes.worker_transport_override = None


@pytest.mark.asyncio
async def test_render_relays_success_from_worker():
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
async def test_render_rejects_oversized_yaml_without_calling_worker():
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
async def test_render_surfaces_worker_non_200_as_sse_error_event():
    """Fix 4: a non-200 from the worker must become a terminal SSE result event."""
    failing_worker = FastAPI()

    @failing_worker.post("/render")
    async def _fail() -> Response:
        return Response(content="validation exploded", status_code=422)

    render_routes.worker_transport_override = ASGITransport(app=failing_worker)
    transport = ASGITransport(app=app)
    body = b""
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        async with client.stream("POST", "/render", json={"yaml_content": "cv: {}"}) as response:
            assert response.status_code == 200
            async for chunk in response.aiter_bytes():
                body += chunk

    text = body.decode("utf-8")
    assert "event: result" in text
    assert '"status": "error"' in text
    assert "Worker returned 422" in text
    assert "validation exploded" in text


@pytest.mark.asyncio
async def test_render_rejects_oversized_chunked_body_without_content_length():
    """Fix 6: the size cap must hold when Content-Length is absent (chunked body)."""
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
    """Fix 6: malformed JSON is a clean 422, not an unhandled 500."""
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
    """Fix 6: a non-UTF-8 payload is rejected cleanly rather than crashing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/render",
            content=b'{"yaml_content": "\xff\xfe invalid"}',
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 422
