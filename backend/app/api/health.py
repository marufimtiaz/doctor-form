from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import engine
from app.services.storage import get_s3_client

router = APIRouter(tags=["health"])


@router.get("/healthz")
async def healthz() -> dict[str, str]:
    """Liveness: the process is up. Deliberately does not touch dependencies."""
    return {"status": "ok"}


@router.get("/readyz")
async def readyz() -> dict[str, object]:
    """Readiness: report on each dependency instead of failing at the first one."""
    checks: dict[str, str] = {}

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001 - surfaced in the payload
        checks["database"] = f"error: {exc}"

    try:
        get_s3_client().list_buckets()
        checks["storage"] = "ok"
    except Exception as exc:  # noqa: BLE001 - surfaced in the payload
        checks["storage"] = f"error: {exc}"

    ready = all(v == "ok" for v in checks.values())
    return {"ready": ready, "checks": checks}
