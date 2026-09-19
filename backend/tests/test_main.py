import pytest
from httpx import ASGITransport, AsyncClient

import backend_app.render_routes as render_routes
from backend_app.config import settings
from backend_app.main import app
from worker_app.main import app as worker_app


@pytest.fixture(autouse=True)
def use_in_process_worker():
    render_routes.worker_transport_override = ASGITransport(app=worker_app)
    yield
    render_routes.worker_transport_override = None


@pytest.mark.asyncio
async def test_version_returns_worker_rendercv_version():
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
