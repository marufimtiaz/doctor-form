import httpx
import pytest
from asgi_lifespan import LifespanManager

from app.main import app


@pytest.fixture
async def client():
    async with LifespanManager(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
            yield c


async def test_healthz(client: httpx.AsyncClient):
    resp = await client.get("/api/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_submissions_empty(client: httpx.AsyncClient):
    resp = await client.get("/api/submissions")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
