import asyncio
import base64
import os
from collections.abc import AsyncIterator
from importlib.metadata import version

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from rendercv_web_schemas.models import RenderRequest
from rendercv_web_schemas.sse import format_sse_event

from worker_app.executor import LogLine, RenderFailure, RenderSuccess, run_render

app = FastAPI()

# RLIMIT_NPROC is a per-UID limit enforced across the whole container, and the
# container's memory limit is shared too, so concurrent renders compete for one
# budget and can make each other fail spuriously. Bound how many run at once.
_MAX_CONCURRENT_RENDERS = 2
_render_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_RENDERS)


def _render_timeout_seconds() -> float:
    try:
        return float(os.environ.get("RENDER_TIMEOUT_SECONDS", "30"))
    except ValueError:
        return 30.0


@app.get("/version")
async def get_version() -> dict[str, str]:
    return {"rendercv_version": version("rendercv")}


@app.post("/render")
async def render(payload: RenderRequest) -> StreamingResponse:
    image = None
    if payload.image_filename is not None and payload.image_base64 is not None:
        image = (payload.image_filename, base64.b64decode(payload.image_base64))

    timeout_seconds = _render_timeout_seconds()

    async def event_stream() -> AsyncIterator[bytes]:
        try:
            async with _render_semaphore:
                async for event in run_render(
                    payload.yaml_content, image=image, timeout_seconds=timeout_seconds
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
