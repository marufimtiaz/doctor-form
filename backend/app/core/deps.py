from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status

from app.db.session import SessionDep
from app.models.user import User


async def get_current_user(
    session: SessionDep,
    x_user_id: Annotated[str | None, Header()] = None,
) -> User:
    """Resolve the caller from the X-User-Id header.

    This is NOT authentication - anyone can send any id. It is the seam where a
    verified token will be read instead, so that swapping in real login touches
    this function and nothing else.

    The header is typed `str` rather than `UUID` on purpose: FastAPI would turn
    a malformed UUID into a 422, and a bad credential should read as 401.
    """
    if x_user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-User-Id header required")
    try:
        user_id = UUID(x_user_id)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed X-User-Id") from None

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown or inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin role required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
