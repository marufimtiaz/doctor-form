import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, health, surveys, users
from app.core.config import get_settings
from app.db.session import init_db, seed_demo_agents, seed_first_admin
from app.services.storage import ensure_bucket

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await seed_first_admin()
    await seed_demo_agents()
    try:
        if settings.s3_bootstrap:
            ensure_bucket()
    except Exception:  # noqa: BLE001
        # Storage may still be starting; /readyz will keep reporting until it is up.
        logger.exception("bucket bootstrap failed, continuing")

    ocr_task: asyncio.Task | None = None
    if settings.ocr_mode == "worker":
        from app.workers.ocr import run_worker_forever

        ocr_task = asyncio.create_task(run_worker_forever())

    yield

    if ocr_task is not None:
        ocr_task.cancel()
        with suppress(asyncio.CancelledError):
            await ocr_task


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/docs",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Everything is mounted under /api so one reverse proxy rule covers the backend.
app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(surveys.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
