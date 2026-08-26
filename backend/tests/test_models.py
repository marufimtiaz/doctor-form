from datetime import time

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.availability import AvailabilitySlot
from app.models.survey import ChamberSurvey
from app.models.survey_phone import SurveyPhone
from app.models.user import User


@pytest.fixture
async def session():
    """In-memory database, independent of the app's engine."""
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(SQLModel.metadata.create_all)
    async with AsyncSession(engine) as s:
        yield s
    await engine.dispose()


async def _agent(session: AsyncSession) -> User:
    user = User(name="Karim", phone="+8801712345678", company="FieldCo")
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _survey(user_id, **overrides) -> ChamberSurvey:
    fields = {
        "user_id": user_id,
        "hospital_name": "Square",
        "nameplate_key": "surveys/a.jpg",
        "daily_patients": 30,
        "avg_duration_min": 10,
        "consultation_fee_bdt": 1000,
    }
    fields.update(overrides)
    return ChamberSurvey(**fields)


async def test_user_defaults_to_active_agent(session: AsyncSession):
    user = await _agent(session)
    assert user.role == "agent"
    assert user.is_active is True


async def test_user_phone_is_unique(session: AsyncSession):
    await _agent(session)
    session.add(User(name="Other", phone="+8801712345678", company="FieldCo"))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_user_role_is_constrained(session: AsyncSession):
    session.add(User(name="X", phone="+8801812345678", company="C", role="wizard"))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_survey_accepts_coordinates_only(session: AsyncSession):
    user = await _agent(session)
    session.add(_survey(user.id, latitude=23.75, longitude=90.39))
    await session.commit()


async def test_survey_accepts_place_only(session: AsyncSession):
    user = await _agent(session)
    session.add(_survey(user.id, city="Dhaka", district="Dhaka"))
    await session.commit()


async def test_survey_with_no_location_is_rejected_by_the_database(session: AsyncSession):
    user = await _agent(session)
    session.add(_survey(user.id))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_survey_starts_pending_ocr_and_undeleted(session: AsyncSession):
    user = await _agent(session)
    survey = _survey(user.id, city="Dhaka", district="Dhaka")
    session.add(survey)
    await session.commit()
    await session.refresh(survey)
    assert survey.ocr_status == "pending"
    assert survey.deleted_at is None
    assert survey.doctor_name is None


async def test_children_attach_to_a_survey(session: AsyncSession):
    user = await _agent(session)
    survey = _survey(user.id, city="Dhaka", district="Dhaka")
    session.add(survey)
    await session.commit()
    await session.refresh(survey)

    session.add(
        AvailabilitySlot(
            survey_id=survey.id, day_of_week=5, start_time=time(17, 0), end_time=time(20, 0)
        )
    )
    session.add(SurveyPhone(survey_id=survey.id, phone="+8801712345678"))
    await session.commit()


async def test_slot_times_must_be_ordered(session: AsyncSession):
    user = await _agent(session)
    survey = _survey(user.id, city="Dhaka", district="Dhaka")
    session.add(survey)
    await session.commit()
    await session.refresh(survey)

    session.add(
        AvailabilitySlot(
            survey_id=survey.id, day_of_week=5, start_time=time(20, 0), end_time=time(17, 0)
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()
