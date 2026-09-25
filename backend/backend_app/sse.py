import json
from typing import Any


def format_sse_event(event: str, data: dict[str, Any]) -> bytes:
    payload = json.dumps(data)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")
