import atexit
import os
from collections.abc import AsyncGenerator
from uuid import uuid4

from moto.server import ThreadedMotoServer

# Must be set before app.core.config is imported, since Settings is cached.
os.environ["OCR_MODE"] = "off"
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./test.db")
os.environ.setdefault("S3_BOOTSTRAP", "false")
# The startup guard refuses insecure defaults whenever debug is false, and the
# suite does not set DEBUG.
os.environ.setdefault("JWT_SECRET", "test-secret-long-enough-for-hmac-sha256-abcdef")
os.environ.setdefault("ADMIN_PASSWORD", "test-admin-password")

# A real S3 server on localhost, not moto's in-process patching: moto only
# intercepts calls aimed at AWS's own endpoints, and this app always points
# boto3 at a custom endpoint_url (RustFS). Running the server for real keeps
# path-style addressing and presigning under test against a non-AWS host,
# which is exactly what production does.
_moto_server = ThreadedMotoServer(port=0, verbose=False)
_moto_server.start()
atexit.register(_moto_server.stop)
_moto_host, _moto_port = _moto_server.get_host_and_port()
os.environ["S3_ENDPOINT_URL"] = f"http://{_moto_host}:{_moto_port}"
os.environ["S3_PUBLIC_ENDPOINT_URL"] = f"http://{_moto_host}:{_moto_port}"
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")

import httpx  # noqa: E402
import pytest  # noqa: E402
from asgi_lifespan import LifespanManager  # noqa: E402
from sqlmodel import SQLModel  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.core.security import create_access_token  # noqa: E402
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
    """A bucket on the local moto server, emptied between tests.

    Real boto3 calls go over real HTTP, so keys, content types and presigning
    are genuinely exercised - unlike stubbing upload_fileobj, which would only
    prove our code calls a function we replaced.
    """
    bucket = get_settings().s3_bucket
    storage.ensure_bucket()
    yield
    client = storage.get_s3_client()
    listing = client.list_objects_v2(Bucket=bucket)
    for obj in listing.get("Contents", []):
        client.delete_object(Bucket=bucket, Key=obj["Key"])


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
    """Headers that authenticate `user`.

    The single place tests build credentials, which is why swapping the whole
    identity mechanism leaves the other test modules untouched.
    """
    token = create_access_token(user.id, user.token_version)
    return {"Authorization": f"Bearer {token}"}
