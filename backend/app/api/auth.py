from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.core.deps import CurrentUser
from app.core.phone import normalize_phone
from app.core.security import DUMMY_HASH, create_access_token, hash_password, verify_password
from app.db.session import SessionDep
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse
from app.schemas.user import UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])

# One message for every failure. Distinguishing "no such phone" from "wrong
# password" turns the login form into a way to discover who is registered.
INVALID_CREDENTIALS = "Phone or password is incorrect"


def _issue(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id, user.token_version),
        user=UserPublic.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: SessionDep) -> TokenResponse:
    try:
        phone = normalize_phone(payload.phone)
    except ValueError:
        # An unparseable phone is just a failed login, not a 422: a different
        # status would reveal which inputs correspond to real accounts.
        verify_password(payload.password, DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS) from None

    result = await session.exec(select(User).where(User.phone == phone))
    user = result.first()

    if user is None or user.password_hash is None or not user.is_active:
        # Hash anyway so a missing account costs the same time as a wrong
        # password; otherwise latency answers what the status code will not.
        verify_password(payload.password, DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS)

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS)

    return _issue(user)


@router.get("/me", response_model=UserPublic)
async def me(user: CurrentUser) -> User:
    return user


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    payload: ChangePasswordRequest, session: SessionDep, user: CurrentUser
) -> TokenResponse:
    """Bumps token_version, which logs out every other device, then returns a
    fresh token so the caller is not logged out by their own change."""
    if user.password_hash is None or not verify_password(
        payload.current_password, user.password_hash
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")

    row = await session.get(User, user.id)
    row.password_hash = hash_password(payload.new_password)
    row.password_set_at = datetime.now(UTC)
    row.updated_at = datetime.now(UTC)
    row.token_version += 1
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _issue(row)
