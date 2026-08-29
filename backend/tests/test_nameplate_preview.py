import io

import pytest
from sqlmodel import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from app.services import ocr as ocr_service
from app.services.ocr import DoctorFields
from tests.conftest import auth

URL = "/api/surveys/nameplate/preview"


def nameplate(size: int = 32) -> dict:
    return {
        "nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff" + b"x" * size), "image/jpeg")
    }


@pytest.fixture
def worker_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "worker")


@pytest.fixture
def off_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "off")


async def test_returns_the_fields_it_read(client, make_user, worker_mode, monkeypatch):
    async def fake(image, content_type, *, client=None):
        assert content_type == "image/jpeg"
        return DoctorFields(
            doctor_name="Rahman",
            doctor_degrees="MBBS, FCPS (Medicine)",
            doctor_specializations="Cardiology",
        )

    monkeypatch.setattr("app.api.surveys.extract_doctor_fields", fake)

    agent = await make_user()
    resp = await client.post(URL, files=nameplate(), headers=auth(agent))

    assert resp.status_code == 200
    assert resp.json() == {
        "doctor_name": "Rahman",
        "doctor_degrees": "MBBS, FCPS (Medicine)",
        "doctor_specializations": "Cardiology",
    }


async def test_creates_no_survey(client, make_user, worker_mode, monkeypatch):
    async def fake(image, content_type, *, client=None):
        return DoctorFields(doctor_name="Rahman")

    monkeypatch.setattr("app.api.surveys.extract_doctor_fields", fake)

    agent = await make_user()
    await client.post(URL, files=nameplate(), headers=auth(agent))

    async with SessionLocal() as session:
        rows = (await session.exec(select(ChamberSurvey))).all()
    assert rows == []


async def test_off_mode_returns_no_content(client, make_user, off_mode):
    agent = await make_user()
    resp = await client.post(URL, files=nameplate(), headers=auth(agent))
    assert resp.status_code == 204


async def test_an_ocr_failure_is_a_502(client, make_user, worker_mode, monkeypatch):
    async def boom(*args, **kwargs):
        raise ocr_service.OcrError("model exploded")

    monkeypatch.setattr("app.api.surveys.extract_doctor_fields", boom)

    agent = await make_user()
    resp = await client.post(URL, files=nameplate(), headers=auth(agent))
    assert resp.status_code == 502


async def test_an_oversized_image_is_refused(client, make_user, worker_mode):
    agent = await make_user()
    resp = await client.post(
        URL, files=nameplate(size=11 * 1024 * 1024), headers=auth(agent)
    )
    assert resp.status_code == 413


async def test_it_requires_authentication(client, worker_mode):
    resp = await client.post(URL, files=nameplate())
    assert resp.status_code == 401
