from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field


class SubmissionCreate(BaseModel):
    patient_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    notes: str = Field(default="", max_length=5000)


class SubmissionRead(BaseModel):
    id: UUID
    patient_name: str
    email: str
    notes: str
    attachment_key: str | None
    attachment_url: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}
