from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Column, DateTime
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ChamberSurvey(SQLModel, table=True):
    """One doctor's chamber as recorded by an agent on site."""

    __tablename__ = "chamber_surveys"
    __table_args__ = (
        # Either precise coordinates or a named place. Requiring coordinates
        # would block an agent whose browser denies geolocation; requiring a
        # place would throw away good GPS.
        CheckConstraint(
            "(latitude IS NOT NULL AND longitude IS NOT NULL) "
            "OR (city IS NOT NULL AND district IS NOT NULL)",
            name="ck_surveys_location",
        ),
        CheckConstraint(
            "ocr_status IN ('pending', 'done', 'failed')", name="ck_surveys_ocr_status"
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    hospital_name: str = Field(index=True, max_length=200)
    city: str | None = Field(default=None, index=True, max_length=100)
    district: str | None = Field(default=None, index=True, max_length=100)
    latitude: float | None = Field(default=None)
    longitude: float | None = Field(default=None)

    # Required: the nameplate is the only source of doctor identity, so a
    # survey without one could never be attributed.
    nameplate_key: str = Field(max_length=1024)

    daily_patients: int
    avg_duration_min: int
    consultation_fee_bdt: int

    # Filled by a future OCR pass that is not part of this project. The status
    # records that the work is pending rather than leaving it invisible.
    ocr_status: str = Field(default="pending", max_length=16)
    doctor_name: str | None = Field(default=None, max_length=200)
    doctor_degrees: str | None = Field(default=None, max_length=1000)
    doctor_specializations: str | None = Field(default=None, max_length=1000)

    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), index=True, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    # Soft delete: field data an admin destroys is field data nobody can audit.
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), index=True, nullable=True),
    )
