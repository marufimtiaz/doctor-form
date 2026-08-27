from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.core.deps import AdminUser
from app.core.security import hash_password
from app.db.session import SessionDep
from app.models.user import User
from app.schemas.auth import SetPasswordRequest
from app.schemas.user import UserCreate, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


def _utcnow() -> datetime:
    return datetime.now(UTC)


@router.get("", response_model=list[UserPublic])
async def list_users(session: SessionDep, _: AdminUser) -> list[User]:
    """Admin-only. This fed the identity picker when there was no login; a
    public roster is now just a list of valid login names for an attacker."""
    result = await session.exec(select(User).order_by(User.name))
    return list(result.all())


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, session: SessionDep, _: AdminUser) -> User:
    user = User(
        name=payload.name,
        phone=payload.phone,  # already E.164 via the schema validator
        company=payload.company,
        role=payload.role,
        password_hash=hash_password(payload.password),
        password_set_at=_utcnow(),
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already registered") from None
    await session.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserPublic)
async def set_user_active(
    user_id: UUID, payload: UserUpdate, session: SessionDep, _: AdminUser
) -> User:
    """The only writer of is_active. Without it the column would be unreachable
    and get_current_user's inactive check would be dead code."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    user.is_active = payload.is_active
    user.updated_at = _utcnow()
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: UUID, payload: SetPasswordRequest, session: SessionDep, _: AdminUser
) -> None:
    """Bumping token_version logs the user out of every device, which is the
    point: a reset exists because the account may be in the wrong hands."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    user.password_hash = hash_password(payload.password)
    user.password_set_at = _utcnow()
    user.updated_at = _utcnow()
    user.token_version += 1
    session.add(user)
    await session.commit()
