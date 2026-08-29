import io
import json
from uuid import UUID

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from app.services.ocr import DoctorFields
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form(**extra) -> dict:
    base = {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }
    base.update(extra)
    return base


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake"), "image/jpeg")}


async def row_for(survey_id: str) -> ChamberSurvey:
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(survey_id))
    assert row is not None
    return row


async def test_approved_fields_are_stored_done_and_sourced_upload(client, make_user, s3):
    agent = await make_user()
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="Rahman", doctor_degrees="MBBS"),
        files=nameplate(),
        headers=auth(agent),
    )
    assert resp.status_code == 201

    row = await row_for(resp.json()["id"])
    assert row.doctor_name == "Rahman"
    assert row.doctor_degrees == "MBBS"
    assert row.ocr_status == "done"
    assert row.ocr_source == "upload"
    assert row.ocr_completed_at is not None


async def test_no_fields_leaves_the_row_for_the_worker(client, make_user, s3):
    agent = await make_user()
    resp = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )

    row = await row_for(resp.json()["id"])
    assert row.ocr_status == "pending"
    assert row.ocr_source is None


async def test_all_blank_fields_count_as_no_preview(client, make_user, s3):
    """A nameplate the model could not read must be retried, not recorded as a
    finished empty read."""
    agent = await make_user()
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="  ", doctor_degrees="", doctor_specializations=""),
        files=nameplate(),
        headers=auth(agent),
    )

    row = await row_for(resp.json()["id"])
    assert row.ocr_status == "pending"
    assert row.ocr_source is None


async def test_an_overlong_doctor_name_is_refused(client, make_user, s3):
    agent = await make_user()
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="x" * 201),
        files=nameplate(),
        headers=auth(agent),
    )
    assert resp.status_code == 422


async def test_the_worker_marks_its_own_rows(client, make_user, s3, monkeypatch):
    from app.workers import ocr as ocr_worker

    async def fake(image, content_type, *, client=None):
        return DoctorFields(doctor_name="Rahman")

    monkeypatch.setattr(ocr_worker, "extract_doctor_fields", fake)

    agent = await make_user()
    resp = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    survey_id = resp.json()["id"]

    await ocr_worker.process_survey(UUID(survey_id))

    row = await row_for(survey_id)
    assert row.ocr_status == "done"
    assert row.ocr_source == "worker"


async def test_an_admin_correction_is_sourced_admin(client, make_user, s3):
    agent = await make_user()
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    survey_id = resp.json()["id"]

    patched = await client.patch(
        f"/api/admin/surveys/{survey_id}/doctor",
        json={"doctor_name": "Corrected"},
        headers=auth(admin),
    )
    assert patched.status_code == 200
    assert patched.json()["ocr_source"] == "admin"


async def test_a_reread_clears_the_source(client, make_user, s3):
    agent = await make_user()
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="Rahman"),
        files=nameplate(),
        headers=auth(agent),
    )
    survey_id = resp.json()["id"]

    await client.post(f"/api/admin/surveys/{survey_id}/reread", headers=auth(admin))

    row = await row_for(survey_id)
    assert row.ocr_status == "pending"
    assert row.ocr_source is None
