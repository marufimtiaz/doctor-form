import time
from uuid import uuid4

import httpx
import jwt
from fastapi import FastAPI

from app.core.config import get_settings
from app.core.deps import AdminUser, CurrentUser
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.user import User
from tests.conftest import auth


def _probe_app() -> FastAPI:
    """A throwaway app exposing the two dependencies directly, so these tests
    describe the auth surface rather than any particular business route."""
    probe = FastAPI()

    @probe.get("/whoami")
    async def whoami(user: CurrentUser) -> dict[str, str]:
        return {"name": user.name, "role": user.role}

    @probe.get("/admin-only")
    async def admin_only(user: AdminUser) -> dict[str, str]:
        return {"name": user.name}

    return probe


def _probe_client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=_probe_app())
    return httpx.AsyncClient(transport=transport, base_url="http://probe")


async def test_missing_header_is_unauthorized():
    async with _probe_client() as c:
        assert (await c.get("/whoami")).status_code == 401


async def test_header_without_the_bearer_scheme_is_unauthorized(make_user):
    user = await make_user()
    token = create_access_token(user.id, user.token_version)
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": token})
    assert resp.status_code == 401


async def test_garbage_token_is_unauthorized():
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": "Bearer nonsense"})
    assert resp.status_code == 401


async def test_token_for_an_unknown_user_is_unauthorized():
    async with _probe_client() as c:
        resp = await c.get(
            "/whoami", headers={"Authorization": f"Bearer {create_access_token(uuid4(), 1)}"}
        )
    assert resp.status_code == 401


async def test_token_signed_with_another_secret_is_unauthorized(make_user):
    user = await make_user()
    forged = jwt.encode(
        {"sub": str(user.id), "ver": 1, "exp": int(time.time()) + 600},
        "an-attackers-secret-long-enough-for-hmac",
        algorithm="HS256",
    )
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": f"Bearer {forged}"})
    assert resp.status_code == 401


async def test_expired_token_is_unauthorized(make_user):
    user = await make_user()
    settings = get_settings()
    now = int(time.time())
    expired = jwt.encode(
        {"sub": str(user.id), "ver": user.token_version, "iat": now - 7200, "exp": now - 3600},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": f"Bearer {expired}"})
    assert resp.status_code == 401


async def test_valid_token_resolves_the_user(make_user):
    user = await make_user(name="Karim")
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers=auth(user))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Karim", "role": "agent"}


async def test_deactivation_rejects_an_already_issued_token(make_user):
    """The JWT is unchanged, but the user row is loaded every request anyway."""
    user = await make_user()
    headers = auth(user)
    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 200

    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.is_active = False
        session.add(row)
        await session.commit()

    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 401


async def test_bumping_token_version_rejects_older_tokens(make_user):
    """This is what makes a password change log other devices out."""
    user = await make_user()
    headers = auth(user)
    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 200

    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.token_version += 1
        session.add(row)
        await session.commit()

    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 401


async def test_agent_is_forbidden_from_admin_dependency(make_user):
    user = await make_user(role="agent")
    async with _probe_client() as c:
        resp = await c.get("/admin-only", headers=auth(user))
    assert resp.status_code == 403


async def test_admin_passes_admin_dependency(make_user):
    user = await make_user(role="admin", name="Boss")
    async with _probe_client() as c:
        resp = await c.get("/admin-only", headers=auth(user))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Boss"}
