import logging
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_is_sqlite = settings.database_url.startswith("sqlite")

# SQLite (used by the test suite) rejects pool sizing arguments.
_pool_kwargs: dict[str, object] = (
    {}
    if _is_sqlite
    else {
        "pool_size": settings.db_pool_size,
        "max_overflow": settings.db_max_overflow,
        # Drop connections a proxy or Postgres itself may have closed underneath us.
        "pool_recycle": 1800,
    }
)

engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    pool_pre_ping=True,
    **_pool_kwargs,
)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    """Bring the schema up to date.

    Postgres is owned by Alembic. SQLite is only ever the test database, where
    create_all is faster and keeps pytest runnable with no stack up.
    """
    # Imported for the side effect of registering models on SQLModel.metadata.
    from app import models  # noqa: F401

    if _is_sqlite:
        async with engine.begin() as conn:
            await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
            await conn.exec_driver_sql("PRAGMA busy_timeout=5000")
            await conn.run_sync(SQLModel.metadata.create_all)
        return

    # Alembic's API is synchronous, so it runs through run_sync on this
    # connection rather than in a thread of its own.
    async with engine.begin() as conn:
        await conn.run_sync(_upgrade_to_head)


def _alembic_config():
    from alembic.config import Config

    backend_root = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    return cfg


def _upgrade_to_head(connection) -> None:
    """Upgrade using a connection the caller already owns.

    Alembic must not open its own async engine here: that would mean a second
    event loop inside a worker thread, which deadlocks against uvloop.
    """
    from alembic import command

    cfg = _alembic_config()
    cfg.attributes["connection"] = connection
    command.upgrade(cfg, "head")


async def get_session() -> AsyncGenerator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


# Shared alias so routes declare `session: SessionDep` instead of repeating Depends().
SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def seed_first_admin() -> None:
    """Create one admin when the table is empty.

    Identity is picked from the users list, so an empty list is an unusable
    system - nobody could sign in to create the first account.
    """
    from sqlmodel import select

    from app.core.phone import normalize_phone
    from app.core.security import hash_password
    from app.models.user import User

    async with SessionLocal() as session:
        existing = await session.exec(select(User).limit(1))
        if existing.first() is not None:
            return
        session.add(
            User(
                name=settings.admin_name,
                phone=normalize_phone(settings.admin_phone),
                company=settings.app_name,
                role="admin",
                password_hash=hash_password(settings.admin_password),
                password_set_at=datetime.now(UTC),
            )
        )
        await session.commit()


# Name, phone, company. Spread across operator prefixes so they look like real
# contacts rather than a sequence.
_DEMO_AGENTS = [
    ("Karim Uddin", "01711000001", "FieldCo"),
    ("Nusrat Jahan", "01811000002", "FieldCo"),
    ("Rafiq Hasan", "01911000003", "MediSurvey BD"),
]


async def seed_demo_agents() -> None:
    """Seed demo agents on a fresh database, when explicitly enabled.

    Skipped entirely once any agent exists, so it never touches a database
    somebody is really using - including one where the demo agents were
    deliberately removed and then a real agent added.
    """
    if not settings.seed_demo_data:
        return

    from sqlmodel import select

    from app.core.phone import normalize_phone
    from app.core.security import hash_password
    from app.models.user import User

    async with SessionLocal() as session:
        existing = await session.exec(select(User).where(User.role == "agent").limit(1))
        if existing.first() is not None:
            return
        # Hashed once and reused: argon2 is deliberately slow, and three hashes
        # of the same string would add close to a second to every boot.
        demo_hash = hash_password(settings.demo_password)
        for name, phone, company in _DEMO_AGENTS:
            session.add(
                User(
                    name=name,
                    phone=normalize_phone(phone),
                    company=company,
                    role="agent",
                    password_hash=demo_hash,
                    password_set_at=datetime.now(UTC),
                )
            )
        await session.commit()
        logger.info("seeded %d demo agents (SEED_DEMO_DATA is on)", len(_DEMO_AGENTS))
