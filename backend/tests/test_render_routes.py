from pathlib import Path

import pytest
from fastapi import FastAPI
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
