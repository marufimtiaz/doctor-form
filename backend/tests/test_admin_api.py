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


async def test_every_admin_route_rejects_an_agent(client, make_user):
    agent = await make_user(role="agent")
    for method, path in [
        ("get", "/api/admin/surveys"),
        ("get", "/api/admin/stats"),
        ("delete", f"/api/admin/surveys/{agent.id}"),
    ]:
        resp = await getattr(client, method)(path, headers=auth(agent))
        assert resp.status_code == 403, f"{method} {path} returned {resp.status_code}"


async def test_admin_sees_every_agents_surveys_with_names(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    a = await make_user(name="Karim")
    b = await make_user(name="Rahim")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    resp = await client.get("/api/admin/surveys", headers=auth(admin))
    assert resp.status_code == 200
    assert {row["agent_name"] for row in resp.json()} == {"Karim", "Rahim"}


async def test_admin_can_filter_by_agent_and_district(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    a = await make_user(name="Karim")
    b = await make_user(name="Rahim")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post(
        "/api/surveys", data=form(district="Gulshan"), files=nameplate(), headers=auth(b)
    )

    by_agent = await client.get(f"/api/admin/surveys?user_id={a.id}", headers=auth(admin))
    assert len(by_agent.json()) == 1
    assert by_agent.json()[0]["agent_name"] == "Karim"

    by_district = await client.get("/api/admin/surveys?district=Gulshan", headers=auth(admin))
    assert len(by_district.json()) == 1
    assert by_district.json()[0]["agent_name"] == "Rahim"


async def test_admin_stats_break_down_per_agent(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    a = await make_user(name="Karim")
    b = await make_user(name="Rahim")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    stats = (await client.get("/api/admin/stats", headers=auth(admin))).json()
    assert stats["total"] == 3
    assert stats["today"] == 3
    assert sum(row["total"] for row in stats["per_agent"]) == stats["total"]
    assert {row["name"]: row["total"] for row in stats["per_agent"]} == {"Karim": 1, "Rahim": 2}
    assert {row["name"]: row["today"] for row in stats["per_agent"]} == {"Karim": 1, "Rahim": 2}


async def test_delete_is_soft_and_keeps_the_nameplate(client, make_user, s3):
    from app.core.config import get_settings
    from app.services import storage

    admin = await make_user(role="admin", name="Boss")
    agent = await make_user()
    created = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    survey_id = created.json()["id"]
    key = created.json()["nameplate_key"]

    resp = await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))
    assert resp.status_code == 204

    # The row survives with a timestamp; the audit trail is intact.
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(survey_id))
        assert row is not None
        assert row.deleted_at is not None

    # And the object is still in storage.
    storage.get_s3_client().head_object(Bucket=get_settings().s3_bucket, Key=key)


async def test_deleted_surveys_are_hidden_by_default_and_visible_on_request(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    agent = await make_user()
    created = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    survey_id = created.json()["id"]
    await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))

    assert (await client.get("/api/admin/surveys", headers=auth(admin))).json() == []
    assert (await client.get("/api/admin/stats", headers=auth(admin))).json()["total"] == 0

    included = await client.get("/api/admin/surveys?include_deleted=true", headers=auth(admin))
    assert len(included.json()) == 1


async def test_deleting_twice_is_a_404(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    agent = await make_user()
    created = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    survey_id = created.json()["id"]

    first = await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))
    assert first.status_code == 204
    second = await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))
    assert second.status_code == 404


async def test_admins_own_surveys_are_included_in_the_totals(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(admin))

    stats = (await client.get("/api/admin/stats", headers=auth(admin))).json()
    assert stats["total"] == 1
    assert {row["name"] for row in stats["per_agent"]} == {"Boss"}


async def test_date_filter_uses_the_configured_timezone(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    agent = await make_user()
    created = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(created.json()["id"]))
        # 18:30Z on the 26th = 00:30 Dhaka on the 27th.
        row.created_at = datetime(2026, 8, 26, 18, 30, tzinfo=UTC)
        session.add(row)
        await session.commit()

    on_27th = await client.get(
        "/api/admin/surveys?date_from=2026-08-27&date_to=2026-08-27", headers=auth(admin)
    )
    assert len(on_27th.json()) == 1

    on_26th = await client.get(
        "/api/admin/surveys?date_from=2026-08-26&date_to=2026-08-26", headers=auth(admin)
    )
    assert on_26th.json() == []
