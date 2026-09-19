from rendercv_web_schemas.models import RenderRequest


def test_render_request_allows_omitting_image_fields():
    request = RenderRequest(yaml_content="cv:\n  name: Test\n")
    assert request.image_filename is None
    assert request.image_base64 is None


def test_render_request_round_trips_through_json():
    request = RenderRequest(
        yaml_content="cv:\n  name: Test\n", image_filename="me.png", image_base64="AAAA"
    )
    restored = RenderRequest.model_validate_json(request.model_dump_json())
    assert restored == request
