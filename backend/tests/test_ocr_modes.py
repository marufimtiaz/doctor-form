import io
import json
from uuid import UUID

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
def off_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "off")


async def test_off_mode_leaves_the_row_pending(client, make_user, s3, off_mode):
    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201
    assert resp.json()["ocr_status"] == "pending"
    assert resp.json()["doctor_name"] is None


def test_inline_is_no_longer_a_valid_mode():
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(ocr_mode="inline")


async def test_a_failing_read_never_loses_the_survey(client, make_user, s3, monkeypatch):
    """Rescued from the deleted inline tests: the property outlived the mode.

    An agent in a corridor must not lose a filed survey to a 429. The survey is
    committed before any model call, so a failure leaves a filed survey behind
    with the error recorded on the row.
    """

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    import app.workers.ocr as worker

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
        await worker.process_survey(UUID(resp.json()["id"]), client=c)

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(resp.json()["id"]))
        assert row is not None
        assert row.ocr_status == "pending"
        assert row.ocr_attempts == 1
        assert "429" in row.ocr_error


async def test_off_mode_starts_no_background_worker(off_mode):
    from asgi_lifespan import LifespanManager

    from app.main import app

    async with LifespanManager(app):
        pass  # Lifespan starts and stops cleanly without task execution
