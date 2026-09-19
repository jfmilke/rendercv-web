from pathlib import Path

import httpx
from fastapi import FastAPI, Request

import backend_app.render_routes as render_routes_module
from backend_app.config import settings
from backend_app.image_routes import router as image_router
from backend_app.render_routes import router as render_router
from fastapi.staticfiles import StaticFiles

app = FastAPI()
app.include_router(render_router)
app.include_router(image_router)

# No CORS middleware: the frontend is served by this same app, so the
# absence of CORS headers is exactly what locks API access to same-origin.

_version_cache: dict[str, str] = {}


@app.get("/version")
async def get_version() -> dict[str, str]:
    if "rendercv_version" not in _version_cache:
        async with httpx.AsyncClient(
            base_url=settings.worker_url,
            timeout=5.0,
            transport=render_routes_module.worker_transport_override,
        ) as client:
            response = await client.get("/version")
            response.raise_for_status()
            _version_cache["rendercv_version"] = response.json()["rendercv_version"]
    return {"rendercv_version": _version_cache["rendercv_version"]}


@app.get("/config")
async def get_config() -> dict[str, bool]:
    return {"imageUploadEnabled": settings.image_upload_enabled}


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response


_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "static"
if _FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIST), html=True), name="frontend")
