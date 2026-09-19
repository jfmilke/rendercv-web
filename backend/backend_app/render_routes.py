import base64
from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from rendercv_web_schemas.models import RenderRequest
from rendercv_web_schemas.sse import format_sse_event

from backend_app.config import settings
from backend_app.session_cache import session_image_cache

router = APIRouter()

# Test seam: tests point this at an httpx.ASGITransport wrapping the worker
# app in-process, instead of making a real network call to settings.worker_url.
worker_transport_override: httpx.AsyncBaseTransport | None = None


@router.post("/render")
async def render(request: Request) -> StreamingResponse:
    content_length = request.headers.get("content-length")
    if content_length is not None and int(content_length) > settings.max_yaml_bytes + 10_000:
        raise HTTPException(status_code=413, detail="Request body too large")

    body = await request.json()
    yaml_content = body.get("yaml_content")
    if not isinstance(yaml_content, str):
        raise HTTPException(status_code=422, detail="yaml_content must be a string")
    if len(yaml_content.encode("utf-8")) > settings.max_yaml_bytes:
        raise HTTPException(status_code=413, detail="yaml_content exceeds maximum size")

    session_id = request.headers.get("x-session-id")
    cached_image = session_image_cache.get(session_id) if session_id else None

    render_request = RenderRequest(
        yaml_content=yaml_content,
        image_filename=cached_image.filename if cached_image else None,
        image_base64=(
            base64.b64encode(cached_image.content).decode("ascii") if cached_image else None
        ),
    )

    async def relay() -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(
            base_url=settings.worker_url,
            timeout=settings.render_timeout_seconds + 5,
            transport=worker_transport_override,
        ) as client:
            try:
                async with client.stream(
                    "POST", "/render", json=render_request.model_dump()
                ) as worker_response:
                    async for chunk in worker_response.aiter_bytes():
                        yield chunk
            except httpx.RequestError as exc:
                yield format_sse_event(
                    "result",
                    {"status": "error", "message": f"Could not reach render worker: {exc}"},
                )

    return StreamingResponse(relay(), media_type="text/event-stream")
