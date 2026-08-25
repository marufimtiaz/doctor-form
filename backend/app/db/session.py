from collections.abc import AsyncGenerator
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
    """Create tables on first boot."""
    # Imported for the side effect of registering models on SQLModel.metadata.
    from app import models  # noqa: F401

    async with engine.begin() as conn:
        if _is_sqlite:
            # Only meaningful for the file-based test database.
            await conn.exec_driver_sql("PRAGMA journal_mode=WAL")
            await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
            await conn.exec_driver_sql("PRAGMA busy_timeout=5000")
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session() -> AsyncGenerator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


# Shared alias so routes declare `session: SessionDep` instead of repeating Depends().
SessionDep = Annotated[AsyncSession, Depends(get_session)]
