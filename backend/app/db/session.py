from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import get_settings

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
