from datetime import time
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint
from sqlmodel import Field, SQLModel


class AvailabilitySlot(SQLModel, table=True):
    """One "the doctor sits here from X to Y on day D" row."""

    __tablename__ = "availability_slots"
    __table_args__ = (
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="ck_slots_day_of_week"),
        CheckConstraint("end_time > start_time", name="ck_slots_time_order"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    survey_id: UUID = Field(foreign_key="chamber_surveys.id", index=True, ondelete="CASCADE")
    # 0=Monday .. 6=Sunday, matching datetime.weekday(). The UI renders Sat
    # first; display order is never stored.
    day_of_week: int
    start_time: time
    end_time: time
