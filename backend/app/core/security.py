from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

settings = get_settings()
_hasher = PasswordHasher()

# Verified against when a phone is not registered, so that a missing account
# and a wrong password take comparable time. Without it, response latency tells
# an attacker which phone numbers exist.
DUMMY_HASH = _hasher.hash("timing-equalisation-only-never-a-real-password")


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    """False rather than raising, so a NULL or corrupt column cannot 500 the
    login route."""
    try:
        _hasher.verify(hashed, raw)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def create_access_token(user_id: UUID, token_version: int) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        # Compared against the user row on every request; bumping the row's
        # value invalidates every token issued before the bump.
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(days=settings.access_token_ttl_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises ValueError for every invalid case - bad signature, expiry,
    malformed input - so callers handle one exception type."""
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise ValueError(f"invalid token: {exc}") from exc
