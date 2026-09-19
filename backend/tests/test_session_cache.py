from backend_app.session_cache import SessionImageCache


def make_clock(start: float = 0.0):
    state = {"now": start}

    def clock() -> float:
        return state["now"]

    def advance(seconds: float) -> None:
        state["now"] += seconds

    return clock, advance


def test_put_then_get_returns_the_same_image():
    clock, _ = make_clock()
    cache = SessionImageCache(ttl_seconds=100, max_sessions=10, clock=clock)

    cache.put("session-1", "me.jpg", b"fake-bytes")

    cached = cache.get("session-1")
    assert cached is not None
    assert cached.filename == "me.jpg"
    assert cached.content == b"fake-bytes"


def test_put_replaces_previous_image_for_same_session():
    clock, _ = make_clock()
    cache = SessionImageCache(ttl_seconds=100, max_sessions=10, clock=clock)

    cache.put("session-1", "old.jpg", b"old-bytes")
    cache.put("session-1", "new.png", b"new-bytes")

    cached = cache.get("session-1")
    assert cached.filename == "new.png"
    assert cached.content == b"new-bytes"


def test_get_returns_none_for_unknown_session():
    clock, _ = make_clock()
    cache = SessionImageCache(ttl_seconds=100, max_sessions=10, clock=clock)

    assert cache.get("unknown") is None


def test_entry_expires_after_ttl():
    clock, advance = make_clock()
    cache = SessionImageCache(ttl_seconds=10, max_sessions=10, clock=clock)

    cache.put("session-1", "me.jpg", b"bytes")
    advance(11)

    assert cache.get("session-1") is None


def test_delete_removes_entry():
    clock, _ = make_clock()
    cache = SessionImageCache(ttl_seconds=100, max_sessions=10, clock=clock)

    cache.put("session-1", "me.jpg", b"bytes")
    cache.delete("session-1")

    assert cache.get("session-1") is None


def test_oldest_session_evicted_when_max_sessions_exceeded():
    clock, advance = make_clock()
    cache = SessionImageCache(ttl_seconds=1000, max_sessions=2, clock=clock)

    cache.put("session-1", "a.jpg", b"a")
    advance(1)
    cache.put("session-2", "b.jpg", b"b")
    advance(1)
    cache.put("session-3", "c.jpg", b"c")

    assert cache.get("session-1") is None
    assert cache.get("session-2") is not None
    assert cache.get("session-3") is not None
