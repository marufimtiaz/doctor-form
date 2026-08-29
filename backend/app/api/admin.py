from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import case, func
from sqlmodel import select

from app.api.surveys import survey_to_read
from app.core.config import get_settings
from app.core.deps import AdminUser
from app.core.timeutil import day_bounds_utc
from app.db.session import SessionDep
from app.models.survey import ChamberSurvey
from app.models.user import User
from app.schemas.survey import (
    AdminStatsRead,
    AgentStat,
    DoctorFieldsUpdate,
    SurveyRead,
)

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()


def _local_range_to_utc(
    date_from: date | None, date_to: date | None
) -> tuple[datetime | None, datetime | None]:
    """Turn inclusive local dates into a half-open UTC range.

    Filters must use the same day boundary as the counts, or the two disagree
    for six hours out of every twenty-four.
    """
    tz = ZoneInfo(settings.app_timezone)
    start = (
        datetime.combine(date_from, datetime.min.time(), tzinfo=tz).astimezone(UTC)
        if date_from
        else None
    )
    end = (
        datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=tz).astimezone(
            UTC
        )
        if date_to
        else None
    )
    return start, end


@router.get("/surveys", response_model=list[SurveyRead])
async def list_all_surveys(
    session: SessionDep,
    _: AdminUser,
    user_id: UUID | None = None,
    district: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    include_deleted: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[SurveyRead]:
    limit = min(max(limit, 1), 200)
    query = select(ChamberSurvey, User.name).join(User, User.id == ChamberSurvey.user_id)

    if not include_deleted:
        query = query.where(ChamberSurvey.deleted_at.is_(None))
    if user_id is not None:
        query = query.where(ChamberSurvey.user_id == user_id)
    if district is not None:
        query = query.where(ChamberSurvey.district == district)

    start, end = _local_range_to_utc(date_from, date_to)
    if start is not None:
        query = query.where(ChamberSurvey.created_at >= start)
    if end is not None:
        query = query.where(ChamberSurvey.created_at < end)

    result = await session.exec(
        query.order_by(ChamberSurvey.created_at.desc()).offset(offset).limit(limit)
    )
    return [await survey_to_read(session, row, agent_name=name) for row, name in result.all()]


@router.get("/stats", response_model=AdminStatsRead)
async def overall_stats(session: SessionDep, _: AdminUser) -> AdminStatsRead:
    alive = ChamberSurvey.deleted_at.is_(None)
    start, end = day_bounds_utc(settings.app_timezone)
    today_window = (ChamberSurvey.created_at >= start) & (ChamberSurvey.created_at < end)

    total = (
        await session.exec(select(func.count()).select_from(ChamberSurvey).where(alive))
    ).one()
    today = (
        await session.exec(
            select(func.count()).select_from(ChamberSurvey).where(alive, today_window)
        )
    ).one()

    # case(...) rather than casting a boolean: SQLite has no boolean type, and
    # cast(<comparison>, Integer) behaves inconsistently across the backends.
    rows = await session.exec(
        select(
            ChamberSurvey.user_id,
            User.name,
            func.count().label("total"),
            func.sum(case((today_window, 1), else_=0)).label("today"),
        )
        .join(User, User.id == ChamberSurvey.user_id)
        .where(alive)
        .group_by(ChamberSurvey.user_id, User.name)
        .order_by(func.count().desc())
    )
    per_agent = [
        AgentStat(user_id=uid, name=name, total=t, today=int(td or 0))
        for uid, name, t, td in rows.all()
    ]

    agents = (
        await session.exec(select(func.count()).select_from(User).where(User.is_active))
    ).one()
    return AdminStatsRead(total=total, today=today, agent_count=agents, per_agent=per_agent)


@router.delete("/surveys/{survey_id}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_survey(survey_id: UUID, session: SessionDep, _: AdminUser) -> None:
    """Soft: the row and its nameplate survive.

    Field data an admin can destroy is field data nobody can audit, which is the
    same reason agents cannot delete at all.
    """
    row = await session.get(ChamberSurvey, survey_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")
    row.deleted_at = datetime.now(UTC)
    row.updated_at = datetime.now(UTC)
    session.add(row)
    await session.commit()


@router.patch("/surveys/{survey_id}/doctor", response_model=SurveyRead)
async def correct_doctor_fields(
    survey_id: UUID, payload: DoctorFieldsUpdate, session: SessionDep, _: AdminUser
) -> SurveyRead:
    """A human correction is authoritative: the row becomes `done` regardless
    of what the model made of it."""
    row = await session.get(ChamberSurvey, survey_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)

    row.ocr_status = "done"
    row.ocr_source = "admin"
    row.ocr_error = None
    row.ocr_next_attempt_at = None
    row.ocr_completed_at = datetime.now(UTC)
    row.updated_at = datetime.now(UTC)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return await survey_to_read(session, row)


@router.post("/surveys/{survey_id}/reread", status_code=status.HTTP_204_NO_CONTENT)
async def reread_nameplate(survey_id: UUID, session: SessionDep, _: AdminUser) -> None:
    """Put the survey back in the queue. Attempts reset, so a row that gave up
    after three failures gets a fresh three."""
    row = await session.get(ChamberSurvey, survey_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")

    row.ocr_status = "pending"
    row.ocr_source = None
    row.ocr_attempts = 0
    row.ocr_error = None
    row.ocr_started_at = None
    row.ocr_next_attempt_at = None
    row.ocr_completed_at = None
    row.updated_at = datetime.now(UTC)
    session.add(row)
    await session.commit()
