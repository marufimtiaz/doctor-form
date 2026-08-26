from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.core.phone import normalize_phone

# Length is what makes a password strong. Composition rules mostly push people
# toward predictable substitutions. The upper bound exists because argon2 will
# happily burn CPU on a megabyte of input.
PASSWORD_MIN = 8
PASSWORD_MAX = 128


def password_field() -> Any:
    return Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=32)
    company: str = Field(min_length=1, max_length=200)
    role: str = "agent"
    password: str = password_field()

    @field_validator("phone")
    @classmethod
    def _normalize(cls, value: str) -> str:
        # ValueError here surfaces as a 422 with the message attached.
        return normalize_phone(value)

    @field_validator("role")
    @classmethod
    def _known_role(cls, value: str) -> str:
        if value not in ("agent", "admin"):
            raise ValueError("role must be 'agent' or 'admin'")
        return value


class UserUpdate(BaseModel):
    is_active: bool


class UserPublic(BaseModel):
    """Feeds the identity picker. Deliberately omits phone."""

    id: UUID
    name: str
    company: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}
