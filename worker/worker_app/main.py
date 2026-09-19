import base64
from collections.abc import AsyncIterator
from importlib.metadata import version

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from rendercv_web_schemas.models import RenderRequest
from rendercv_web_schemas.sse import format_sse_event

from worker_app.executor import LogLine, RenderFailure, RenderSuccess, run_render

app = FastAPI()


@app.get("/version")
async def get_version() -> dict[str, str]:
    return {"rendercv_version": version("rendercv")}


@app.post("/render")
async def render(payload: RenderRequest) -> StreamingResponse:
    image = None
    if payload.image_filename is not None and payload.image_base64 is not None:
        image = (payload.image_filename, base64.b64decode(payload.image_base64))

    async def event_stream() -> AsyncIterator[bytes]:
        async for event in run_render(payload.yaml_content, image=image):
            if isinstance(event, LogLine):
                yield format_sse_event("log", {"line": event.text})
            elif isinstance(event, RenderSuccess):
                pdf_b64 = base64.b64encode(event.pdf_bytes).decode("ascii")
                yield format_sse_event("result", {"status": "success", "pdf_base64": pdf_b64})
            elif isinstance(event, RenderFailure):
                yield format_sse_event("result", {"status": "error", "message": event.message})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
