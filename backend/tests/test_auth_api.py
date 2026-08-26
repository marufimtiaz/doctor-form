import pytest

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User
from tests.conftest import auth

PASSWORD = "correct-horse-battery"


@pytest.fixture
async def with_password(make_user):
    """A user who can actually log in."""

    async def _make(role: str = "agent", name: str = "Karim", password: str = PASSWORD) -> User:
        user = await make_user(role=role, name=name)
        async with SessionLocal() as session:
            row = await session.get(User, user.id)
            row.password_hash = hash_password(password)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    return _make


async def test_login_returns_a_usable_token(client, with_password):
    user = await with_password()
    resp = await client.post("/api/auth/login", json={"phone": user.phone, "password": PASSWORD})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["name"] == "Karim"
    # Credentials never travel in a response body.
    assert "password_hash" not in body["user"]
    assert "token_version" not in body["user"]

    me = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200
    assert me.json()["id"] == str(user.id)


async def test_login_accepts_a_locally_formatted_phone(client, with_password):
    """The stored phone is E.164; agents type the local form."""
    user = await with_password()
    assert user.phone.startswith("+880")
    local = "0" + user.phone[4:]
    resp = await client.post("/api/auth/login", json={"phone": local, "password": PASSWORD})
    assert resp.status_code == 200


async def test_wrong_password_and_unknown_phone_are_indistinguishable(client, with_password):
    await with_password()
    wrong = await client.post(
        "/api/auth/login", json={"phone": "01712345678", "password": "not-the-password"}
    )
    unknown = await client.post(
        "/api/auth/login", json={"phone": "01999999999", "password": "not-the-password"}
    )
    assert wrong.status_code == unknown.status_code == 401
    # Identical bodies: differing ones turn the form into an account oracle.
    assert wrong.json() == unknown.json()


async def test_unparseable_phone_is_also_just_a_401(client):
    resp = await client.post("/api/auth/login", json={"phone": "hello", "password": "whatever"})
    assert resp.status_code == 401


async def test_a_user_without_a_password_cannot_log_in(client, make_user):
    user = await make_user()
    assert user.password_hash is None
    resp = await client.post("/api/auth/login", json={"phone": user.phone, "password": "anything"})
    assert resp.status_code == 401


async def test_a_deactivated_user_cannot_log_in(client, with_password):
    user = await with_password()
    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.is_active = False
        session.add(row)
        await session.commit()

    resp = await client.post("/api/auth/login", json={"phone": user.phone, "password": PASSWORD})
    assert resp.status_code == 401


async def test_me_requires_a_token(client):
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_changing_a_password_invalidates_old_tokens_but_returns_a_new_one(
    client, with_password
):
    user = await with_password()
    old = auth(user)

    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "a-brand-new-password"},
        headers=old,
    )
    assert resp.status_code == 200
    fresh = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    # The caller is not logged out by their own change.
    assert (await client.get("/api/auth/me", headers=fresh)).status_code == 200
    # Every other device is.
    assert (await client.get("/api/auth/me", headers=old)).status_code == 401

    # And the new password is the one that works now.
    assert (
        await client.post(
            "/api/auth/login", json={"phone": user.phone, "password": "a-brand-new-password"}
        )
    ).status_code == 200
    assert (
        await client.post("/api/auth/login", json={"phone": user.phone, "password": PASSWORD})
    ).status_code == 401


async def test_changing_with_the_wrong_current_password_is_rejected(client, with_password):
    user = await with_password()
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": "not-it", "new_password": "a-brand-new-password"},
        headers=auth(user),
    )
    assert resp.status_code == 401
    # The old password still works, so nothing was changed.
    assert (
        await client.post("/api/auth/login", json={"phone": user.phone, "password": PASSWORD})
    ).status_code == 200


async def test_a_short_new_password_is_rejected(client, with_password):
    user = await with_password()
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "short"},
        headers=auth(user),
    )
    assert resp.status_code == 422


async def test_an_absurdly_long_password_is_rejected(client, with_password):
    user = await with_password()
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "x" * 200},
        headers=auth(user),
    )
    assert resp.status_code == 422
