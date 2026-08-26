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
