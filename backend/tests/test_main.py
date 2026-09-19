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
    """Fix 14: the route listing must not be published."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(path)

    assert response.status_code == 404
