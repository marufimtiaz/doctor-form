from __future__ import annotations

from datetime import datetime, time
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.phone import normalize_phone


class SlotIn(BaseModel):
    # 0=Monday .. 6=Sunday, matching datetime.weekday().
    day_of_week: int = Field(ge=0, le=6)
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def _ordered(self) -> SlotIn:
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class SlotRead(BaseModel):
    day_of_week: int
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class SurveyCreate(BaseModel):
    hospital_name: str = Field(min_length=1, max_length=200)

    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    daily_patients: int = Field(gt=0)
    avg_duration_min: int = Field(gt=0)
    consultation_fee_bdt: int = Field(ge=0)

    slots: list[SlotIn] = Field(min_length=1)
    phones: list[str] = Field(min_length=1)

    @field_validator("city", "district")
    @classmethod
    def _blank_is_absent(cls, value: str | None) -> str | None:
        # A whitespace-only city must not satisfy the location requirement.
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("phones")
    @classmethod
    def _normalize_phones(cls, values: list[str]) -> list[str]:
        return [normalize_phone(v) for v in values]

    @model_validator(mode="after")
    def _has_a_location(self) -> SurveyCreate:
        """Either precise coordinates or a named place; each pair is
        all-or-nothing. Mirrors the ck_surveys_location CHECK constraint."""
        has_coords = self.latitude is not None and self.longitude is not None
        half_coords = (self.latitude is None) != (self.longitude is None)
        has_place = bool(self.city) and bool(self.district)
        half_place = bool(self.city) != bool(self.district)

        if half_coords:
            raise ValueError("latitude and longitude must be given together")
        if half_place:
            raise ValueError("city and district must be given together")
        if not has_coords and not has_place:
            raise ValueError("provide coordinates or city and district")
        return self


class SurveyRead(BaseModel):
    id: UUID
    user_id: UUID
    hospital_name: str
    city: str | None
    district: str | None
    latitude: float | None
    longitude: float | None
    nameplate_key: str
    nameplate_url: str | None = None
    daily_patients: int
    avg_duration_min: int
    consultation_fee_bdt: int
    ocr_status: str
    ocr_attempts: int = 0
    # Why the last attempt failed, so the dashboard can explain rather than
    # just report a failure.
    ocr_error: str | None = None
    doctor_name: str | None
    doctor_degrees: str | None
    doctor_specializations: str | None
    created_at: datetime
    deleted_at: datetime | None = None
    slots: list[SlotRead] = []
    phones: list[str] = []
    # Populated on admin listings only.
    agent_name: str | None = None

    model_config = {"from_attributes": True}


class StatsRead(BaseModel):
    total: int
    today: int


class AgentStat(BaseModel):
    user_id: UUID
    name: str
    total: int
    today: int


class AdminStatsRead(BaseModel):
    total: int
    today: int
    agent_count: int
    per_agent: list[AgentStat]


class DoctorFieldsUpdate(BaseModel):
    """An admin correcting what the model read off the nameplate."""

    doctor_name: str | None = Field(default=None, max_length=200)
    doctor_degrees: str | None = Field(default=None, max_length=1000)
    doctor_specializations: str | None = Field(default=None, max_length=1000)
