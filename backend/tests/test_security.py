import time
from uuid import uuid4

import jwt
import pytest

from app.core.config import DEV_ADMIN_PASSWORD, DEV_JWT_SECRET, Settings, get_settings
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hashing_is_argon2id_and_salted():
    first = hash_password("correct horse battery staple")
    second = hash_password("correct horse battery staple")
    assert first.startswith("$argon2id$")
    # Distinct salts, so the same password never produces the same hash.
    assert first != second


def test_verify_accepts_the_right_password():
    assert verify_password("s3cret-password", hash_password("s3cret-password"))


def test_verify_rejects_the_wrong_password():
    assert not verify_password("wrong-password", hash_password("s3cret-password"))


def test_verify_rejects_a_corrupt_hash_without_raising():
    # A NULL or truncated column must not crash the login route.
    assert not verify_password("anything", "not-a-hash")


def test_dummy_hash_is_usable_for_timing_equalisation():
    assert DUMMY_HASH.startswith("$argon2id$")
    assert not verify_password("anything at all", DUMMY_HASH)


def test_token_round_trips_the_user_and_version():
    user_id = uuid4()
    payload = decode_access_token(create_access_token(user_id, 7))
    assert payload["sub"] == str(user_id)
    assert payload["ver"] == 7
    assert payload["exp"] > payload["iat"]


def test_token_signed_with_another_secret_is_rejected():
    forged = jwt.encode(
        {"sub": str(uuid4()), "ver": 1, "exp": int(time.time()) + 600},
        "an-attackers-secret",
        algorithm="HS256",
    )
    with pytest.raises(ValueError):
        decode_access_token(forged)


def test_expired_token_is_rejected():
    settings = get_settings()
    now = int(time.time())
    expired = jwt.encode(
        {"sub": str(uuid4()), "ver": 1, "iat": now - 7200, "exp": now - 3600},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(ValueError):
        decode_access_token(expired)


def test_garbage_token_is_rejected():
    with pytest.raises(ValueError):
        decode_access_token("not.a.token")


def test_production_refuses_the_default_jwt_secret():
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(
            debug=False, jwt_secret=DEV_JWT_SECRET, admin_password="fine-password"
        )


def test_production_refuses_the_default_admin_password():
    with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
        Settings(
            debug=False,
            jwt_secret="a-real-secret-long-enough-for-hmac-256",
            admin_password=DEV_ADMIN_PASSWORD,
        )


def test_production_refuses_a_short_secret():
    """RFC 7518 3.2 - a key shorter than the hash output weakens the signature."""
    with pytest.raises(ValueError, match="at least 32 characters"):
        Settings(debug=False, jwt_secret="too-short", admin_password="fine-password")


def test_production_accepts_a_long_enough_secret():
    settings = Settings(
        debug=False, jwt_secret="x" * 32, admin_password="a-real-admin-password"
    )
    assert settings.jwt_secret == "x" * 32


def test_development_tolerates_the_defaults():
    # Local work must not require secret management.
    settings = Settings(debug=True, jwt_secret=DEV_JWT_SECRET, admin_password=DEV_ADMIN_PASSWORD)
    assert settings.jwt_secret == DEV_JWT_SECRET
