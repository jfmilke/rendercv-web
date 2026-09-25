from backend_app.sse import format_sse_event


def test_format_sse_event_produces_valid_frame():
    frame = format_sse_event("log", {"line": "hello"})
    assert frame == b'event: log\ndata: {"line": "hello"}\n\n'


def test_format_sse_event_escapes_embedded_newlines():
    frame = format_sse_event("result", {"message": "line1\nline2"})
    text = frame.decode("utf-8")
    lines = text.split("\n")
    assert lines[0] == "event: result"
    assert lines[1].startswith("data: ")
    assert "\\n" in lines[1]
