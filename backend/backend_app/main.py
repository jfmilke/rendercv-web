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
