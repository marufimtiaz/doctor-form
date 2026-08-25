import io
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlmodel import select

from app.db.session import SessionDep
from app.models.submission import Submission
from app.schemas.submission import SubmissionCreate, SubmissionRead
from app.services import storage

router = APIRouter(prefix="/submissions", tags=["submissions"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _to_read(row: Submission) -> SubmissionRead:
    out = SubmissionRead.model_validate(row)
    if row.attachment_key:
        out.attachment_url = storage.presigned_get_url(row.attachment_key)
    return out


@router.get("", response_model=list[SubmissionRead])
async def list_submissions(
    session: SessionDep,
    limit: int = 50,
    offset: int = 0,
) -> list[SubmissionRead]:
    limit = min(max(limit, 1), 200)
    result = await session.exec(
        select(Submission).order_by(Submission.created_at.desc()).offset(offset).limit(limit)
    )
    return [_to_read(row) for row in result.all()]


@router.get("/{submission_id}", response_model=SubmissionRead)
async def get_submission(
    submission_id: UUID,
    session: SessionDep,
) -> SubmissionRead:
    row = await session.get(Submission, submission_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")
    return _to_read(row)


@router.post("", response_model=SubmissionRead, status_code=status.HTTP_201_CREATED)
async def create_submission(
    session: SessionDep,
    patient_name: Annotated[str, Form()],
    email: Annotated[str, Form()],
    notes: Annotated[str, Form()] = "",
    attachment: Annotated[UploadFile | None, File()] = None,
) -> SubmissionRead:
    """Multipart so the form and its attachment arrive in one request."""
    try:
        payload = SubmissionCreate(patient_name=patient_name, email=email, notes=notes)
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.errors()) from exc

    attachment_key: str | None = None
    if attachment is not None and attachment.filename:
        blob = await attachment.read()
        if len(blob) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"attachment exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
            )
        suffix = attachment.filename.rsplit(".", 1)[-1] if "." in attachment.filename else "bin"
        attachment_key = f"submissions/{uuid4()}.{suffix}"
        storage.upload_fileobj(io.BytesIO(blob), attachment_key, attachment.content_type)

    row = Submission(
        patient_name=payload.patient_name,
        email=str(payload.email),
        notes=payload.notes,
        attachment_key=attachment_key,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _to_read(row)


@router.delete("/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_submission(
    submission_id: UUID,
    session: SessionDep,
) -> None:
    row = await session.get(Submission, submission_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")
    if row.attachment_key:
        storage.delete_object(row.attachment_key)
    await session.delete(row)
    await session.commit()
