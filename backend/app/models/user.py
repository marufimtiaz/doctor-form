from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Column, DateTime, Integer
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(SQLModel, table=True):
    """A person who uses the system. Selected, not yet authenticated."""

    __tablename__ = "users"
    # VARCHAR + CHECK rather than a native Postgres ENUM: enums are awkward to
    # alter and do not exist in SQLite, which the test suite runs on.
    __table_args__ = (CheckConstraint("role IN ('agent', 'admin')", name="ck_users_role"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(index=True, max_length=200)
    # Stored E.164 by app/core/phone.py, so uniqueness means what it looks like.
    phone: str = Field(unique=True, max_length=32)
    company: str = Field(index=True, max_length=200)
    role: str = Field(default="agent", max_length=16)
    is_active: bool = Field(default=True)
    # NULL means the account cannot log in yet - an admin must set a password.
    password_hash: str | None = Field(default=None, max_length=255)
    password_set_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # Carried in every token as "ver". Bumping it invalidates tokens issued
    # earlier, which is how a password change logs other devices out.
    #
    # server_default matters: this column is added to a table that already has
    # rows, and ADD COLUMN ... NOT NULL without a default fails on Postgres.
    token_version: int = Field(
        default=1,
        sa_column=Column(Integer, nullable=False, server_default="1"),
    )
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
