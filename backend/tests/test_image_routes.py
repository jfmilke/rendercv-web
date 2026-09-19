import base64

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend_app.config import settings
from backend_app.image_routes import router
from backend_app.session_cache import session_image_cache

app = FastAPI()
app.include_router(router)

_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY"
    "42YAAAAASUVORK5CYII="
)


@pytest.fixture(autouse=True)
def enable_image_upload():
    original = settings.image_upload_enabled
    settings.image_upload_enabled = True
    yield
    settings.image_upload_enabled = original


@pytest.mark.asyncio
async def test_upload_valid_png_is_accepted_and_cached():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/image",
            files={"file": ("me.png", _TINY_PNG, "image/png")},
            headers={"X-Session-Id": "session-1"},
        )

    assert response.status_code == 200
    assert response.json() == {"filename": "me.png"}
    cached = session_image_cache.get("session-1")
    assert cached is not None
    assert cached.content == _TINY_PNG


@pytest.mark.asyncio
async def test_upload_rejects_non_image_content():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/image",
            files={"file": ("me.png", b"not an image", "image/png")},
            headers={"X-Session-Id": "session-1"},
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_upload_rejects_mismatched_extension():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/image",
            files={"file": ("me.jpg", _TINY_PNG, "image/jpeg")},
            headers={"X-Session-Id": "session-1"},
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_upload_strips_path_components_from_filename():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/image",
            files={"file": ("../../etc/passwd.png", _TINY_PNG, "image/png")},
            headers={"X-Session-Id": "session-1"},
        )

    assert response.status_code == 200
    assert response.json() == {"filename": "passwd.png"}


@pytest.mark.asyncio
async def test_upload_rejects_overlong_filename():
    long_name = "a" * 150 + ".png"
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/image",
            files={"file": (long_name, _TINY_PNG, "image/png")},
            headers={"X-Session-Id": "session-1"},
        )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_upload_requires_session_id_header():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/image", files={"file": ("me.png", _TINY_PNG, "image/png")}
        )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_image_endpoints_404_when_feature_disabled():
    settings.image_upload_enabled = False
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/image",
            files={"file": ("me.png", _TINY_PNG, "image/png")},
            headers={"X-Session-Id": "session-1"},
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_delete_removes_cached_image():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/image",
            files={"file": ("me.png", _TINY_PNG, "image/png")},
            headers={"X-Session-Id": "session-1"},
        )
        response = await client.delete("/image", headers={"X-Session-Id": "session-1"})

    assert response.status_code == 200
    assert session_image_cache.get("session-1") is None
