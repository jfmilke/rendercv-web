import time
from collections.abc import Callable
from dataclasses import dataclass

from backend_app.config import settings


@dataclass
class CachedImage:
    filename: str
    content: bytes
    stored_at: float


class SessionImageCache:
    def __init__(
        self,
        ttl_seconds: float,
        max_sessions: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._max_sessions = max_sessions
        self._clock = clock
        self._store: dict[str, CachedImage] = {}

    def put(self, session_id: str, filename: str, content: bytes) -> None:
        self._evict_expired()
        if session_id not in self._store and len(self._store) >= self._max_sessions:
            oldest_id = min(self._store, key=lambda k: self._store[k].stored_at)
            del self._store[oldest_id]
        self._store[session_id] = CachedImage(
            filename=filename, content=content, stored_at=self._clock()
        )

    def get(self, session_id: str) -> CachedImage | None:
        self._evict_expired()
        return self._store.get(session_id)

    def delete(self, session_id: str) -> None:
        self._store.pop(session_id, None)

    def _evict_expired(self) -> None:
        now = self._clock()
        expired = [
            sid for sid, img in self._store.items() if now - img.stored_at > self._ttl_seconds
        ]
        for sid in expired:
            del self._store[sid]


session_image_cache = SessionImageCache(
    ttl_seconds=settings.session_ttl_seconds, max_sessions=settings.max_sessions
)
