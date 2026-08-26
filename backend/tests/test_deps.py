from uuid import uuid4

import httpx
from fastapi import FastAPI

from app.core.deps import AdminUser, CurrentUser
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


async def test_malformed_header_is_unauthorized_not_unprocessable():
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"X-User-Id": "not-a-uuid"})
    assert resp.status_code == 401


async def test_unknown_user_is_unauthorized():
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"X-User-Id": str(uuid4())})
    assert resp.status_code == 401


async def test_inactive_user_is_unauthorized(make_user):
    from app.db.session import SessionLocal
    from app.models.user import User

    user = await make_user()
    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.is_active = False
        session.add(row)
        await session.commit()

    async with _probe_client() as c:
        resp = await c.get("/whoami", headers=auth(user))
    assert resp.status_code == 401


async def test_known_active_user_is_resolved(make_user):
    user = await make_user(name="Karim")
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers=auth(user))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Karim", "role": "agent"}


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
