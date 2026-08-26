import io
import json
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.timeutil import day_bounds_utc
from app.db.session import SessionDep
from app.models.availability import AvailabilitySlot
from app.models.survey import ChamberSurvey
from app.models.survey_phone import SurveyPhone
from app.schemas.survey import SlotRead, StatsRead, SurveyCreate, SurveyRead
from app.services import storage

router = APIRouter(prefix="/surveys", tags=["surveys"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
settings = get_settings()


async def survey_to_read(
    session: AsyncSession, row: ChamberSurvey, agent_name: str | None = None
) -> SurveyRead:
    """Assemble a survey with its children and a presigned nameplate URL."""
    out = SurveyRead.model_validate(row)
    slots = await session.exec(
        select(AvailabilitySlot)
        .where(AvailabilitySlot.survey_id == row.id)
        .order_by(AvailabilitySlot.day_of_week, AvailabilitySlot.start_time)
    )
    out.slots = [SlotRead.model_validate(s) for s in slots.all()]
    phones = await session.exec(
        select(SurveyPhone).where(SurveyPhone.survey_id == row.id).order_by(SurveyPhone.phone)
    )
    out.phones = [p.phone for p in phones.all()]
    out.nameplate_url = storage.presigned_get_url(row.nameplate_key)
    out.agent_name = agent_name
    return out


def _parse_json_field(raw: str, field: str) -> object:
    """Multipart cannot nest, so slots and phones arrive as JSON strings."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} must be valid JSON"
        ) from exc


# Declared before /{survey_id} - otherwise "stats" is parsed as a UUID.
@router.get("/stats", response_model=StatsRead)
async def my_stats(session: SessionDep, user: CurrentUser) -> StatsRead:
    alive = (ChamberSurvey.user_id == user.id) & (ChamberSurvey.deleted_at.is_(None))
    total = await session.exec(select(func.count()).select_from(ChamberSurvey).where(alive))

    start, end = day_bounds_utc(settings.app_timezone)
    today = await session.exec(
        select(func.count())
        .select_from(ChamberSurvey)
        .where(alive, ChamberSurvey.created_at >= start, ChamberSurvey.created_at < end)
    )
    return StatsRead(total=total.one(), today=today.one())


@router.get("", response_model=list[SurveyRead])
async def list_my_surveys(
    session: SessionDep, user: CurrentUser, limit: int = 50, offset: int = 0
) -> list[SurveyRead]:
    limit = min(max(limit, 1), 200)
    result = await session.exec(
        select(ChamberSurvey)
        .where(ChamberSurvey.user_id == user.id, ChamberSurvey.deleted_at.is_(None))
        .order_by(ChamberSurvey.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [await survey_to_read(session, row) for row in result.all()]


@router.get("/{survey_id}", response_model=SurveyRead)
async def get_my_survey(survey_id: UUID, session: SessionDep, user: CurrentUser) -> SurveyRead:
    row = await session.get(ChamberSurvey, survey_id)
    # 404 rather than 403 for someone else's survey: a 403 would confirm the id
    # exists, which is more than a stranger should learn.
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")
    return await survey_to_read(session, row)


@router.post("", response_model=SurveyRead, status_code=status.HTTP_201_CREATED)
async def create_survey(
    session: SessionDep,
    user: CurrentUser,
    hospital_name: Annotated[str, Form()],
    daily_patients: Annotated[int, Form()],
    avg_duration_min: Annotated[int, Form()],
    consultation_fee_bdt: Annotated[int, Form()],
    slots: Annotated[str, Form()],
    phones: Annotated[str, Form()],
    nameplate: Annotated[UploadFile | None, File()] = None,
    city: Annotated[str | None, Form()] = None,
    district: Annotated[str | None, Form()] = None,
    latitude: Annotated[float | None, Form()] = None,
    longitude: Annotated[float | None, Form()] = None,
) -> SurveyRead:
    """Multipart so the nameplate and the form arrive in one request.

    `user_id` is taken from the identity header and is never read from the body.
    """
    if nameplate is None or not nameplate.filename:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nameplate is required")

    try:
        payload = SurveyCreate(
            hospital_name=hospital_name,
            city=city,
            district=district,
            latitude=latitude,
            longitude=longitude,
            daily_patients=daily_patients,
            avg_duration_min=avg_duration_min,
            consultation_fee_bdt=consultation_fee_bdt,
            slots=_parse_json_field(slots, "slots"),
            phones=_parse_json_field(phones, "phones"),
        )
    except ValidationError as exc:
        # include_context=False drops the raw ValueError objects pydantic puts
        # in ctx; leaving them in makes FastAPI fail to serialise the response
        # and turns every validation failure into a 500.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            exc.errors(include_context=False, include_url=False),
        ) from exc

    blob = await nameplate.read()
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"nameplate exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
        )
    suffix = nameplate.filename.rsplit(".", 1)[-1] if "." in nameplate.filename else "bin"
    key = f"surveys/{uuid4()}.{suffix}"
    storage.upload_fileobj(io.BytesIO(blob), key, nameplate.content_type)

    row = ChamberSurvey(
        user_id=user.id,
        hospital_name=payload.hospital_name,
        city=payload.city,
        district=payload.district,
        latitude=payload.latitude,
        longitude=payload.longitude,
        nameplate_key=key,
        daily_patients=payload.daily_patients,
        avg_duration_min=payload.avg_duration_min,
        consultation_fee_bdt=payload.consultation_fee_bdt,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    for slot in payload.slots:
        session.add(
            AvailabilitySlot(
                survey_id=row.id,
                day_of_week=slot.day_of_week,
                start_time=slot.start_time,
                end_time=slot.end_time,
            )
        )
    for phone in payload.phones:
        session.add(SurveyPhone(survey_id=row.id, phone=phone))
    await session.commit()

    return await survey_to_read(session, row)
