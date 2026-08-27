import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal, _is_sqlite
from app.models.survey import ChamberSurvey
from app.services import storage
from app.services.ocr import OcrError, extract_doctor_fields

logger = logging.getLogger(__name__)
settings = get_settings()

ERROR_MAX = 1000


async def claim_pending(session: AsyncSession, limit: int) -> list[UUID]:
    """Mark rows `processing` and commit before any network call.

    Holding a transaction open across a 60-second HTTP request would exhaust
    the connection pool and leave idle-in-transaction sessions, so the claim is
    its own short transaction.
    """
    now = datetime.now(UTC)
    query = (
        select(ChamberSurvey)
        .where(
            ChamberSurvey.ocr_status == "pending",
            ChamberSurvey.deleted_at.is_(None),
            (ChamberSurvey.ocr_next_attempt_at.is_(None))
            | (ChamberSurvey.ocr_next_attempt_at <= now),
        )
        .order_by(ChamberSurvey.created_at)
        .limit(limit)
    )
    # SKIP LOCKED is what makes two API instances two safe workers. SQLite,
    # which the test suite uses, has no such thing.
    if not _is_sqlite:
        query = query.with_for_update(skip_locked=True)

    rows = (await session.exec(query)).all()
    for row in rows:
        row.ocr_status = "processing"
        row.ocr_started_at = now
        session.add(row)
    await session.commit()
    return [row.id for row in rows]


async def _record_failure(survey_id: UUID, message: str) -> None:
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        if row is None:
            return
        row.ocr_attempts += 1
        row.ocr_error = message[:ERROR_MAX]
        row.updated_at = datetime.now(UTC)
        if row.ocr_attempts >= settings.ocr_max_attempts:
            row.ocr_status = "failed"
        else:
            row.ocr_status = "pending"
            # Exponential backoff: 1, 2, 4 minutes.
            delay = 2 ** (row.ocr_attempts - 1)
            row.ocr_next_attempt_at = datetime.now(UTC) + timedelta(minutes=delay)
        session.add(row)
        await session.commit()


async def process_survey(
    survey_id: UUID, *, client: httpx.AsyncClient | None = None
) -> None:
    """Read one nameplate and write the result. Never raises: a failure is
    data on the row, not an exception for the caller to handle."""
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        if row is None:
            return
        key = row.nameplate_key

    try:
        image, content_type = await asyncio.to_thread(storage.download_object, key)
        fields = await extract_doctor_fields(image, content_type, client=client)
    except OcrError as exc:
        logger.warning("OCR failed for %s: %s", survey_id, exc)
        await _record_failure(survey_id, str(exc))
        return
    except Exception as exc:  # noqa: BLE001 - storage or anything unforeseen
        logger.exception("OCR aborted for %s", survey_id)
        await _record_failure(survey_id, f"{type(exc).__name__}: {exc}")
        return

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        if row is None:
            return
        row.doctor_name = fields.doctor_name
        row.doctor_degrees = fields.doctor_degrees
        row.doctor_specializations = fields.doctor_specializations
        row.ocr_status = "done"
        row.ocr_error = None
        row.ocr_next_attempt_at = None
        row.ocr_completed_at = datetime.now(UTC)
        row.updated_at = datetime.now(UTC)
        session.add(row)
        await session.commit()


async def reap_stale(session: AsyncSession) -> int:
    """Return claims whose process died to `pending`.

    A crash between claim and result would otherwise strand the row in
    `processing` forever.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.ocr_stale_minutes)
    rows = (
        await session.exec(
            select(ChamberSurvey).where(
                ChamberSurvey.ocr_status == "processing",
                ChamberSurvey.ocr_started_at < cutoff,
            )
        )
    ).all()
    for row in rows:
        row.ocr_status = "pending"
        row.ocr_started_at = None
        session.add(row)
    await session.commit()
    return len(rows)


async def run_once(*, client: httpx.AsyncClient | None = None) -> int:
    async with SessionLocal() as session:
        await reap_stale(session)
        claimed = await claim_pending(session, settings.ocr_batch_size)
    for survey_id in claimed:
        await process_survey(survey_id, client=client)
    return len(claimed)


async def run_worker_forever() -> None:
    if not settings.openrouter_api_key:
        # Not a startup failure: OCR enriches data, it does not gate the system.
        logger.warning("OPENROUTER_API_KEY is empty; OCR worker will not run")
        return

    logger.info("OCR worker started, model=%s", settings.ocr_model)
    while True:
        try:
            processed = await run_once()
            if processed:
                logger.info("OCR processed %d survey(s)", processed)
        except asyncio.CancelledError:
            logger.info("OCR worker stopping")
            raise
        except Exception:  # noqa: BLE001 - the loop must outlive one bad pass
            logger.exception("OCR pass failed")
        await asyncio.sleep(settings.ocr_poll_seconds)


if __name__ == "__main__":
    # Detached mode: run this as its own container with OCR_MODE=off on the API.
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker_forever())
