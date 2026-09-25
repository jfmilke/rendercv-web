import os


class Settings:
    def __init__(self) -> None:
        self.image_upload_enabled: bool = (
            os.environ.get("IMAGE_UPLOAD_ENABLED", "false").lower() == "true"
        )
        self.render_timeout_seconds: float = float(
            os.environ.get("RENDER_TIMEOUT_SECONDS", "30")
        )
        self.max_yaml_bytes: int = 256_000
        self.session_ttl_seconds: float = 2 * 60 * 60
        self.max_sessions: int = 20


settings = Settings()
