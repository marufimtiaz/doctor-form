import io
import json
from uuid import uuid4

import pytest

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
async def filed(client, make_user, s3):
    agent = await make_user(name="Karim")
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    return resp.json()["id"]


async def test_admin_can_correct_the_doctor_fields(client, make_user, filed):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.patch(
        f"/api/admin/surveys/{filed}/doctor",
        json={
            "doctor_name": "Rahim Uddin",
            "doctor_degrees": "MBBS, FCPS (Medicine)",
            "doctor_specializations": "Cardiology",
        },
        headers=auth(admin),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["doctor_name"] == "Rahim Uddin"
    # A human correction is authoritative: the row is done, not pending.
    assert body["ocr_status"] == "done"
    assert body["ocr_error"] is None


async def test_an_agent_cannot_correct_them(client, make_user, filed):
    agent = await make_user(role="agent", name="Other")
    resp = await client.patch(
        f"/api/admin/surveys/{filed}/doctor",
        json={"doctor_name": "X", "doctor_degrees": None, "doctor_specializations": None},
        headers=auth(agent),
    )
    assert resp.status_code == 403


async def test_reread_returns_the_row_to_the_queue(client, make_user, filed):
    from uuid import UUID

    admin = await make_user(role="admin", name="Boss")
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(filed))
        row.ocr_status = "failed"
        row.ocr_attempts = 3
        row.ocr_error = "OpenRouter returned 500"
        session.add(row)
        await session.commit()

    resp = await client.post(f"/api/admin/surveys/{filed}/reread", headers=auth(admin))
    assert resp.status_code == 204

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(filed))
        assert row.ocr_status == "pending"
        assert row.ocr_attempts == 0
        assert row.ocr_error is None
        assert row.ocr_next_attempt_at is None


async def test_an_agent_cannot_trigger_a_reread(client, make_user, filed):
    agent = await make_user(role="agent", name="Other")
    resp = await client.post(f"/api/admin/surveys/{filed}/reread", headers=auth(agent))
    assert resp.status_code == 403


async def test_correcting_an_unknown_survey_is_a_404(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.patch(
        f"/api/admin/surveys/{uuid4()}/doctor",
        json={"doctor_name": "X", "doctor_degrees": None, "doctor_specializations": None},
        headers=auth(admin),
    )
    assert resp.status_code == 404


async def test_admin_listing_exposes_attempts_and_error(client, make_user, filed):
    from uuid import UUID

    admin = await make_user(role="admin", name="Boss")
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(filed))
        row.ocr_status = "failed"
        row.ocr_attempts = 3
        row.ocr_error = "OpenRouter returned 429"
        session.add(row)
        await session.commit()

    resp = await client.get("/api/admin/surveys", headers=auth(admin))
    (row,) = [r for r in resp.json() if r["id"] == filed]
    assert row["ocr_attempts"] == 3
    assert row["ocr_error"] == "OpenRouter returned 429"
