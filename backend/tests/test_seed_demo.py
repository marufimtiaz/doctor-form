import pytest
from sqlmodel import select

from app.db.session import SessionLocal, seed_demo_agents, seed_first_admin
from app.models.user import User


async def _users() -> list[User]:
    async with SessionLocal() as session:
        result = await session.exec(select(User).order_by(User.name))
        return list(result.all())


@pytest.fixture
def demo_on(monkeypatch):
    from app.db import session as session_module

    monkeypatch.setattr(session_module.settings, "seed_demo_data", True)


@pytest.fixture
def demo_off(monkeypatch):
    from app.db import session as session_module

    monkeypatch.setattr(session_module.settings, "seed_demo_data", False)


async def test_demo_agents_are_not_seeded_by_default(demo_off):
    await seed_first_admin()
    await seed_demo_agents()
    assert [u.role for u in await _users()] == ["admin"]


async def test_demo_agents_are_seeded_when_enabled(demo_on):
    await seed_first_admin()
    await seed_demo_agents()

    users = await _users()
    assert sum(u.role == "admin" for u in users) == 1
    agents = [u for u in users if u.role == "agent"]
    assert len(agents) >= 3
    # Seeded through the same normalizer as everything else.
    assert all(u.phone.startswith("+880") for u in agents)
    assert len({u.phone for u in agents}) == len(agents)


async def test_seeding_twice_does_not_duplicate(demo_on):
    await seed_first_admin()
    await seed_demo_agents()
    first = await _users()

    # Simulates a container restart.
    await seed_first_admin()
    await seed_demo_agents()
    assert len(await _users()) == len(first)


async def test_demo_agents_are_not_re_added_once_agents_exist(demo_on, make_user):
    """A real agent in the table means this is no longer a fresh install."""
    await seed_first_admin()
    await make_user(role="agent", name="Real Person")
    await seed_demo_agents()

    names = [u.name for u in await _users()]
    assert "Real Person" in names
    assert len(names) == 2  # the seeded admin and the real agent, nothing else


async def test_the_seeded_admin_can_log_in(client):
    """Without this the system is unusable on first boot: no login, and no way
    to create a user who could."""
    from app.core.config import get_settings

    settings = get_settings()
    resp = await client.post(
        "/api/auth/login",
        json={"phone": settings.admin_phone, "password": settings.admin_password},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["role"] == "admin"


async def test_seeded_demo_agents_can_log_in(client, demo_on):
    from app.core.config import get_settings

    await seed_demo_agents()
    settings = get_settings()

    resp = await client.post(
        "/api/auth/login",
        json={"phone": "01711000001", "password": settings.demo_password},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["role"] == "agent"


async def _replace_seeded_admin(name: str, password_hash: str | None = None) -> None:
    """Stand in for a database that predates authentication.

    The client fixture's lifespan has already seeded an admin on this phone, so
    it is removed first; the phone column is unique.
    """
    from sqlalchemy import delete

    from app.core.config import get_settings
    from app.db.session import SessionLocal
    from app.models.user import User

    settings = get_settings()
    async with SessionLocal() as session:
        await session.exec(delete(User))
        session.add(
            User(
                name=name,
                phone=settings.admin_phone,
                company="Legacy",
                role="admin",
                password_hash=password_hash,
            )
        )
        await session.commit()


async def test_an_existing_admin_without_a_password_is_adopted(client):
    """Upgrade path: the seed only fires on an empty table, so a database that
    predates authentication would otherwise have an admin nobody can log in as
    and no way to fix it short of direct SQL."""
    from app.core.config import get_settings
    from app.db.session import seed_first_admin

    settings = get_settings()
    await _replace_seeded_admin("Old Admin")

    await seed_first_admin()

    resp = await client.post(
        "/api/auth/login",
        json={"phone": settings.admin_phone, "password": settings.admin_password},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["name"] == "Old Admin"


async def test_an_admin_who_already_has_a_password_is_left_alone(client):
    """Adoption must never overwrite a password somebody actually set."""
    from app.core.config import get_settings
    from app.core.security import hash_password
    from app.db.session import seed_first_admin

    settings = get_settings()
    await _replace_seeded_admin("Boss", hash_password("the-password-they-chose"))

    await seed_first_admin()

    assert (
        await client.post(
            "/api/auth/login",
            json={"phone": settings.admin_phone, "password": "the-password-they-chose"},
        )
    ).status_code == 200
    # The env-var password must NOT have been forced onto them.
    assert (
        await client.post(
            "/api/auth/login",
            json={"phone": settings.admin_phone, "password": settings.admin_password},
        )
    ).status_code == 401
