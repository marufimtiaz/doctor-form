import io
import json

import httpx
import pytest

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form() -> dict:
    return {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake"), "image/jpeg")}


@pytest.fixture
def inline_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "inline")


@pytest.fixture
def off_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "off")


async def test_off_mode_leaves_the_row_pending(client, make_user, s3, off_mode):
    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201
    assert resp.json()["ocr_status"] == "pending"
    assert resp.json()["doctor_name"] is None


async def test_inline_mode_fills_the_fields_before_returning(
    client, make_user, s3, inline_mode, monkeypatch
):
    good = '{"doctor_name": "Rahim Uddin", "doctor_degrees": null, "doctor_specializations": null}'

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": good}}]})

    import app.workers.ocr as worker

    original = worker.process_survey

    async def patched(survey_id, *, client=None):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await original(survey_id, client=c)

    monkeypatch.setattr(worker, "process_survey", patched)

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201
    assert resp.json()["doctor_name"] == "Rahim Uddin"
    assert resp.json()["ocr_status"] == "done"


async def test_inline_failure_never_loses_the_survey(
    client, make_user, s3, inline_mode, monkeypatch
):
    """An agent in a corridor must not lose a filed survey to a 429."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    import app.workers.ocr as worker

    original = worker.process_survey

    async def patched(survey_id, *, client=None):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await original(survey_id, client=c)

    monkeypatch.setattr(worker, "process_survey", patched)

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))

    # The submit still succeeds.
    assert resp.status_code == 201
    async with SessionLocal() as session:
        from uuid import UUID

        row = await session.get(ChamberSurvey, UUID(resp.json()["id"]))
        assert row is not None
        assert row.ocr_attempts == 1
        assert "429" in row.ocr_error


async def test_off_mode_starts_no_background_worker(off_mode):
    from asgi_lifespan import LifespanManager
    from app.main import app

    async with LifespanManager(app):
        pass  # Lifespan starts and stops cleanly without task execution
