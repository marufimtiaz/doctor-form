import httpx
import pytest

from app.services.ocr import DoctorFields, OcrError, extract_doctor_fields

IMAGE = b"\xff\xd8\xff-fake-jpeg"


def reply(content: str, status: int = 200) -> httpx.AsyncClient:
    """An OpenRouter stand-in that returns `content` as the message body."""

    def handler(request: httpx.Request) -> httpx.Response:
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "boom"}})
        return httpx.Response(
            200, json={"choices": [{"message": {"content": content}}]}
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_clean_json_is_parsed():
    body = (
        '{"doctor_name": "Rahim Uddin", '
        '"doctor_degrees": "MBBS, FCPS (Medicine)", '
        '"doctor_specializations": "Cardiology"}'
    )
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields == DoctorFields(
        doctor_name="Rahim Uddin",
        doctor_degrees="MBBS, FCPS (Medicine)",
        doctor_specializations="Cardiology",
    )


async def test_json_inside_a_code_fence_is_parsed():
    """Models return fenced JSON no matter how the prompt is worded."""
    body = '```json\n{"doctor_name": "Rahim Uddin"}\n```'
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_name == "Rahim Uddin"
    assert fields.doctor_degrees is None


async def test_json_with_surrounding_prose_is_parsed():
    body = 'Here is what I found:\n{"doctor_name": "Rahim Uddin"}\nHope that helps!'
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_name == "Rahim Uddin"


async def test_explicit_nulls_stay_none():
    """The prompt asks for null rather than a guess; that must survive."""
    body = (
        '{"doctor_name": "Rahim Uddin", "doctor_degrees": null, '
        '"doctor_specializations": null}'
    )
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_degrees is None
    assert fields.doctor_specializations is None


async def test_empty_strings_are_normalised_to_none():
    """A blank string would render as an empty field rather than 'pending'."""
    body = '{"doctor_name": "Rahim Uddin", "doctor_degrees": "", "doctor_specializations": "  "}'
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_degrees is None
    assert fields.doctor_specializations is None


async def test_prose_with_no_json_raises_after_one_retry():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "I cannot read this."}}]}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(OcrError, match="could not parse"):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    # One retry, not an unbounded loop.
    assert calls == 2


async def test_rate_limiting_raises_without_retrying():
    async with reply("", status=429) as client:
        with pytest.raises(OcrError, match="429"):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)


async def test_server_error_raises():
    async with reply("", status=500) as client:
        with pytest.raises(OcrError, match="500"):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)


async def test_a_timeout_becomes_an_ocr_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(OcrError):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)


async def test_the_image_is_sent_inline_as_a_data_uri():
    """Not a URL: OpenRouter cannot reach this network's object storage."""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json

        captured.update(_json.loads(request.content))
        return httpx.Response(
            200, json={"choices": [{"message": {"content": '{"doctor_name": "X"}'}}]}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await extract_doctor_fields(IMAGE, "image/jpeg", client=client)

    parts = captured["messages"][0]["content"]
    image_part = next(p for p in parts if p["type"] == "image_url")
    assert image_part["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "localhost" not in image_part["image_url"]["url"]
