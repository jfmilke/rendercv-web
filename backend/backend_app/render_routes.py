import asyncio
import base64
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from backend_app.config import settings
from backend_app.executor import LogLine, RenderFailure, RenderSuccess, run_render
from backend_app.session_cache import session_image_cache
from backend_app.sse import format_sse_event

router = APIRouter()

# RLIMIT_NPROC is a per-UID limit enforced across the whole container, and the
# container's memory limit is shared too, so concurrent renders compete for one
# budget and can make each other fail spuriously. Bound how many run at once.
_MAX_CONCURRENT_RENDERS = 2
_render_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_RENDERS)


async def _read_body_with_limit(request: Request, max_bytes: int) -> bytes:
    """Accumulate the request body, aborting the moment it exceeds `max_bytes`.

    `request.json()` would buffer the whole body first, which a client can make
    unbounded simply by using chunked transfer-encoding (no Content-Length).
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(status_code=413, detail="Request body too large")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/render")
async def render(request: Request) -> StreamingResponse:
    max_body_bytes = settings.max_yaml_bytes + 10_000

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            content_length_value = int(content_length)
        except ValueError:
            raise HTTPException(status_code=413, detail="Invalid Content-Length header") from None
        if content_length_value > max_body_bytes:
            raise HTTPException(status_code=413, detail="Request body too large")

    raw_body = await _read_body_with_limit(request, max_body_bytes)
    try:
        body = json.loads(raw_body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=422, detail="Invalid JSON body") from None
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="Invalid JSON body")

    yaml_content = body.get("yaml_content")
    if not isinstance(yaml_content, str):
        raise HTTPException(status_code=422, detail="yaml_content must be a string")
    if len(yaml_content.encode("utf-8")) > settings.max_yaml_bytes:
        raise HTTPException(status_code=413, detail="yaml_content exceeds maximum size")

    session_id = request.headers.get("x-session-id")
    cached_image = session_image_cache.get(session_id) if session_id else None
    image = (cached_image.filename, cached_image.content) if cached_image else None

    async def event_stream() -> AsyncIterator[bytes]:
        try:
            async with _render_semaphore:
                async for event in run_render(
                    yaml_content, image=image, timeout_seconds=settings.render_timeout_seconds
                ):
                    if isinstance(event, LogLine):
                        yield format_sse_event("log", {"line": event.text})
                    elif isinstance(event, RenderSuccess):
                        pdf_b64 = base64.b64encode(event.pdf_bytes).decode("ascii")
                        yield format_sse_event(
                            "result", {"status": "success", "pdf_base64": pdf_b64}
                        )
                    elif isinstance(event, RenderFailure):
                        yield format_sse_event(
                            "result", {"status": "error", "message": event.message}
                        )
        except Exception as exc:  # noqa: BLE001 - must always terminate the SSE stream
            # Without a terminal `result` event the client waits forever, so any
            # unexpected failure is reported as one instead of silently ending.
            yield format_sse_event("result", {"status": "error", "message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
