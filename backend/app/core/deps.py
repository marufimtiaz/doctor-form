from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status

from app.core.security import decode_access_token
from app.db.session import SessionDep
from app.models.user import User


async def get_current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """Resolve the caller from a signed Bearer token.

    Every rejection is a 401 with the same generic message: distinguishing
    "no such user" from "wrong version" would leak account state.

    Revocation lives here rather than in a sessions table. The user row has to
    be loaded anyway for role and is_active, so both checks are free:
    deactivating a user or bumping their token_version invalidates tokens
    already issued, without any server-side session storage.
    """
    if not authorization:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication required")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication required")

    try:
        payload = decode_access_token(token.strip())
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from None

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    if user.token_version != payload.get("ver"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin role required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
