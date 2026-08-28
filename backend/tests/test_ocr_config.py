import io

import pytest

from app.core.config import Settings


def test_ocr_mode_defaults_to_worker(monkeypatch):
    monkeypatch.delenv("OCR_MODE", raising=False)
    assert Settings(_env_file=None).ocr_mode == "worker"


def test_ocr_mode_accepts_the_three_modes():
    for mode in ("worker", "inline", "off"):
        assert Settings(_env_file=None, ocr_mode=mode).ocr_mode == mode


def test_an_unknown_ocr_mode_is_rejected():
    # A typo'd mode must fail at boot, not silently disable extraction.
    with pytest.raises(ValueError, match="ocr_mode"):
        Settings(_env_file=None, ocr_mode="backgruond")


def test_a_missing_api_key_is_not_a_startup_failure():
    """Unlike JWT_SECRET: OCR enriches data, it does not gate the system."""
    settings = Settings(
        _env_file=None,
        debug=False,
        jwt_secret="x" * 40,
        admin_password="a-real-password",
        openrouter_api_key="",
    )
    assert settings.openrouter_api_key == ""


def test_default_model_is_a_vision_capable_gemma():
    assert Settings(_env_file=None).ocr_model == "google/gemma-4-31b-it"


async def test_download_object_round_trips_bytes_and_content_type(s3):
    from app.services import storage

    storage.upload_fileobj(io.BytesIO(b"\xff\xd8\xff-fake-jpeg"), "surveys/x.jpg", "image/jpeg")
    blob, content_type = storage.download_object("surveys/x.jpg")
    assert blob == b"\xff\xd8\xff-fake-jpeg"
    assert content_type == "image/jpeg"
