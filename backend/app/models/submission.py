from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import Column, DateTime
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class Submission(SQLModel, table=True):
    """A single form submission, optionally carrying an uploaded attachment."""

    __tablename__ = "submissions"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    patient_name: str = Field(index=True, max_length=200)
    email: str = Field(max_length=320)
    notes: str = Field(default="", max_length=5000)
    # Object key in the S3/RustFS bucket; None when nothing was attached.
    attachment_key: str | None = Field(default=None, max_length=1024)
    # timezone=True maps to TIMESTAMPTZ; without it Postgres rejects the
    # timezone-aware value produced by _utcnow().
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), index=True, nullable=False),
    )
