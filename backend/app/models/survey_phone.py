from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class SurveyPhone(SQLModel, table=True):
    """A contact number for the chamber. Deliberately not unique - several
    doctors sharing one hospital reception line is normal."""

    __tablename__ = "survey_phones"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    survey_id: UUID = Field(foreign_key="chamber_surveys.id", index=True, ondelete="CASCADE")
    phone: str = Field(index=True, max_length=32)
