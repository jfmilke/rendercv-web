import re

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

from backend_app.config import settings
from backend_app.session_cache import session_image_cache

router = APIRouter()

_EXTENSIONS_BY_TYPE = {"jpeg": {"jpg", "jpeg"}, "png": {"png"}, "webp": {"webp"}}


def _sniff_image_type(content: bytes) -> str | None:
    if content.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"
    return None


def _sanitize_filename(raw_name: str, sniffed_type: str) -> str:
    basename = raw_name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if not basename or len(basename) > 100:
        raise ValueError("Filename must be between 1 and 100 characters")
    if not re.fullmatch(r"[A-Za-z0-9._-]+", basename):
        raise ValueError("Filename contains disallowed characters")
    if "." not in basename:
        raise ValueError("Filename must have an extension")
    extension = basename.rsplit(".", 1)[-1].lower()
    if extension not in _EXTENSIONS_BY_TYPE[sniffed_type]:
        raise ValueError("File extension does not match detected image type")
    return basename


def _require_feature_enabled() -> None:
    if not settings.image_upload_enabled:
        raise HTTPException(status_code=404, detail="Image upload is disabled")


def _require_session_id(x_session_id: str | None) -> str:
    if not x_session_id:
        raise HTTPException(status_code=400, detail="X-Session-Id header is required")
    return x_session_id


@router.post("/image")
async def upload_image(
    file: UploadFile = File(...),
    x_session_id: str | None = Header(default=None),
) -> dict[str, str]:
    _require_feature_enabled()
    session_id = _require_session_id(x_session_id)

    content = await file.read()
    sniffed_type = _sniff_image_type(content)
    if sniffed_type is None:
        raise HTTPException(
            status_code=422, detail="File is not a recognized jpg, png, or webp image"
        )

    try:
        safe_filename = _sanitize_filename(file.filename or "", sniffed_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    session_image_cache.put(session_id, safe_filename, content)
    return {"filename": safe_filename}


@router.delete("/image")
async def delete_image(x_session_id: str | None = Header(default=None)) -> dict[str, bool]:
    _require_feature_enabled()
    session_id = _require_session_id(x_session_id)
    session_image_cache.delete(session_id)
    return {"deleted": True}
