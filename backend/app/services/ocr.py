import base64
import json
import logging
import re

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class OcrError(RuntimeError):
    """Any failure to obtain fields from the model: transport, status, parse."""


class DoctorFields(BaseModel):
    doctor_name: str | None = None
    doctor_degrees: str | None = None
    doctor_specializations: str | None = None


PROMPT = """You are reading a photograph of a doctor's nameplate from a hospital in Bangladesh.

Return ONLY a JSON object with exactly these three keys:
  "doctor_name", "doctor_degrees", "doctor_specializations"

Rules:
- Use null for anything the nameplate does not clearly show. Never guess.
- doctor_name: the person's name as printed, without the "Dr." honorific.
- doctor_degrees: the qualifications exactly as printed, e.g. "MBBS, FCPS (Medicine)".
- doctor_specializations: the stated specialty or department, e.g. "Cardiology".
- The text may be Bangla, English, or both. Transcribe it as printed.
- No commentary, no explanation, no markdown."""

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)
_OBJECT = re.compile(r"\{.*\}", re.S)


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _parse(content: str) -> DoctorFields:
    """Tolerant on purpose: models return fenced JSON and chatty preambles
    regardless of what the prompt asks for."""
    candidate = content.strip()
    fenced = _FENCE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()
    else:
        obj = _OBJECT.search(candidate)
        if obj:
            candidate = obj.group(0)

    try:
        raw = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise OcrError(f"could not parse model output as JSON: {content[:200]}") from exc
    if not isinstance(raw, dict):
        raise OcrError(f"could not parse model output as an object: {content[:200]}")

    try:
        fields = DoctorFields.model_validate(
            {k: raw.get(k) for k in DoctorFields.model_fields}
        )
    except ValidationError as exc:
        raise OcrError(f"could not parse model output: {exc}") from exc

    return DoctorFields(
        doctor_name=_blank_to_none(fields.doctor_name),
        doctor_degrees=_blank_to_none(fields.doctor_degrees),
        doctor_specializations=_blank_to_none(fields.doctor_specializations),
    )


def _payload(image: bytes, content_type: str) -> dict:
    # Inline base64, not a URL: OpenRouter fetches images from its own servers,
    # and a presigned RustFS link points at an address only we can reach.
    encoded = base64.b64encode(image).decode()
    return {
        "model": settings.ocr_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{content_type};base64,{encoded}"},
                    },
                ],
            }
        ],
    }


async def _ask(client: httpx.AsyncClient, payload: dict) -> str:
    try:
        resp = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            timeout=settings.ocr_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        raise OcrError(f"request to OpenRouter failed: {exc}") from exc

    if resp.status_code != 200:
        raise OcrError(f"OpenRouter returned {resp.status_code}: {resp.text[:200]}")

    try:
        return resp.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        raise OcrError(f"unexpected OpenRouter response shape: {exc}") from exc


async def extract_doctor_fields(
    image: bytes,
    content_type: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> DoctorFields:
    """Read a nameplate. Raises OcrError on any failure.

    Knows nothing about surveys, the database, or HTTP routing - which is what
    lets the same function serve the background worker, an inline call during
    submit, and a detached service.
    """
    payload = _payload(image, content_type)
    owned = client is None
    http = client or httpx.AsyncClient()
    try:
        content = await _ask(http, payload)
        try:
            return _parse(content)
        except OcrError:
            # One retry: a malformed response is often transient. A status
            # error is not, and is not retried here.
            logger.warning("unparseable OCR response, retrying once")
            return _parse(await _ask(http, payload))
    finally:
        if owned:
            await http.aclose()
