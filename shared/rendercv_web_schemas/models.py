from pydantic import BaseModel


class RenderRequest(BaseModel):
    yaml_content: str
    image_filename: str | None = None
    image_base64: str | None = None
