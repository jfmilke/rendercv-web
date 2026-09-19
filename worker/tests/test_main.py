from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

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
