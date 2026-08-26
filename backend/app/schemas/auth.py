from pydantic import BaseModel, Field

from app.schemas.user import UserPublic, password_field


class LoginRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    # Deliberately unconstrained: rejecting a short password at login would
    # tell an attacker their guess was not even the right shape.
    password: str = Field(min_length=1, max_length=1024)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = password_field()


class SetPasswordRequest(BaseModel):
    """Admin setting somebody else's password; no current password needed."""

    password: str = password_field()
