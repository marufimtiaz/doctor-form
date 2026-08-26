import os
from collections.abc import AsyncGenerator
from uuid import uuid4

# Must be set before app.core.config is imported, since Settings is cached.
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("S3_BOOTSTRAP", "false")

import httpx  # noqa: E402
import pytest  # noqa: E402
from asgi_lifespan import LifespanManager  # noqa: E402
from moto import mock_aws  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402
from app.services import storage  # noqa: E402


@pytest.fixture(autouse=True)
async def clean_database() -> AsyncGenerator[None]:
    """Every test starts from an empty schema.

    Identity is a database row here, so leaked users from a previous test would
    make role assertions pass for the wrong reason.
    """
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)
    yield


@pytest.fixture
def s3() -> AsyncGenerator[None]:
    """In-process S3. Real boto3 calls execute, so keys, content types and
    presigning are genuinely exercised - unlike stubbing upload_fileobj, which
    would only prove our code calls a function we replaced."""
    with mock_aws():
        # The clients are lru_cached, so a client built before the mock started
        # would talk to the real endpoint.
        storage.get_s3_client.cache_clear()
        storage.get_presign_client.cache_clear()
        storage.ensure_bucket()
        yield
    storage.get_s3_client.cache_clear()
    storage.get_presign_client.cache_clear()


@pytest.fixture
async def client() -> AsyncGenerator[httpx.AsyncClient]:
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


@pytest.fixture
async def make_user():
    """Create a user directly, bypassing the API.

    Tests need an admin to exist before they can call an admin-only route, so
    this cannot go through POST /api/users without a bootstrap paradox.
    """

    async def _make(role: str = "agent", name: str = "Karim", phone: str | None = None) -> User:
        async with SessionLocal() as session:
            user = User(
                name=name,
                phone=phone or f"+88017{uuid4().int % 100000000:08d}",
                company="FieldCo",
                role=role,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user

    return _make


def auth(user: User) -> dict[str, str]:
    """Headers that identify `user`. Where a bearer token will go later."""
    return {"X-User-Id": str(user.id)}
