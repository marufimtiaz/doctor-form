from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from app.workers.ocr import claim_pending, process_survey, reap_stale, run_once


def reply(content: str, status: int = 200) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "boom"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


GOOD = (
    '{"doctor_name": "Rahim Uddin", "doctor_degrees": "MBBS, FCPS", '
    '"doctor_specializations": "Cardiology"}'
)


@pytest.fixture
async def survey(make_user, s3):
    """A pending survey whose nameplate really exists in storage."""
    import io

    from app.services import storage

    user = await make_user()
    key = "surveys/nameplate.jpg"
    storage.upload_fileobj(io.BytesIO(b"\xff\xd8\xff-fake"), key, "image/jpeg")

    async with SessionLocal() as session:
        row = ChamberSurvey(
            user_id=user.id,
            hospital_name="Square",
            city="Dhaka",
            district="Dhanmondi",
            nameplate_key=key,
            daily_patients=30,
            avg_duration_min=10,
            consultation_fee_bdt=1200,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def _reload(survey_id: UUID) -> ChamberSurvey:
    async with SessionLocal() as session:
        return await session.get(ChamberSurvey, survey_id)


async def test_claim_marks_rows_processing(survey):
    async with SessionLocal() as session:
        claimed = await claim_pending(session, 5)
    assert claimed == [survey.id]
    assert (await _reload(survey.id)).ocr_status == "processing"


async def test_a_claimed_row_is_not_claimed_again(survey):
    async with SessionLocal() as session:
        await claim_pending(session, 5)
    async with SessionLocal() as session:
        assert await claim_pending(session, 5) == []


async def test_a_successful_read_writes_all_three_fields(survey):
    async with reply(GOOD) as client:
        await process_survey(survey.id, client=client)

    row = await _reload(survey.id)
    assert row.doctor_name == "Rahim Uddin"
    assert row.doctor_degrees == "MBBS, FCPS"
    assert row.doctor_specializations == "Cardiology"
    assert row.ocr_status == "done"
    assert row.ocr_completed_at is not None
    assert row.ocr_error is None


async def test_a_failure_increments_attempts_and_returns_to_pending(survey):
    async with reply("", status=500) as client:
        await process_survey(survey.id, client=client)

    row = await _reload(survey.id)
    assert row.ocr_status == "pending"
    assert row.ocr_attempts == 1
    assert "500" in row.ocr_error
    # Backoff, so the next pass does not immediately re-claim it.
    next_at = row.ocr_next_attempt_at
    if next_at and next_at.tzinfo is None:
        next_at = next_at.replace(tzinfo=UTC)
    assert next_at > datetime.now(UTC)


async def test_it_gives_up_after_max_attempts(survey):
    from app.core.config import get_settings

    for _ in range(get_settings().ocr_max_attempts):
        async with SessionLocal() as session:
            row = await session.get(ChamberSurvey, survey.id)
            row.ocr_next_attempt_at = None
            session.add(row)
            await session.commit()
        async with reply("", status=500) as client:
            await process_survey(survey.id, client=client)

    row = await _reload(survey.id)
    assert row.ocr_status == "failed"
    assert row.ocr_attempts == get_settings().ocr_max_attempts


async def test_a_very_long_error_is_truncated(survey):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="x" * 5000)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await process_survey(survey.id, client=client)

    assert len((await _reload(survey.id)).ocr_error) <= 1000


async def test_the_reaper_returns_a_stale_claim_to_pending(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "processing"
        row.ocr_started_at = datetime.now(UTC) - timedelta(hours=2)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await reap_stale(session) == 1
    assert (await _reload(survey.id)).ocr_status == "pending"


async def test_the_reaper_leaves_a_fresh_claim_alone(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "processing"
        row.ocr_started_at = datetime.now(UTC)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await reap_stale(session) == 0
    assert (await _reload(survey.id)).ocr_status == "processing"


async def test_run_once_claims_and_processes(survey):
    async with reply(GOOD) as client:
        assert await run_once(client=client) == 1
    assert (await _reload(survey.id)).ocr_status == "done"


async def test_soft_deleted_surveys_are_never_claimed(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.deleted_at = datetime.now(UTC)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await claim_pending(session, 5) == []


async def test_backoff_hides_a_row_until_its_time(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_next_attempt_at = datetime.now(UTC) + timedelta(hours=1)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await claim_pending(session, 5) == []


async def test_reaper_increments_attempts_and_gives_up_at_max(survey):
    from app.core.config import get_settings

    # Set row as processing with attempts = max_attempts - 1
    max_attempts = get_settings().ocr_max_attempts
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "processing"
        row.ocr_attempts = max_attempts - 1
        row.ocr_started_at = datetime.now(UTC) - timedelta(hours=2)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await reap_stale(session) == 1

    row = await _reload(survey.id)
    assert row.ocr_status == "failed"
    assert row.ocr_attempts == max_attempts
    assert "repeatedly stalled" in row.ocr_error


async def test_midflight_status_change_prevents_writeback(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "processing"
        session.add(row)
        await session.commit()

    # While OCR runs, an admin corrects the row
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "done"
        row.doctor_name = "Admin Corrected"
        session.add(row)
        await session.commit()

    async with reply(GOOD) as client:
        await process_survey(survey.id, client=client)

    row = await _reload(survey.id)
    assert row.doctor_name == "Admin Corrected"
    assert row.ocr_status == "done"


async def test_process_survey_handles_save_failure_gracefully(survey, monkeypatch):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "processing"
        session.add(row)
        await session.commit()

    calls = 0

    class FailingSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, model, id):
            nonlocal calls
            calls += 1
            if calls == 2:
                # Call 2 is the success write-back attempt: fail commit
                raise RuntimeError("DB write error")
            # Call 1 (initial fetch) and Call 3 (failure recording): work normally
            async with SessionLocal() as real:
                return await real.get(model, id)

        def add(self, instance):
            pass

        async def commit(self):
            pass

    monkeypatch.setattr("app.workers.ocr.SessionLocal", FailingSession)

    async with reply(GOOD) as client:
        # Should not raise exception out of process_survey
        await process_survey(survey.id, client=client)
