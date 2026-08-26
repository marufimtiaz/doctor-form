from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.command import upgrade
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine
from sqlmodel import SQLModel

from app import models  # noqa: F401  registers tables on SQLModel.metadata

BACKEND_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def alembic_config(tmp_path: Path) -> Config:
    cfg = Config(str(BACKEND_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{tmp_path / 'mig.db'}")
    return cfg


def test_migrations_reach_head(alembic_config: Config):
    upgrade(alembic_config, "head")


def test_migrated_schema_matches_the_models(alembic_config: Config):
    """The migration and the models must not drift apart.

    Drift is silent until a column is missing in production, so it is worth a
    test rather than a convention.
    """
    upgrade(alembic_config, "head")
    engine = create_engine(alembic_config.get_main_option("sqlalchemy.url"))
    with engine.connect() as conn:
        context = MigrationContext.configure(conn)
        diff = compare_metadata(context, SQLModel.metadata)
    engine.dispose()
    assert diff == [], f"models and migrations disagree: {diff}"
