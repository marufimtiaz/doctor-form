import io
import json
from datetime import UTC, datetime
from uuid import UUID

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form(**overrides) -> dict:
    data = {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }
    data.update(overrides)
    return data


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake-jpeg"), "image/jpeg")}


async def test_creating_a_survey_stores_children_and_uploads_the_nameplate(client, make_user, s3):
    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["user_id"] == str(agent.id)
    assert body["ocr_status"] == "pending"
    assert body["doctor_name"] is None
    assert body["phones"] == ["+8801712345678"]
    assert body["slots"] == [{"day_of_week": 5, "start_time": "17:00:00", "end_time": "20:00:00"}]
    assert body["nameplate_key"].startswith("surveys/")
    assert body["nameplate_url"]


async def test_the_nameplate_is_required(client, make_user, s3):
    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), headers=auth(agent))
    assert resp.status_code == 422


async def test_user_id_in_the_body_is_ignored(client, make_user, s3):
    agent = await make_user()
    other = await make_user(name="Other")
    resp = await client.post(
        "/api/surveys", data=form(user_id=str(other.id)), files=nameplate(), headers=auth(agent)
    )
    assert resp.status_code == 201
    assert resp.json()["user_id"] == str(agent.id)


async def test_a_survey_with_no_location_is_rejected(client, make_user, s3):
    agent = await make_user()
    data = form()
    del data["city"]
    del data["district"]
    resp = await client.post("/api/surveys", data=data, files=nameplate(), headers=auth(agent))
    assert resp.status_code == 422


async def test_an_agent_sees_only_their_own_surveys(client, make_user, s3):
    a = await make_user(name="A")
    b = await make_user(name="B")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    resp = await client.get("/api/surveys", headers=auth(a))
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["user_id"] == str(a.id)


async def test_fetching_someone_elses_survey_is_a_404_not_a_403(client, make_user, s3):
    a = await make_user(name="A")
    b = await make_user(name="B")
    created = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    survey_id = created.json()["id"]

    resp = await client.get(f"/api/surveys/{survey_id}", headers=auth(b))
    # 403 would confirm the id exists. 404 tells them nothing.
    assert resp.status_code == 404


async def test_stats_route_is_not_shadowed_by_the_detail_route(client, make_user, s3):
    agent = await make_user()
    resp = await client.get("/api/surveys/stats", headers=auth(agent))
    assert resp.status_code == 200
    assert resp.json() == {"total": 0, "today": 0}


async def test_stats_count_only_the_callers_surveys(client, make_user, s3):
    a = await make_user(name="A")
    b = await make_user(name="B")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    assert (await client.get("/api/surveys/stats", headers=auth(a))).json()["total"] == 1
    assert (await client.get("/api/surveys/stats", headers=auth(b))).json()["total"] == 2


async def test_today_uses_the_dhaka_day_not_the_utc_day(client, make_user, s3):
    """19:00Z on the 26th is 01:00 Dhaka on the 27th.

    Counted as a UTC day it would land on the 26th and every daily figure would
    be off by six hours' worth of surveys.
    """
    agent = await make_user()
    created = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    survey_id = created.json()["id"]

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(survey_id))
        row.created_at = datetime(2026, 8, 26, 19, 0, tzinfo=UTC)
        session.add(row)
        await session.commit()

    stats = (await client.get("/api/surveys/stats", headers=auth(agent))).json()
    assert stats["total"] == 1
    # "Today" is the real today, and the row was backdated, so it is excluded.
    assert stats["today"] == 0


async def test_unauthenticated_requests_are_rejected(client):
    assert (await client.get("/api/surveys")).status_code == 401
    assert (await client.get("/api/surveys/stats")).status_code == 401


async def test_the_uploaded_object_really_lands_in_the_bucket(client, make_user, s3):
    from app.core.config import get_settings
    from app.services import storage

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    key = resp.json()["nameplate_key"]

    head = storage.get_s3_client().head_object(Bucket=get_settings().s3_bucket, Key=key)
    assert head["ContentType"] == "image/jpeg"


async def test_deleted_surveys_are_hidden_from_the_agent(client, make_user, s3):
    agent = await make_user()
    created = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    survey_id = created.json()["id"]

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(survey_id))
        row.deleted_at = datetime.now(UTC)
        session.add(row)
        await session.commit()

    assert (await client.get("/api/surveys", headers=auth(agent))).json() == []
    assert (await client.get(f"/api/surveys/{survey_id}", headers=auth(agent))).status_code == 404
    assert (await client.get("/api/surveys/stats", headers=auth(agent))).json()["total"] == 0
