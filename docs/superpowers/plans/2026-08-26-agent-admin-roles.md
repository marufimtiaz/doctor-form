# Agent / Admin Roles and Chamber Surveys — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder submission scaffold with a role-scoped system where field agents file chamber surveys they alone can see, and admins see everything.

**Architecture:** A `users` table whose rows are *selected* rather than authenticated — the client sends `X-User-Id`, and `get_current_user` resolves it exactly where a token would later be verified. Surveys belong to the agent who filed them; availability slots and chamber phones are child tables. Alembic owns the Postgres schema from the first commit; the SQLite test suite keeps using `create_all`.

**Tech Stack:** FastAPI, SQLModel, asyncpg/Postgres, Alembic, boto3 against RustFS, `phonenumbers`, pytest + `moto`, React 19 + react-router-dom, Vite, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-26-agent-admin-roles-design.md`

## Global Constraints

- Python `>=3.14`. Ruff `line-length = 100`, lint `select = ["E", "F", "I", "UP", "B"]`. Run `uv run ruff check .` before every commit.
- `pytest` must pass on a bare checkout with **no docker compose stack running**. Never add a test that needs Postgres or RustFS.
- `asyncio_mode = "auto"` — async test functions need no decorator.
- Every route lives under `/api`; the browser always talks to a same-origin `/api`.
- Money is `int` taka. Never a float.
- `day_of_week` is `0=Monday … 6=Sunday` (`datetime.weekday()`). The UI renders Sat→Fri; the database never stores display order.
- All phone numbers — users' and chambers' — are normalized to E.164 before they are stored or compared.
- "Today" is an `Asia/Dhaka` day, from `settings.app_timezone`. Never a UTC day.
- Deletion is soft. Nothing in this plan calls `storage.delete_object`.
- **The frontend has no test runner.** Its gate is `npm run build` (which runs `tsc --noEmit`) plus the stated manual check. Adding vitest is out of scope; note it as a known gap.

---

## File Structure

**Backend, new**

| File | Responsibility |
|---|---|
| `app/core/phone.py` | `normalize_phone()` — the only place E.164 formatting happens |
| `app/core/timeutil.py` | `day_bounds_utc()` — the only place a Dhaka day becomes a UTC range |
| `app/core/deps.py` | `get_current_user`, `require_admin` — the entire auth surface |
| `app/models/user.py` | `User` |
| `app/models/survey.py` | `ChamberSurvey` + its two CHECK constraints |
| `app/models/availability.py` | `AvailabilitySlot` |
| `app/models/survey_phone.py` | `SurveyPhone` (named to avoid colliding with `core/phone.py`) |
| `app/schemas/user.py` | `UserCreate`, `UserPublic`, `UserUpdate` |
| `app/schemas/survey.py` | `SlotIn`, `PhoneIn`, `SurveyCreate`, `SurveyRead`, `StatsRead`, `AdminStatsRead` |
| `app/api/users.py` | identity picker feed + admin user management |
| `app/api/surveys.py` | the agent's own surveys and stats |
| `app/api/admin.py` | all surveys, overall stats, soft delete |
| `alembic/`, `alembic.ini` | schema ownership for Postgres |

**Backend, deleted:** `app/models/submission.py`, `app/schemas/submission.py`, `app/api/submissions.py`

**Frontend, new**

| File | Responsibility |
|---|---|
| `src/auth.tsx` | `IdentityProvider`, `useIdentity`, `RequireAdmin` |
| `src/routes/AgentPage.tsx` | own stats + survey form + own surveys |
| `src/routes/AdminPage.tsx` | overall stats + per-agent table + all surveys + add agent |
| `src/components/SlotEditor.tsx` | availability repeater, min 1 |
| `src/components/PhoneEditor.tsx` | chamber phone repeater, min 1 |
| `src/components/LocationInput.tsx` | geolocation + city/district, enforces "either pair" |
| `src/components/NameplateInput.tsx` | required image, preview, 10MB pre-check |

---

## Task 1: Phone normalization and time windows

**Files:**
- Create: `backend/app/core/phone.py`, `backend/app/core/timeutil.py`
- Modify: `backend/pyproject.toml`, `backend/app/core/config.py`
- Test: `backend/tests/test_core_utils.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalize_phone(raw: str, region: str = "BD") -> str` — raises `ValueError` on unparseable/invalid input.
  - `day_bounds_utc(tz_name: str, at: datetime | None = None) -> tuple[datetime, datetime]` — returns `[start, end)` in UTC for the local day containing `at`.
  - `Settings.app_timezone: str = "Asia/Dhaka"`, `Settings.admin_name: str = "Admin"`, `Settings.admin_phone: str = "+8801700000000"`.

- [ ] **Step 1: Add the runtime dependency**

```bash
cd backend && uv add phonenumbers
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_core_utils.py`:

```python
from datetime import UTC, datetime

import pytest

from app.core.phone import normalize_phone
from app.core.timeutil import day_bounds_utc


def test_local_number_becomes_e164():
    assert normalize_phone("01712345678") == "+8801712345678"


def test_already_e164_is_unchanged():
    assert normalize_phone("+8801712345678") == "+8801712345678"


def test_spacing_and_punctuation_are_ignored():
    assert normalize_phone("017-1234 5678") == "+8801712345678"


def test_garbage_raises_value_error():
    with pytest.raises(ValueError):
        normalize_phone("not a phone")


def test_too_short_raises_value_error():
    with pytest.raises(ValueError):
        normalize_phone("12")


def test_dhaka_day_starts_six_hours_before_utc_midnight():
    # 2026-08-26 19:00Z is 2026-08-27 01:00 in Dhaka (UTC+6), so the day
    # containing it starts at 2026-08-26 18:00Z.
    at = datetime(2026, 8, 26, 19, 0, tzinfo=UTC)
    start, end = day_bounds_utc("Asia/Dhaka", at)
    assert start == datetime(2026, 8, 26, 18, 0, tzinfo=UTC)
    assert end == datetime(2026, 8, 27, 18, 0, tzinfo=UTC)


def test_moment_just_before_local_midnight_belongs_to_the_earlier_day():
    at = datetime(2026, 8, 26, 17, 59, tzinfo=UTC)  # 23:59 Dhaka on the 26th
    start, _ = day_bounds_utc("Asia/Dhaka", at)
    assert start == datetime(2026, 8, 25, 18, 0, tzinfo=UTC)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_core_utils.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.phone'`

- [ ] **Step 4: Implement `app/core/phone.py`**

```python
import phonenumbers
from phonenumbers import NumberParseException

# Numbers are typed by agents in Bangladesh, so a bare "017…" is a BD number.
DEFAULT_REGION = "BD"


def normalize_phone(raw: str, region: str = DEFAULT_REGION) -> str:
    """Return `raw` as E.164, e.g. "+8801712345678".

    Raises ValueError when the input cannot be parsed or is not a real number.
    Every phone that reaches the database goes through here, so a uniqueness
    constraint on the column means what it appears to mean.
    """
    try:
        parsed = phonenumbers.parse(raw, region)
    except NumberParseException as exc:
        raise ValueError(f"could not parse phone number: {raw!r}") from exc
    if not phonenumbers.is_valid_number(parsed):
        raise ValueError(f"not a valid phone number: {raw!r}")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
```

- [ ] **Step 5: Implement `app/core/timeutil.py`**

```python
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo


def day_bounds_utc(tz_name: str, at: datetime | None = None) -> tuple[datetime, datetime]:
    """Half-open UTC range [start, end) covering the local day containing `at`.

    Counts are reported per local day. Comparing against a UTC day would roll
    the agents' day over at 06:00 local and make every daily figure wrong.
    """
    tz = ZoneInfo(tz_name)
    moment = at or datetime.now(UTC)
    local = moment.astimezone(tz)
    start_local = local.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(UTC), end_local.astimezone(UTC)
```

- [ ] **Step 6: Add the settings**

In `backend/app/core/config.py`, inside `class Settings`, immediately after `debug: bool = False`:

```python
    # Counts are reported per local day; see app/core/timeutil.py.
    app_timezone: str = "Asia/Dhaka"

    # Identity is chosen from the users list, so the list cannot start empty.
    # These seed the first admin on boot when no users exist.
    admin_name: str = "Admin"
    admin_phone: str = "+8801700000000"
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && uv run pytest tests/test_core_utils.py -v`
Expected: PASS, 7 tests

- [ ] **Step 8: Lint and commit**

```bash
cd backend && uv run ruff check . && cd ..
git add backend/app/core/phone.py backend/app/core/timeutil.py \
        backend/app/core/config.py backend/tests/test_core_utils.py \
        backend/pyproject.toml backend/uv.lock
git commit -m "feat(core): E.164 phone normalization and Dhaka day windows"
```

---

## Task 2: Models, and removal of the placeholder scaffold

**Files:**
- Create: `backend/app/models/user.py`, `backend/app/models/survey.py`, `backend/app/models/availability.py`, `backend/app/models/survey_phone.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/main.py`, `backend/tests/test_health.py`
- Delete: `backend/app/models/submission.py`, `backend/app/schemas/submission.py`, `backend/app/api/submissions.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `User`, `ChamberSurvey`, `AvailabilitySlot`, `SurveyPhone`. Column names are exactly as written below; every later task refers to them.

The app must still boot after this task. The survey routes do not exist yet — that is fine, and `/api/healthz` proves the app is coherent.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_models.py`:

```python
import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession

from app.models.availability import AvailabilitySlot
from app.models.survey import ChamberSurvey
from app.models.survey_phone import SurveyPhone
from app.models.user import User


@pytest.fixture
async def session():
    """In-memory database, independent of the app's engine."""
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(SQLModel.metadata.create_all)
    async with AsyncSession(engine) as s:
        yield s
    await engine.dispose()


async def _agent(session: AsyncSession) -> User:
    user = User(name="Karim", phone="+8801712345678", company="FieldCo")
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def test_user_defaults_to_active_agent(session: AsyncSession):
    user = await _agent(session)
    assert user.role == "agent"
    assert user.is_active is True


async def test_user_phone_is_unique(session: AsyncSession):
    await _agent(session)
    session.add(User(name="Other", phone="+8801712345678", company="FieldCo"))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_user_role_is_constrained(session: AsyncSession):
    session.add(User(name="X", phone="+8801812345678", company="C", role="wizard"))
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_survey_accepts_coordinates_only(session: AsyncSession):
    user = await _agent(session)
    session.add(
        ChamberSurvey(
            user_id=user.id,
            hospital_name="Square",
            latitude=23.75,
            longitude=90.39,
            nameplate_key="surveys/a.jpg",
            daily_patients=30,
            avg_duration_min=10,
            consultation_fee_bdt=1000,
        )
    )
    await session.commit()


async def test_survey_accepts_place_only(session: AsyncSession):
    user = await _agent(session)
    session.add(
        ChamberSurvey(
            user_id=user.id,
            hospital_name="Square",
            city="Dhaka",
            district="Dhaka",
            nameplate_key="surveys/a.jpg",
            daily_patients=30,
            avg_duration_min=10,
            consultation_fee_bdt=1000,
        )
    )
    await session.commit()


async def test_survey_with_no_location_is_rejected_by_the_database(session: AsyncSession):
    user = await _agent(session)
    session.add(
        ChamberSurvey(
            user_id=user.id,
            hospital_name="Square",
            nameplate_key="surveys/a.jpg",
            daily_patients=30,
            avg_duration_min=10,
            consultation_fee_bdt=1000,
        )
    )
    with pytest.raises(IntegrityError):
        await session.commit()


async def test_survey_starts_pending_ocr_and_undeleted(session: AsyncSession):
    user = await _agent(session)
    survey = ChamberSurvey(
        user_id=user.id,
        hospital_name="Square",
        city="Dhaka",
        district="Dhaka",
        nameplate_key="surveys/a.jpg",
        daily_patients=30,
        avg_duration_min=10,
        consultation_fee_bdt=1000,
    )
    session.add(survey)
    await session.commit()
    await session.refresh(survey)
    assert survey.ocr_status == "pending"
    assert survey.deleted_at is None
    assert survey.doctor_name is None


async def test_children_attach_to_a_survey(session: AsyncSession):
    user = await _agent(session)
    survey = ChamberSurvey(
        user_id=user.id,
        hospital_name="Square",
        city="Dhaka",
        district="Dhaka",
        nameplate_key="surveys/a.jpg",
        daily_patients=30,
        avg_duration_min=10,
        consultation_fee_bdt=1000,
    )
    session.add(survey)
    await session.commit()
    await session.refresh(survey)

    session.add(AvailabilitySlot(survey_id=survey.id, day_of_week=5, start_time="17:00:00"))
    session.add(SurveyPhone(survey_id=survey.id, phone="+8801712345678"))
    await session.commit()
```

Note: `AvailabilitySlot` needs `end_time` too — the step above deliberately
omits it so you see the failure. Add `end_time="20:00:00"` when you implement.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && uv run pytest tests/test_models.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.models.user'`

- [ ] **Step 3: Create `app/models/user.py`**

```python
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Column, DateTime
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class User(SQLModel, table=True):
    """A person who uses the system. Selected, not yet authenticated."""

    __tablename__ = "users"
    # VARCHAR + CHECK rather than a native Postgres ENUM: enums are awkward to
    # alter and do not exist in SQLite, which the test suite runs on.
    __table_args__ = (CheckConstraint("role IN ('agent', 'admin')", name="ck_users_role"),)

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    name: str = Field(index=True, max_length=200)
    # Stored E.164 by app/core/phone.py, so uniqueness means what it looks like.
    phone: str = Field(unique=True, max_length=32)
    company: str = Field(index=True, max_length=200)
    role: str = Field(default="agent", max_length=16)
    is_active: bool = Field(default=True)
    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
```

- [ ] **Step 4: Create `app/models/survey.py`**

```python
from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Column, DateTime
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(UTC)


class ChamberSurvey(SQLModel, table=True):
    """One doctor's chamber as recorded by an agent on site."""

    __tablename__ = "chamber_surveys"
    __table_args__ = (
        # Either precise coordinates or a named place. Requiring coordinates
        # would block an agent whose browser denies geolocation; requiring a
        # place would throw away good GPS.
        CheckConstraint(
            "(latitude IS NOT NULL AND longitude IS NOT NULL) "
            "OR (city IS NOT NULL AND district IS NOT NULL)",
            name="ck_surveys_location",
        ),
        CheckConstraint(
            "ocr_status IN ('pending', 'done', 'failed')", name="ck_surveys_ocr_status"
        ),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    user_id: UUID = Field(foreign_key="users.id", index=True)

    hospital_name: str = Field(index=True, max_length=200)
    city: str | None = Field(default=None, index=True, max_length=100)
    district: str | None = Field(default=None, index=True, max_length=100)
    latitude: float | None = Field(default=None)
    longitude: float | None = Field(default=None)

    # Required: the nameplate is the only source of doctor identity, so a
    # survey without one could never be attributed.
    nameplate_key: str = Field(max_length=1024)

    daily_patients: int
    avg_duration_min: int
    consultation_fee_bdt: int

    # Filled by a future OCR pass that is not part of this project. The status
    # records that the work is pending rather than leaving it invisible.
    ocr_status: str = Field(default="pending", max_length=16)
    doctor_name: str | None = Field(default=None, max_length=200)
    doctor_degrees: str | None = Field(default=None, max_length=1000)
    doctor_specializations: str | None = Field(default=None, max_length=1000)

    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), index=True, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    # Soft delete: field data an admin destroys is field data nobody can audit.
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), index=True, nullable=True),
    )
```

- [ ] **Step 5: Create `app/models/availability.py`**

```python
from datetime import time
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint
from sqlmodel import Field, SQLModel


class AvailabilitySlot(SQLModel, table=True):
    """One "the doctor sits here from X to Y on day D" row."""

    __tablename__ = "availability_slots"
    __table_args__ = (
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="ck_slots_day_of_week"),
        CheckConstraint("end_time > start_time", name="ck_slots_time_order"),
    )

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    survey_id: UUID = Field(foreign_key="chamber_surveys.id", index=True, ondelete="CASCADE")
    # 0=Monday .. 6=Sunday, matching datetime.weekday(). The UI renders Sat
    # first; display order is never stored.
    day_of_week: int
    start_time: time
    end_time: time
```

- [ ] **Step 6: Create `app/models/survey_phone.py`**

```python
from uuid import UUID, uuid4

from sqlmodel import Field, SQLModel


class SurveyPhone(SQLModel, table=True):
    """A contact number for the chamber. Deliberately not unique — several
    doctors sharing one hospital reception line is normal."""

    __tablename__ = "survey_phones"

    id: UUID = Field(default_factory=uuid4, primary_key=True)
    survey_id: UUID = Field(foreign_key="chamber_surveys.id", index=True, ondelete="CASCADE")
    phone: str = Field(index=True, max_length=32)
```

- [ ] **Step 7: Register the models**

Replace the contents of `backend/app/models/__init__.py`:

```python
from app.models.availability import AvailabilitySlot
from app.models.survey import ChamberSurvey
from app.models.survey_phone import SurveyPhone
from app.models.user import User

__all__ = ["AvailabilitySlot", "ChamberSurvey", "SurveyPhone", "User"]
```

- [ ] **Step 8: Delete the placeholder scaffold**

```bash
git rm backend/app/models/submission.py backend/app/schemas/submission.py \
       backend/app/api/submissions.py
```

In `backend/app/main.py`, change the import and drop the router line:

```python
from app.api import health          # was: from app.api import health, submissions
```

```python
app.include_router(health.router, prefix="/api")
# delete: app.include_router(submissions.router, prefix="/api")
```

In `backend/tests/test_health.py`, delete `test_submissions_empty` entirely — the
endpoint it asserts on no longer exists.

- [ ] **Step 9: Fix the deliberately broken test**

In `tests/test_models.py::test_children_attach_to_a_survey`, add the missing
`end_time`:

```python
    session.add(
        AvailabilitySlot(
            survey_id=survey.id, day_of_week=5, start_time="17:00:00", end_time="20:00:00"
        )
    )
```

- [ ] **Step 10: Run the whole suite**

Run: `cd backend && uv run pytest -v`
Expected: PASS — 8 model tests, 1 health test. No errors importing `app.main`.

- [ ] **Step 11: Lint and commit**

```bash
cd backend && uv run ruff check . && cd ..
git add -A backend/app backend/tests
git commit -m "feat(models): users, chamber surveys, slots and phones

Replaces the placeholder submission scaffold, whose patient_name/email/notes
columns described a demo rather than the domain."
```

---

## Task 3: Alembic owns the Postgres schema

**Files:**
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/script.py.mako`, `backend/alembic/versions/0001_initial.py`
- Modify: `backend/app/db/session.py`, `backend/Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `backend/pyproject.toml`
- Test: `backend/tests/test_migrations.py`

**Interfaces:**
- Consumes: every model from Task 2.
- Produces: `init_db()` keeps its signature — Postgres gets `alembic upgrade head`, SQLite keeps `create_all`.

The valuable test here is that **the migration and the models agree**. Autogenerate drift is the classic Alembic failure, and it is silent until production.

- [ ] **Step 1: Add the dependency and scaffold**

```bash
cd backend && uv add alembic && uv run alembic init -t async alembic
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_migrations.py`:

```python
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
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd backend && uv run pytest tests/test_migrations.py -v`
Expected: FAIL — no revision files exist yet, so `test_migrated_schema_matches_the_models` reports every table as missing.

- [ ] **Step 4: Replace `alembic/env.py` wholesale**

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from sqlmodel import SQLModel

from app import models  # noqa: F401  registers tables on SQLModel.metadata
from app.core.config import get_settings

config = context.config

# The URL lives in settings, not alembic.ini, so there is one source of truth.
# Tests override it via cfg.set_main_option before calling upgrade().
if not config.get_main_option("sqlalchemy.url", None):
    config.set_main_option("sqlalchemy.url", get_settings().database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # SQLite cannot ALTER; batch mode rebuilds the table instead. Harmless
        # on Postgres, and it keeps the test path working.
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    url = config.get_main_option("sqlalchemy.url")
    if url.startswith("sqlite:///"):
        # Synchronous URL, used by the test suite.
        from sqlalchemy import create_engine

        engine = create_engine(url, poolclass=pool.NullPool)
        with engine.connect() as connection:
            do_run_migrations(connection)
        engine.dispose()
        return
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 5: Teach the migration template about SQLModel's column types**

SQLModel renders string columns as `sqlmodel.sql.sqltypes.AutoString`, so every
generated migration needs that import or it fails at runtime with `NameError`.

In `backend/alembic/script.py.mako`, directly after the `import sqlalchemy as sa` line:

```python
import sqlmodel
```

- [ ] **Step 6: Generate the initial revision**

```bash
cd backend && DATABASE_URL="sqlite:///./_autogen.db" \
  uv run alembic revision --autogenerate -m "initial schema"
mv alembic/versions/*_initial_schema.py alembic/versions/0001_initial.py
rm -f _autogen.db
```

Open `alembic/versions/0001_initial.py` and confirm it contains `users`,
`chamber_surveys`, `availability_slots`, `survey_phones`, all four
`CheckConstraint`s by name, and **no** `submissions` table. Set
`revision = "0001"` and `down_revision = None`.

- [ ] **Step 7: Run the migration tests**

Run: `cd backend && uv run pytest tests/test_migrations.py -v`
Expected: PASS, 2 tests. If `compare_metadata` reports a diff, the autogenerate
missed something — fix the revision, not the test.

- [ ] **Step 8: Run migrations on boot for Postgres only**

In `backend/app/db/session.py`, replace `init_db` and add the helper:

```python
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

    # Alembic's API is synchronous; run it off the event loop.
    await asyncio.to_thread(_upgrade_to_head)


def _upgrade_to_head() -> None:
    from alembic import command
    from alembic.config import Config

    backend_root = Path(__file__).resolve().parents[2]
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")
```

Add to the imports at the top of the file:

```python
import asyncio
from pathlib import Path
```

- [ ] **Step 9: Put Alembic into the image**

The `Dockerfile` currently copies only `app/`, so without this the container
starts and immediately fails to find `alembic.ini`.

In `backend/Dockerfile`, in the **builder** stage after `COPY app ./app`:

```dockerfile
COPY alembic.ini ./alembic.ini
COPY alembic ./alembic
```

In the **runtime** stage, after the existing `COPY --from=builder … /app/app`:

```dockerfile
COPY --from=builder --chown=app:app /app/alembic.ini /app/alembic.ini
COPY --from=builder --chown=app:app /app/alembic /app/alembic
```

- [ ] **Step 10: Mount Alembic in dev so new revisions are visible without a rebuild**

In `docker-compose.yml`, under `backend.volumes`, after the existing app mount:

```yaml
      - ./backend/alembic:/app/alembic:ro
      - ./backend/alembic.ini:/app/alembic.ini:ro
```

Leave `docker-compose.prod.yml` alone — production runs the baked image, and
migrations run from the lifespan hook, so the `uvicorn --reload` command
override in dev does not need to change.

- [ ] **Step 11: Verify the whole suite and the real stack**

```bash
cd backend && uv run pytest -v && uv run ruff check . && cd ..
docker compose up --build -d backend
docker compose logs backend | grep -i "running upgrade"
curl -fsS http://localhost:8000/api/readyz
```

Expected: pytest passes; the log shows Alembic running `0001`; `readyz` reports
`database: ok`.

- [ ] **Step 12: Commit**

```bash
git add -A backend docker-compose.yml
git commit -m "feat(db): Alembic owns the Postgres schema

Introduced while the database is empty, so the baseline revision is trivially
correct. SQLite tests keep create_all so pytest needs no running stack."
```

---

## Task 4: The auth surface

**Files:**
- Create: `backend/app/core/deps.py`
- Test: `backend/tests/conftest.py` (rewrite), `backend/tests/test_deps.py`

**Interfaces:**
- Consumes: `User` from Task 2.
- Produces:
  - `get_current_user(...) -> User`
  - `require_admin(...) -> User`
  - `CurrentUser = Annotated[User, Depends(get_current_user)]`
  - `AdminUser = Annotated[User, Depends(require_admin)]`
  - Test fixtures `client`, `session`, `make_user`, `s3` used by Tasks 5, 7 and 8.

- [ ] **Step 1: Add moto**

```bash
cd backend && uv add --dev moto
```

- [ ] **Step 2: Rewrite `backend/tests/conftest.py`**

The existing file only sets two environment variables. It grows the shared
fixtures every later task depends on.

```python
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
    presigning are genuinely exercised — unlike stubbing upload_fileobj, which
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
```

- [ ] **Step 3: Write the failing tests**

Create `backend/tests/test_deps.py`:

```python
from uuid import uuid4

import httpx
from fastapi import FastAPI

from app.core.deps import AdminUser, CurrentUser
from tests.conftest import auth


def _probe_app() -> FastAPI:
    """A throwaway app exposing the two dependencies directly, so these tests
    describe the auth surface rather than any particular business route."""
    probe = FastAPI()

    @probe.get("/whoami")
    async def whoami(user: CurrentUser) -> dict[str, str]:
        return {"name": user.name, "role": user.role}

    @probe.get("/admin-only")
    async def admin_only(user: AdminUser) -> dict[str, str]:
        return {"name": user.name}

    return probe


async def _probe_client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=_probe_app())
    return httpx.AsyncClient(transport=transport, base_url="http://probe")


async def test_missing_header_is_unauthorized():
    async with await _probe_client() as c:
        assert (await c.get("/whoami")).status_code == 401


async def test_malformed_header_is_unauthorized_not_unprocessable():
    async with await _probe_client() as c:
        resp = await c.get("/whoami", headers={"X-User-Id": "not-a-uuid"})
    assert resp.status_code == 401


async def test_unknown_user_is_unauthorized(make_user):
    async with await _probe_client() as c:
        resp = await c.get("/whoami", headers={"X-User-Id": str(uuid4())})
    assert resp.status_code == 401


async def test_inactive_user_is_unauthorized(make_user):
    from app.db.session import SessionLocal
    from app.models.user import User

    user = await make_user()
    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.is_active = False
        session.add(row)
        await session.commit()

    async with await _probe_client() as c:
        resp = await c.get("/whoami", headers=auth(user))
    assert resp.status_code == 401


async def test_known_active_user_is_resolved(make_user):
    user = await make_user(name="Karim")
    async with await _probe_client() as c:
        resp = await c.get("/whoami", headers=auth(user))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Karim", "role": "agent"}


async def test_agent_is_forbidden_from_admin_dependency(make_user):
    user = await make_user(role="agent")
    async with await _probe_client() as c:
        resp = await c.get("/admin-only", headers=auth(user))
    assert resp.status_code == 403


async def test_admin_passes_admin_dependency(make_user):
    user = await make_user(role="admin", name="Boss")
    async with await _probe_client() as c:
        resp = await c.get("/admin-only", headers=auth(user))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Boss"}
```

- [ ] **Step 4: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_deps.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.core.deps'`

- [ ] **Step 5: Implement `app/core/deps.py`**

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status

from app.db.session import SessionDep
from app.models.user import User


async def get_current_user(
    session: SessionDep,
    x_user_id: Annotated[str | None, Header()] = None,
) -> User:
    """Resolve the caller from the X-User-Id header.

    This is NOT authentication — anyone can send any id. It is the seam where a
    verified token will be read instead, so that swapping in real login touches
    this function and nothing else.

    The header is typed `str` rather than `UUID` on purpose: FastAPI would turn
    a malformed UUID into a 422, and a bad credential should read as 401.
    """
    if x_user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "X-User-Id header required")
    try:
        user_id = UUID(x_user_id)
    except ValueError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed X-User-Id") from None

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unknown or inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def require_admin(user: CurrentUser) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin role required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]
```

- [ ] **Step 6: Run to verify passing**

Run: `cd backend && uv run pytest tests/test_deps.py -v`
Expected: PASS, 7 tests

- [ ] **Step 7: Lint and commit**

```bash
cd backend && uv run ruff check . && cd ..
git add backend/app/core/deps.py backend/tests/conftest.py backend/tests/test_deps.py \
        backend/pyproject.toml backend/uv.lock
git commit -m "feat(auth): X-User-Id identity seam and admin role gate"
```

---

## Task 5: Users API and the first-admin seed

**Files:**
- Create: `backend/app/schemas/user.py`, `backend/app/api/users.py`
- Modify: `backend/app/main.py`, `backend/app/db/session.py`
- Test: `backend/tests/test_users_api.py`

**Interfaces:**
- Consumes: `normalize_phone` (Task 1), `User` (Task 2), `CurrentUser`/`AdminUser` (Task 4).
- Produces: `UserPublic` (fields `id`, `name`, `company`, `role`), `UserCreate`, `UserUpdate`, and `seed_first_admin(session)`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_users_api.py`:

```python
from tests.conftest import auth


async def test_user_list_is_public_and_hides_phone(client, make_user):
    await make_user(name="Karim", company="FieldCo")
    resp = await client.get("/api/users")
    assert resp.status_code == 200
    (row,) = resp.json()
    assert row["name"] == "Karim"
    assert row["company"] == "FieldCo"
    assert row["role"] == "agent"
    # The picker needs names, never contact details.
    assert "phone" not in row


async def test_agent_cannot_create_users(client, make_user):
    agent = await make_user(role="agent")
    resp = await client.post(
        "/api/users",
        json={"name": "New", "phone": "01712345678", "company": "C", "role": "agent"},
        headers=auth(agent),
    )
    assert resp.status_code == 403


async def test_admin_creates_an_agent_with_a_normalized_phone(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "Karim", "phone": "017-1234 5678", "company": "FieldCo"},
        headers=auth(admin),
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "agent"

    # Stored E.164, so the same number in another format collides.
    dup = await client.post(
        "/api/users",
        json={"name": "Other", "phone": "+8801712345678", "company": "FieldCo"},
        headers=auth(admin),
    )
    assert dup.status_code == 409


async def test_admin_can_appoint_another_admin(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "Second", "phone": "01812345678", "company": "HQ", "role": "admin"},
        headers=auth(admin),
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "admin"


async def test_unparseable_phone_is_rejected(client, make_user):
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/users",
        json={"name": "X", "phone": "nonsense", "company": "C"},
        headers=auth(admin),
    )
    assert resp.status_code == 422


async def test_deactivating_a_user_locks_them_out(client, make_user):
    admin = await make_user(role="admin")
    agent = await make_user(role="agent")

    resp = await client.patch(
        f"/api/users/{agent.id}", json={"is_active": False}, headers=auth(admin)
    )
    assert resp.status_code == 200
    assert resp.json()["is_active"] is False

    # The agent's next request fails on identity, not on role.
    locked = await client.get("/api/users", headers=auth(agent))
    assert locked.status_code == 200  # public route, still fine
    denied = await client.post(
        "/api/users",
        json={"name": "X", "phone": "01912345678", "company": "C"},
        headers=auth(agent),
    )
    assert denied.status_code == 401


async def test_agent_cannot_deactivate_anyone(client, make_user):
    agent = await make_user(role="agent")
    victim = await make_user(role="agent")
    resp = await client.patch(
        f"/api/users/{victim.id}", json={"is_active": False}, headers=auth(agent)
    )
    assert resp.status_code == 403


async def test_first_admin_is_seeded_when_the_table_is_empty(client):
    """Identity is chosen from this list, so it cannot start empty."""
    resp = await client.get("/api/users")
    assert resp.status_code == 200
    # clean_database truncates, then the lifespan seed runs on client startup.
    assert [u["role"] for u in resp.json()] == ["admin"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_users_api.py -v`
Expected: FAIL — 404 on every route; the seed test returns `[]`.

- [ ] **Step 3: Create `app/schemas/user.py`**

```python
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.core.phone import normalize_phone


class UserCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=32)
    company: str = Field(min_length=1, max_length=200)
    role: str = "agent"

    @field_validator("phone")
    @classmethod
    def _normalize(cls, value: str) -> str:
        # ValueError here surfaces as a 422 with the message attached.
        return normalize_phone(value)

    @field_validator("role")
    @classmethod
    def _known_role(cls, value: str) -> str:
        if value not in ("agent", "admin"):
            raise ValueError("role must be 'agent' or 'admin'")
        return value


class UserUpdate(BaseModel):
    is_active: bool


class UserPublic(BaseModel):
    """Feeds the identity picker. Deliberately omits phone."""

    id: UUID
    name: str
    company: str
    role: str
    is_active: bool

    model_config = {"from_attributes": True}
```

- [ ] **Step 4: Create `app/api/users.py`**

```python
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.core.deps import AdminUser
from app.db.session import SessionDep
from app.models.user import User
from app.schemas.user import UserCreate, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
async def list_users(session: SessionDep) -> list[User]:
    """Public: the client cannot pick an identity it cannot see.

    UserPublic omits phone, so this exposes names and roles only.
    """
    result = await session.exec(select(User).order_by(User.name))
    return list(result.all())


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, session: SessionDep, _: AdminUser) -> User:
    user = User(
        name=payload.name,
        phone=payload.phone,  # already E.164 via the schema validator
        company=payload.company,
        role=payload.role,
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already registered") from None
    await session.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserPublic)
async def set_user_active(
    user_id: UUID, payload: UserUpdate, session: SessionDep, _: AdminUser
) -> User:
    """The only writer of is_active. Without it the column would be unreachable
    and get_current_user's inactive check would be dead code."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    user.is_active = payload.is_active
    user.updated_at = _utcnow()
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user
```

Add at the top of the file, below the imports:

```python
from datetime import UTC, datetime


def _utcnow() -> datetime:
    return datetime.now(UTC)
```

- [ ] **Step 5: Seed the first admin**

In `backend/app/db/session.py`, append:

```python
async def seed_first_admin() -> None:
    """Create one admin when the table is empty.

    Identity is picked from the users list, so an empty list is an unusable
    system — nobody could sign in to create the first account.
    """
    from sqlmodel import select

    from app.core.phone import normalize_phone
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
            )
        )
        await session.commit()
```

- [ ] **Step 6: Wire it up in `app/main.py`**

```python
from app.api import health, users
from app.db.session import init_db, seed_first_admin
```

Inside `lifespan`, immediately after `await init_db()`:

```python
    await seed_first_admin()
```

And with the other routers:

```python
app.include_router(users.router, prefix="/api")
```

- [ ] **Step 7: Run the tests**

Run: `cd backend && uv run pytest tests/test_users_api.py -v`
Expected: PASS, 8 tests.

If `test_user_list_is_public_and_hides_phone` sees two users, the seed ran
before `make_user`; assert on the agent row specifically rather than
unpacking a single-element list.

- [ ] **Step 8: Full suite, lint, commit**

```bash
cd backend && uv run pytest -v && uv run ruff check . && cd ..
git add backend/app backend/tests
git commit -m "feat(users): identity picker feed, admin user management, first-admin seed"
```

---

## Task 6: Survey request and response schemas

**Files:**
- Create: `backend/app/schemas/survey.py`
- Test: `backend/tests/test_survey_schemas.py`

**Interfaces:**
- Consumes: `normalize_phone` (Task 1).
- Produces: `SlotIn`, `PhoneIn`, `SurveyCreate`, `SurveyRead`, `SlotRead`, `StatsRead`, `AdminStatsRead`, `AgentStat`.

Validation is tested here in isolation, without HTTP, so failures point at the
rule rather than at routing.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_survey_schemas.py`:

```python
import pytest
from pydantic import ValidationError

from app.schemas.survey import SurveyCreate

BASE = {
    "hospital_name": "Square Hospital",
    "daily_patients": 30,
    "avg_duration_min": 10,
    "consultation_fee_bdt": 1200,
    "slots": [{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}],
    "phones": ["01712345678"],
}


def test_coordinates_alone_are_enough():
    survey = SurveyCreate(**BASE, latitude=23.75, longitude=90.39)
    assert survey.city is None


def test_city_and_district_alone_are_enough():
    survey = SurveyCreate(**BASE, city="Dhaka", district="Dhanmondi")
    assert survey.latitude is None


def test_both_pairs_together_are_fine():
    survey = SurveyCreate(**BASE, latitude=23.75, longitude=90.39, city="Dhaka", district="D")
    assert survey.latitude == 23.75


def test_no_location_at_all_is_rejected():
    with pytest.raises(ValidationError, match="coordinates or city and district"):
        SurveyCreate(**BASE)


def test_half_a_coordinate_pair_is_rejected():
    with pytest.raises(ValidationError, match="latitude and longitude"):
        SurveyCreate(**BASE, latitude=23.75)


def test_half_a_place_pair_is_rejected():
    with pytest.raises(ValidationError, match="city and district"):
        SurveyCreate(**BASE, city="Dhaka")


def test_out_of_range_latitude_is_rejected():
    with pytest.raises(ValidationError):
        SurveyCreate(**BASE, latitude=120.0, longitude=90.39)


def test_phones_are_normalized():
    survey = SurveyCreate(**BASE, city="Dhaka", district="D")
    assert survey.phones == ["+8801712345678"]


def test_at_least_one_phone_is_required():
    payload = {**BASE, "phones": []}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_at_least_one_slot_is_required():
    payload = {**BASE, "slots": []}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_slot_end_must_follow_start():
    payload = {**BASE, "slots": [{"day_of_week": 5, "start_time": "20:00", "end_time": "17:00"}]}
    with pytest.raises(ValidationError, match="end_time"):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_day_seven_is_rejected():
    payload = {**BASE, "slots": [{"day_of_week": 7, "start_time": "17:00", "end_time": "20:00"}]}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_zero_patients_is_rejected():
    payload = {**BASE, "daily_patients": 0}
    with pytest.raises(ValidationError):
        SurveyCreate(**payload, city="Dhaka", district="D")


def test_a_free_consultation_is_allowed():
    survey = SurveyCreate(**{**BASE, "consultation_fee_bdt": 0}, city="Dhaka", district="D")
    assert survey.consultation_fee_bdt == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_survey_schemas.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.schemas.survey'`

- [ ] **Step 3: Implement `app/schemas/survey.py`**

```python
from datetime import datetime, time
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.phone import normalize_phone


class SlotIn(BaseModel):
    # 0=Monday .. 6=Sunday, matching datetime.weekday().
    day_of_week: int = Field(ge=0, le=6)
    start_time: time
    end_time: time

    @model_validator(mode="after")
    def _ordered(self) -> "SlotIn":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class SlotRead(BaseModel):
    day_of_week: int
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class SurveyCreate(BaseModel):
    hospital_name: str = Field(min_length=1, max_length=200)

    city: str | None = Field(default=None, max_length=100)
    district: str | None = Field(default=None, max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    daily_patients: int = Field(gt=0)
    avg_duration_min: int = Field(gt=0)
    consultation_fee_bdt: int = Field(ge=0)

    slots: list[SlotIn] = Field(min_length=1)
    phones: list[str] = Field(min_length=1)

    @field_validator("city", "district")
    @classmethod
    def _blank_is_absent(cls, value: str | None) -> str | None:
        # A whitespace-only city must not satisfy the location requirement.
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None

    @field_validator("phones")
    @classmethod
    def _normalize_phones(cls, values: list[str]) -> list[str]:
        return [normalize_phone(v) for v in values]

    @model_validator(mode="after")
    def _has_a_location(self) -> "SurveyCreate":
        """Either precise coordinates or a named place; each pair is
        all-or-nothing. Mirrors the ck_surveys_location CHECK constraint."""
        has_coords = self.latitude is not None and self.longitude is not None
        half_coords = (self.latitude is None) != (self.longitude is None)
        has_place = bool(self.city) and bool(self.district)
        half_place = bool(self.city) != bool(self.district)

        if half_coords:
            raise ValueError("latitude and longitude must be given together")
        if half_place:
            raise ValueError("city and district must be given together")
        if not has_coords and not has_place:
            raise ValueError("provide coordinates or city and district")
        return self


class SurveyRead(BaseModel):
    id: UUID
    user_id: UUID
    hospital_name: str
    city: str | None
    district: str | None
    latitude: float | None
    longitude: float | None
    nameplate_key: str
    nameplate_url: str | None = None
    daily_patients: int
    avg_duration_min: int
    consultation_fee_bdt: int
    ocr_status: str
    doctor_name: str | None
    doctor_degrees: str | None
    doctor_specializations: str | None
    created_at: datetime
    deleted_at: datetime | None = None
    slots: list[SlotRead] = []
    phones: list[str] = []
    # Populated on admin listings only.
    agent_name: str | None = None

    model_config = {"from_attributes": True}


class StatsRead(BaseModel):
    total: int
    today: int


class AgentStat(BaseModel):
    user_id: UUID
    name: str
    total: int
    today: int


class AdminStatsRead(BaseModel):
    total: int
    today: int
    agent_count: int
    per_agent: list[AgentStat]
```

- [ ] **Step 4: Run to verify passing**

Run: `cd backend && uv run pytest tests/test_survey_schemas.py -v`
Expected: PASS, 14 tests

- [ ] **Step 5: Lint and commit**

```bash
cd backend && uv run ruff check . && cd ..
git add backend/app/schemas/survey.py backend/tests/test_survey_schemas.py
git commit -m "feat(schemas): survey validation incl. either-location rule"
```

---

## Task 7: The agent's surveys API

**Files:**
- Create: `backend/app/api/surveys.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_surveys_api.py`

**Interfaces:**
- Consumes: everything from Tasks 1, 2, 4, 6.
- Produces: `survey_to_read(row, slots, phones, agent_name=None) -> SurveyRead`, imported by Task 8.

**Route order matters:** declare `/stats` before `/{survey_id}`, or FastAPI
parses `stats` as a UUID and returns 422.

**SQLite note:** SQLAlchemy's SQLite `DATETIME` drops `tzinfo` when storing.
Because every write goes through `datetime.now(UTC)` and every query bound is
converted to UTC by `day_bounds_utc`, both sides are UTC and comparisons stay
correct. Do not introduce a local-time write path.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_surveys_api.py`:

```python
import io
import json
from datetime import UTC, datetime

from sqlmodel import select

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form(**overrides) -> dict:
    data = {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }
    data.update(overrides)
    return data


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake-jpeg"), "image/jpeg")}


async def test_creating_a_survey_stores_children_and_uploads_the_nameplate(
    client, make_user, s3
):
    agent = await make_user()
    resp = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["user_id"] == str(agent.id)
    assert body["ocr_status"] == "pending"
    assert body["doctor_name"] is None
    assert body["phones"] == ["+8801712345678"]
    assert body["slots"] == [{"day_of_week": 5, "start_time": "17:00:00", "end_time": "20:00:00"}]
    assert body["nameplate_key"].startswith("surveys/")
    assert body["nameplate_url"]


async def test_the_nameplate_is_required(client, make_user, s3):
    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), headers=auth(agent))
    assert resp.status_code == 422


async def test_user_id_in_the_body_is_ignored(client, make_user, s3):
    agent = await make_user()
    other = await make_user()
    resp = await client.post(
        "/api/surveys",
        data=form(user_id=str(other.id)),
        files=nameplate(),
        headers=auth(agent),
    )
    assert resp.status_code == 201
    assert resp.json()["user_id"] == str(agent.id)


async def test_a_survey_with_no_location_is_rejected(client, make_user, s3):
    agent = await make_user()
    data = form()
    del data["city"]
    del data["district"]
    resp = await client.post("/api/surveys", data=data, files=nameplate(), headers=auth(agent))
    assert resp.status_code == 422


async def test_an_agent_sees_only_their_own_surveys(client, make_user, s3):
    a = await make_user(name="A")
    b = await make_user(name="B")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    resp = await client.get("/api/surveys", headers=auth(a))
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["user_id"] == str(a.id)


async def test_fetching_someone_elses_survey_is_a_404_not_a_403(client, make_user, s3):
    a = await make_user()
    b = await make_user()
    created = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(a)
    )
    survey_id = created.json()["id"]

    resp = await client.get(f"/api/surveys/{survey_id}", headers=auth(b))
    # 403 would confirm the id exists. 404 tells them nothing.
    assert resp.status_code == 404


async def test_stats_route_is_not_shadowed_by_the_detail_route(client, make_user, s3):
    agent = await make_user()
    resp = await client.get("/api/surveys/stats", headers=auth(agent))
    assert resp.status_code == 200
    assert resp.json() == {"total": 0, "today": 0}


async def test_stats_count_only_the_callers_surveys(client, make_user, s3):
    a = await make_user()
    b = await make_user()
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    assert (await client.get("/api/surveys/stats", headers=auth(a))).json()["total"] == 1
    assert (await client.get("/api/surveys/stats", headers=auth(b))).json()["total"] == 2


async def test_today_uses_the_dhaka_day_not_the_utc_day(client, make_user, s3):
    """19:00Z on the 26th is 01:00 Dhaka on the 27th.

    Counted as a UTC day it would land on the 26th and every daily figure would
    be off by six hours' worth of surveys.
    """
    agent = await make_user()
    created = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    survey_id = created.json()["id"]

    # Backdate to a moment that belongs to a different UTC day than Dhaka day.
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        row.created_at = datetime(2026, 8, 26, 19, 0, tzinfo=UTC)
        session.add(row)
        await session.commit()

    stats = (await client.get("/api/surveys/stats", headers=auth(agent))).json()
    assert stats["total"] == 1
    # "Today" is the real today, and the row was backdated, so it is excluded.
    assert stats["today"] == 0


async def test_unauthenticated_requests_are_rejected(client):
    assert (await client.get("/api/surveys")).status_code == 401
    assert (await client.get("/api/surveys/stats")).status_code == 401


async def test_the_uploaded_object_really_lands_in_the_bucket(client, make_user, s3):
    from app.core.config import get_settings
    from app.services import storage

    agent = await make_user()
    resp = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    key = resp.json()["nameplate_key"]

    head = storage.get_s3_client().head_object(Bucket=get_settings().s3_bucket, Key=key)
    assert head["ContentType"] == "image/jpeg"


async def test_deleted_surveys_are_hidden_from_the_agent(client, make_user, s3):
    agent = await make_user()
    created = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    survey_id = created.json()["id"]

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        row.deleted_at = datetime.now(UTC)
        session.add(row)
        await session.commit()

    assert (await client.get("/api/surveys", headers=auth(agent))).json() == []
    assert (await client.get(f"/api/surveys/{survey_id}", headers=auth(agent))).status_code == 404
    assert (await client.get("/api/surveys/stats", headers=auth(agent))).json()["total"] == 0
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_surveys_api.py -v`
Expected: FAIL — 404 on every route.

- [ ] **Step 3: Implement `app/api/surveys.py`**

```python
import io
import json
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import get_settings
from app.core.deps import CurrentUser
from app.core.timeutil import day_bounds_utc
from app.db.session import SessionDep
from app.models.availability import AvailabilitySlot
from app.models.survey import ChamberSurvey
from app.models.survey_phone import SurveyPhone
from app.schemas.survey import SlotRead, StatsRead, SurveyCreate, SurveyRead
from app.services import storage

router = APIRouter(prefix="/surveys", tags=["surveys"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
settings = get_settings()


async def survey_to_read(
    session: AsyncSession, row: ChamberSurvey, agent_name: str | None = None
) -> SurveyRead:
    """Assemble a survey with its children and a presigned nameplate URL."""
    out = SurveyRead.model_validate(row)
    slots = await session.exec(
        select(AvailabilitySlot)
        .where(AvailabilitySlot.survey_id == row.id)
        .order_by(AvailabilitySlot.day_of_week, AvailabilitySlot.start_time)
    )
    out.slots = [SlotRead.model_validate(s) for s in slots.all()]
    phones = await session.exec(
        select(SurveyPhone).where(SurveyPhone.survey_id == row.id).order_by(SurveyPhone.phone)
    )
    out.phones = [p.phone for p in phones.all()]
    out.nameplate_url = storage.presigned_get_url(row.nameplate_key)
    out.agent_name = agent_name
    return out


def _parse_json_field(raw: str, field: str) -> object:
    """Multipart cannot nest, so slots and phones arrive as JSON strings."""
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"{field} must be valid JSON"
        ) from exc


# Declared before /{survey_id} — otherwise "stats" is parsed as a UUID.
@router.get("/stats", response_model=StatsRead)
async def my_stats(session: SessionDep, user: CurrentUser) -> StatsRead:
    alive = (ChamberSurvey.user_id == user.id) & (ChamberSurvey.deleted_at.is_(None))
    total = await session.exec(select(func.count()).select_from(ChamberSurvey).where(alive))

    start, end = day_bounds_utc(settings.app_timezone)
    today = await session.exec(
        select(func.count())
        .select_from(ChamberSurvey)
        .where(alive, ChamberSurvey.created_at >= start, ChamberSurvey.created_at < end)
    )
    return StatsRead(total=total.one(), today=today.one())


@router.get("", response_model=list[SurveyRead])
async def list_my_surveys(
    session: SessionDep, user: CurrentUser, limit: int = 50, offset: int = 0
) -> list[SurveyRead]:
    limit = min(max(limit, 1), 200)
    result = await session.exec(
        select(ChamberSurvey)
        .where(ChamberSurvey.user_id == user.id, ChamberSurvey.deleted_at.is_(None))
        .order_by(ChamberSurvey.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [await survey_to_read(session, row) for row in result.all()]


@router.get("/{survey_id}", response_model=SurveyRead)
async def get_my_survey(survey_id: UUID, session: SessionDep, user: CurrentUser) -> SurveyRead:
    row = await session.get(ChamberSurvey, survey_id)
    # 404 rather than 403 for someone else's survey: a 403 would confirm the id
    # exists, which is more than a stranger should learn.
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")
    return await survey_to_read(session, row)


@router.post("", response_model=SurveyRead, status_code=status.HTTP_201_CREATED)
async def create_survey(
    session: SessionDep,
    user: CurrentUser,
    hospital_name: Annotated[str, Form()],
    daily_patients: Annotated[int, Form()],
    avg_duration_min: Annotated[int, Form()],
    consultation_fee_bdt: Annotated[int, Form()],
    slots: Annotated[str, Form()],
    phones: Annotated[str, Form()],
    nameplate: Annotated[UploadFile, File()],
    city: Annotated[str | None, Form()] = None,
    district: Annotated[str | None, Form()] = None,
    latitude: Annotated[float | None, Form()] = None,
    longitude: Annotated[float | None, Form()] = None,
) -> SurveyRead:
    """Multipart so the nameplate and the form arrive in one request.

    `user_id` is taken from the identity header and is never read from the body.
    """
    if not nameplate.filename:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nameplate is required")

    try:
        payload = SurveyCreate(
            hospital_name=hospital_name,
            city=city,
            district=district,
            latitude=latitude,
            longitude=longitude,
            daily_patients=daily_patients,
            avg_duration_min=avg_duration_min,
            consultation_fee_bdt=consultation_fee_bdt,
            slots=_parse_json_field(slots, "slots"),
            phones=_parse_json_field(phones, "phones"),
        )
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, exc.errors()) from exc

    blob = await nameplate.read()
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"nameplate exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
        )
    suffix = nameplate.filename.rsplit(".", 1)[-1] if "." in nameplate.filename else "bin"
    key = f"surveys/{uuid4()}.{suffix}"
    storage.upload_fileobj(io.BytesIO(blob), key, nameplate.content_type)

    row = ChamberSurvey(
        user_id=user.id,
        hospital_name=payload.hospital_name,
        city=payload.city,
        district=payload.district,
        latitude=payload.latitude,
        longitude=payload.longitude,
        nameplate_key=key,
        daily_patients=payload.daily_patients,
        avg_duration_min=payload.avg_duration_min,
        consultation_fee_bdt=payload.consultation_fee_bdt,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    for slot in payload.slots:
        session.add(
            AvailabilitySlot(
                survey_id=row.id,
                day_of_week=slot.day_of_week,
                start_time=slot.start_time,
                end_time=slot.end_time,
            )
        )
    for phone in payload.phones:
        session.add(SurveyPhone(survey_id=row.id, phone=phone))
    await session.commit()

    return await survey_to_read(session, row)
```

The `datetime`/`UTC` import is unused in this file — drop it from the import
block. Ruff's `F401` will catch it if you forget.

- [ ] **Step 4: Register the router**

In `backend/app/main.py`:

```python
from app.api import health, surveys, users
```

```python
app.include_router(surveys.router, prefix="/api")
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_surveys_api.py -v`
Expected: PASS, 12 tests

- [ ] **Step 6: Full suite, lint, commit**

```bash
cd backend && uv run pytest -v && uv run ruff check . && cd ..
git add backend/app backend/tests
git commit -m "feat(surveys): agent-scoped survey creation, listing and stats"
```

---

## Task 8: The admin API

**Files:**
- Create: `backend/app/api/admin.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_admin_api.py`

**Interfaces:**
- Consumes: `AdminUser` (Task 4), `survey_to_read` (Task 7), `AdminStatsRead`/`AgentStat` (Task 6).
- Produces: the `/api/admin/*` routes the frontend calls in Task 11.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_admin_api.py`:

```python
import io
import json
from datetime import UTC, datetime

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form(**overrides) -> dict:
    data = {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }
    data.update(overrides)
    return data


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake-jpeg"), "image/jpeg")}


async def test_every_admin_route_rejects_an_agent(client, make_user):
    agent = await make_user(role="agent")
    for method, path in [
        ("get", "/api/admin/surveys"),
        ("get", "/api/admin/stats"),
        ("delete", f"/api/admin/surveys/{agent.id}"),
    ]:
        resp = await getattr(client, method)(path, headers=auth(agent))
        assert resp.status_code == 403, f"{method} {path} returned {resp.status_code}"


async def test_admin_sees_every_agents_surveys_with_names(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    a = await make_user(name="Karim")
    b = await make_user(name="Rahim")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    resp = await client.get("/api/admin/surveys", headers=auth(admin))
    assert resp.status_code == 200
    assert {row["agent_name"] for row in resp.json()} == {"Karim", "Rahim"}


async def test_admin_can_filter_by_agent_and_district(client, make_user, s3):
    admin = await make_user(role="admin")
    a = await make_user(name="Karim")
    b = await make_user(name="Rahim")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post(
        "/api/surveys", data=form(district="Gulshan"), files=nameplate(), headers=auth(b)
    )

    by_agent = await client.get(f"/api/admin/surveys?user_id={a.id}", headers=auth(admin))
    assert len(by_agent.json()) == 1
    assert by_agent.json()[0]["agent_name"] == "Karim"

    by_district = await client.get(
        "/api/admin/surveys?district=Gulshan", headers=auth(admin)
    )
    assert len(by_district.json()) == 1
    assert by_district.json()[0]["agent_name"] == "Rahim"


async def test_admin_stats_break_down_per_agent(client, make_user, s3):
    admin = await make_user(role="admin")
    a = await make_user(name="Karim")
    b = await make_user(name="Rahim")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(a))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(b))

    stats = (await client.get("/api/admin/stats", headers=auth(admin))).json()
    assert stats["total"] == 3
    assert stats["today"] == 3
    assert sum(row["total"] for row in stats["per_agent"]) == stats["total"]
    assert {row["name"]: row["total"] for row in stats["per_agent"]} == {"Karim": 1, "Rahim": 2}


async def test_delete_is_soft_and_keeps_the_nameplate(client, make_user, s3):
    from app.core.config import get_settings
    from app.services import storage

    admin = await make_user(role="admin")
    agent = await make_user()
    created = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    survey_id = created.json()["id"]
    key = created.json()["nameplate_key"]

    resp = await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))
    assert resp.status_code == 204

    # The row survives with a timestamp; the audit trail is intact.
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        assert row is not None
        assert row.deleted_at is not None

    # And the object is still in storage.
    storage.get_s3_client().head_object(Bucket=get_settings().s3_bucket, Key=key)


async def test_deleted_surveys_are_hidden_by_default_and_visible_on_request(
    client, make_user, s3
):
    admin = await make_user(role="admin")
    agent = await make_user()
    created = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    survey_id = created.json()["id"]
    await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))

    assert (await client.get("/api/admin/surveys", headers=auth(admin))).json() == []
    assert (await client.get("/api/admin/stats", headers=auth(admin))).json()["total"] == 0

    included = await client.get(
        "/api/admin/surveys?include_deleted=true", headers=auth(admin)
    )
    assert len(included.json()) == 1


async def test_deleting_twice_is_a_404(client, make_user, s3):
    admin = await make_user(role="admin")
    agent = await make_user()
    created = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    survey_id = created.json()["id"]

    assert (
        await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))
    ).status_code == 204
    assert (
        await client.delete(f"/api/admin/surveys/{survey_id}", headers=auth(admin))
    ).status_code == 404


async def test_admins_own_surveys_are_included_in_the_totals(client, make_user, s3):
    admin = await make_user(role="admin", name="Boss")
    await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(admin))

    stats = (await client.get("/api/admin/stats", headers=auth(admin))).json()
    assert stats["total"] == 1
    assert {row["name"] for row in stats["per_agent"]} == {"Boss"}


async def test_date_filter_uses_the_configured_timezone(client, make_user, s3):
    admin = await make_user(role="admin")
    agent = await make_user()
    created = await client.post(
        "/api/surveys", data=form(), files=nameplate(), headers=auth(agent)
    )
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, created.json()["id"])
        # 18:30Z on the 26th = 00:30 Dhaka on the 27th.
        row.created_at = datetime(2026, 8, 26, 18, 30, tzinfo=UTC)
        session.add(row)
        await session.commit()

    on_27th = await client.get(
        "/api/admin/surveys?date_from=2026-08-27&date_to=2026-08-27", headers=auth(admin)
    )
    assert len(on_27th.json()) == 1

    on_26th = await client.get(
        "/api/admin/surveys?date_from=2026-08-26&date_to=2026-08-26", headers=auth(admin)
    )
    assert on_26th.json() == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_admin_api.py -v`
Expected: FAIL — 404 on every admin route.

- [ ] **Step 3: Implement `app/api/admin.py`**

```python
from datetime import UTC, date, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import case, func
from sqlmodel import select

from app.api.surveys import survey_to_read
from app.core.config import get_settings
from app.core.deps import AdminUser
from app.core.timeutil import day_bounds_utc
from app.db.session import SessionDep
from app.models.survey import ChamberSurvey
from app.models.user import User
from app.schemas.survey import AdminStatsRead, AgentStat, SurveyRead

router = APIRouter(prefix="/admin", tags=["admin"])
settings = get_settings()


def _local_range_to_utc(date_from: date | None, date_to: date | None) -> tuple[datetime | None, datetime | None]:
    """Turn inclusive local dates into a half-open UTC range.

    Filters must use the same day boundary as the counts, or the two disagree
    for six hours out of every twenty-four.
    """
    tz = ZoneInfo(settings.app_timezone)
    start = (
        datetime.combine(date_from, datetime.min.time(), tzinfo=tz).astimezone(UTC)
        if date_from
        else None
    )
    end = (
        datetime.combine(date_to + timedelta(days=1), datetime.min.time(), tzinfo=tz).astimezone(
            UTC
        )
        if date_to
        else None
    )
    return start, end


@router.get("/surveys", response_model=list[SurveyRead])
async def list_all_surveys(
    session: SessionDep,
    _: AdminUser,
    user_id: UUID | None = None,
    district: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    include_deleted: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> list[SurveyRead]:
    limit = min(max(limit, 1), 200)
    query = select(ChamberSurvey, User.name).join(User, User.id == ChamberSurvey.user_id)

    if not include_deleted:
        query = query.where(ChamberSurvey.deleted_at.is_(None))
    if user_id is not None:
        query = query.where(ChamberSurvey.user_id == user_id)
    if district is not None:
        query = query.where(ChamberSurvey.district == district)

    start, end = _local_range_to_utc(date_from, date_to)
    if start is not None:
        query = query.where(ChamberSurvey.created_at >= start)
    if end is not None:
        query = query.where(ChamberSurvey.created_at < end)

    result = await session.exec(
        query.order_by(ChamberSurvey.created_at.desc()).offset(offset).limit(limit)
    )
    return [await survey_to_read(session, row, agent_name=name) for row, name in result.all()]


@router.get("/stats", response_model=AdminStatsRead)
async def overall_stats(session: SessionDep, _: AdminUser) -> AdminStatsRead:
    alive = ChamberSurvey.deleted_at.is_(None)
    start, end = day_bounds_utc(settings.app_timezone)
    today_window = (ChamberSurvey.created_at >= start) & (ChamberSurvey.created_at < end)

    total = (await session.exec(select(func.count()).select_from(ChamberSurvey).where(alive))).one()
    today = (
        await session.exec(
            select(func.count()).select_from(ChamberSurvey).where(alive, today_window)
        )
    ).one()

    rows = await session.exec(
        select(
            ChamberSurvey.user_id,
            User.name,
            func.count().label("total"),
            func.sum(case((today_window, 1), else_=0)).label("today"),
        )
        .join(User, User.id == ChamberSurvey.user_id)
        .where(alive)
        .group_by(ChamberSurvey.user_id, User.name)
        .order_by(func.count().desc())
    )
    per_agent = [
        AgentStat(user_id=uid, name=name, total=t, today=int(td or 0))
        for uid, name, t, td in rows.all()
    ]

    agents = (await session.exec(select(func.count()).select_from(User).where(User.is_active))).one()
    return AdminStatsRead(total=total, today=today, agent_count=agents, per_agent=per_agent)


@router.delete("/surveys/{survey_id}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_survey(survey_id: UUID, session: SessionDep, _: AdminUser) -> None:
    """Soft: the row and its nameplate survive.

    Field data an admin can destroy is field data nobody can audit, which is the
    same reason agents cannot delete at all.
    """
    row = await session.get(ChamberSurvey, survey_id)
    if row is None or row.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")
    row.deleted_at = datetime.now(UTC)
    row.updated_at = datetime.now(UTC)
    session.add(row)
    await session.commit()
```

`case((today_window, 1), else_=0)` is used rather than casting a boolean,
because SQLite has no boolean type and `func.cast(<comparison>, Integer)`
behaves inconsistently across the two backends. If the grouped `today` still
misbehaves, run a second grouped query filtered by `today_window` and merge the
two results by `user_id` — do not leave the number approximate.

- [ ] **Step 4: Register the router**

In `backend/app/main.py`:

```python
from app.api import admin, health, surveys, users
```

```python
app.include_router(admin.router, prefix="/api")
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_admin_api.py -v`
Expected: PASS, 9 tests

- [ ] **Step 6: Full suite, lint, commit**

```bash
cd backend && uv run pytest -v && uv run ruff check . && cd ..
git add backend/app backend/tests
git commit -m "feat(admin): all-surveys listing, overall stats, soft delete"
```

---

## Task 9: Frontend identity and routing shell

**Files:**
- Create: `frontend/src/auth.tsx`
- Modify: `frontend/src/api.ts` (rewrite), `frontend/src/App.tsx` (rewrite), `frontend/src/main.tsx`, `frontend/package.json`
- Test: `npm run build` + manual check

**Interfaces:**
- Consumes: `/api/users`, `/api/surveys*`, `/api/admin/*` from Tasks 5, 7, 8.
- Produces: `useIdentity()`, `<IdentityProvider>`, `<RequireAdmin>`, and every typed API function used by Tasks 10 and 11 — `listUsers`, `createUser`, `listMySurveys`, `createSurvey`, `myStats`, `listAllSurveys`, `adminStats`, `deleteSurvey`.

- [ ] **Step 1: Add the router**

```bash
cd frontend && npm install react-router-dom
```

- [ ] **Step 2: Rewrite `frontend/src/api.ts`**

```ts
export interface UserPublic {
  id: string;
  name: string;
  company: string;
  role: "agent" | "admin";
  is_active: boolean;
}

export interface Slot {
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface Survey {
  id: string;
  user_id: string;
  hospital_name: string;
  city: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  nameplate_key: string;
  nameplate_url: string | null;
  daily_patients: number;
  avg_duration_min: number;
  consultation_fee_bdt: number;
  ocr_status: "pending" | "done" | "failed";
  doctor_name: string | null;
  doctor_degrees: string | null;
  doctor_specializations: string | null;
  created_at: string;
  deleted_at: string | null;
  slots: Slot[];
  phones: string[];
  agent_name: string | null;
}

export interface Stats {
  total: number;
  today: number;
}

export interface AgentStat {
  user_id: string;
  name: string;
  total: number;
  today: number;
}

export interface AdminStats extends Stats {
  agent_count: number;
  per_agent: AgentStat[];
}

// Same-origin by default: Vite proxies /api in dev, Caddy proxies it in prod.
const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export const USER_ID_KEY = "doctor-form.user-id";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The single place the identity header is attached. When real login lands,
 *  this becomes an Authorization: Bearer header and nothing else changes. */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const userId = localStorage.getItem(USER_ID_KEY);
  const headers = new Headers(init.headers);
  if (userId) headers.set("X-User-Id", userId);

  const resp = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new ApiError(resp.status, `${resp.status}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const listUsers = () => request<UserPublic[]>("/api/users");

export const createUser = (body: {
  name: string;
  phone: string;
  company: string;
  role: "agent" | "admin";
}) =>
  request<UserPublic>("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const listMySurveys = () => request<Survey[]>("/api/surveys");

export const myStats = () => request<Stats>("/api/surveys/stats");

export const createSurvey = (form: FormData) =>
  request<Survey>("/api/surveys", { method: "POST", body: form });

export const listAllSurveys = (params: Record<string, string> = {}) => {
  const qs = new URLSearchParams(params).toString();
  return request<Survey[]>(`/api/admin/surveys${qs ? `?${qs}` : ""}`);
};

export const adminStats = () => request<AdminStats>("/api/admin/stats");

export const deleteSurvey = (id: string) =>
  request<void>(`/api/admin/surveys/${id}`, { method: "DELETE" });
```

- [ ] **Step 3: Create `frontend/src/auth.tsx`**

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Navigate } from "react-router-dom";

import { listUsers, USER_ID_KEY, type UserPublic } from "./api";

interface Identity {
  user: UserPublic | null;
  users: UserPublic[];
  loading: boolean;
  switchUser: (id: string) => void;
  clear: () => void;
}

const IdentityContext = createContext<Identity | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<UserPublic[]>([]);
  const [userId, setUserId] = useState<string | null>(() =>
    localStorage.getItem(USER_ID_KEY),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  const switchUser = useCallback((id: string) => {
    localStorage.setItem(USER_ID_KEY, id);
    setUserId(id);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(USER_ID_KEY);
    setUserId(null);
  }, []);

  // A stored id that no longer matches a real user (deactivated, or the
  // database was reset) must not leave the app stuck sending 401s.
  const user = useMemo(
    () => users.find((u) => u.id === userId) ?? null,
    [users, userId],
  );

  const value = useMemo(
    () => ({ user, users, loading, switchUser, clear }),
    [user, users, loading, switchUser, clear],
  );

  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): Identity {
  const ctx = useContext(IdentityContext);
  if (!ctx) throw new Error("useIdentity must be used inside IdentityProvider");
  return ctx;
}

/** UX guard only. The identity is client-chosen, so anyone can set the
 *  localStorage key — the real enforcement is the server's 403. This exists so
 *  an agent does not land on a page that would only show them errors. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useIdentity();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user || user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function IdentityPicker() {
  const { users, switchUser, loading } = useIdentity();
  if (loading) return <p className="muted">Loading…</p>;
  return (
    <main className="wrap">
      <header>
        <h1>Who are you?</h1>
        <p className="sub">
          Pick your name to continue. There is no password yet — this selects a
          role, it does not prove one.
        </p>
      </header>
      <ul className="list">
        {users.map((u) => (
          <li key={u.id} className="card">
            <button className="link" onClick={() => switchUser(u.id)}>
              <strong>{u.name}</strong> · {u.company} · {u.role}
            </button>
          </li>
        ))}
      </ul>
      {users.length === 0 && <p className="muted">No users exist yet.</p>}
    </main>
  );
}
```

- [ ] **Step 4: Rewrite `frontend/src/App.tsx` as the shell**

```tsx
import { Link, Navigate, Route, Routes } from "react-router-dom";

import { IdentityPicker, RequireAdmin, useIdentity } from "./auth";
import AdminPage from "./routes/AdminPage";
import AgentPage from "./routes/AgentPage";

function Header() {
  const { user, clear } = useIdentity();
  if (!user) return null;
  return (
    <nav className="row">
      <span className="muted">
        {user.name} · {user.role}
      </span>
      <span>
        <Link to="/">Survey</Link>
        {user.role === "admin" && <Link to="/admin">Admin</Link>}
        <button className="link" onClick={clear}>
          Switch user
        </button>
      </span>
    </nav>
  );
}

export default function App() {
  const { user, loading } = useIdentity();

  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <IdentityPicker />;

  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<AgentPage />} />
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
```

- [ ] **Step 5: Wrap the app in `frontend/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { IdentityProvider } from "./auth";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <IdentityProvider>
        <App />
      </IdentityProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 6: Verify**

`AgentPage` and `AdminPage` do not exist yet, so create placeholder files so the
build can run:

```bash
mkdir -p frontend/src/routes
printf 'export default function AgentPage() {\n  return <p>Agent</p>;\n}\n' > frontend/src/routes/AgentPage.tsx
printf 'export default function AdminPage() {\n  return <p>Admin</p>;\n}\n' > frontend/src/routes/AdminPage.tsx
cd frontend && npm run build
```

Expected: build succeeds with no TypeScript errors.

Manual check: `docker compose up -d`, open `http://localhost:5173`. Expected:
the identity picker lists the seeded admin. Pick it; the header shows
`Admin · admin` and an Admin link.

- [ ] **Step 7: Commit**

```bash
git add frontend/src frontend/package.json frontend/package-lock.json
git commit -m "feat(frontend): identity provider, typed API client, route shell"
```

---

## Task 10: The agent page

**Files:**
- Create: `frontend/src/components/SlotEditor.tsx`, `frontend/src/components/PhoneEditor.tsx`, `frontend/src/components/LocationInput.tsx`, `frontend/src/components/NameplateInput.tsx`
- Modify: `frontend/src/routes/AgentPage.tsx` (replace the placeholder)
- Test: `npm run build` + manual check

**Interfaces:**
- Consumes: `createSurvey`, `listMySurveys`, `myStats` (Task 9).
- Produces: nothing later tasks import.

- [ ] **Step 1: Create `SlotEditor.tsx`**

```tsx
import type { Slot } from "../api";

// Displayed Saturday-first for Bangladesh; the values stay 0=Monday so the
// database never learns about display order.
const DAYS = [
  { value: 5, label: "Sat" },
  { value: 6, label: "Sun" },
  { value: 0, label: "Mon" },
  { value: 1, label: "Tue" },
  { value: 2, label: "Wed" },
  { value: 3, label: "Thu" },
  { value: 4, label: "Fri" },
];

export const emptySlot = (): Slot => ({
  day_of_week: 5,
  start_time: "17:00",
  end_time: "20:00",
});

export default function SlotEditor({
  slots,
  onChange,
}: {
  slots: Slot[];
  onChange: (slots: Slot[]) => void;
}) {
  const update = (i: number, patch: Partial<Slot>) =>
    onChange(slots.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  return (
    <fieldset>
      <legend>Availability</legend>
      {slots.map((slot, i) => (
        <div className="row" key={i}>
          <select
            value={slot.day_of_week}
            onChange={(e) => update(i, { day_of_week: Number(e.target.value) })}
          >
            {DAYS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <input
            type="time"
            required
            value={slot.start_time}
            onChange={(e) => update(i, { start_time: e.target.value })}
          />
          <input
            type="time"
            required
            value={slot.end_time}
            onChange={(e) => update(i, { end_time: e.target.value })}
          />
          {slot.end_time <= slot.start_time && (
            <span className="error">End must be after start</span>
          )}
          {slots.length > 1 && (
            <button
              type="button"
              className="link"
              onClick={() => onChange(slots.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...slots, emptySlot()])}>
        Add slot
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 2: Create `PhoneEditor.tsx`**

```tsx
export default function PhoneEditor({
  phones,
  onChange,
}: {
  phones: string[];
  onChange: (phones: string[]) => void;
}) {
  return (
    <fieldset>
      <legend>Chamber phone numbers</legend>
      {phones.map((phone, i) => (
        <div className="row" key={i}>
          <input
            required
            inputMode="tel"
            placeholder="01712345678"
            value={phone}
            onChange={(e) =>
              onChange(phones.map((p, idx) => (idx === i ? e.target.value : p)))
            }
          />
          {phones.length > 1 && (
            <button
              type="button"
              className="link"
              onClick={() => onChange(phones.filter((_, idx) => idx !== i))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button type="button" className="link" onClick={() => onChange([...phones, ""])}>
        Add number
      </button>
    </fieldset>
  );
}
```

- [ ] **Step 3: Create `LocationInput.tsx`**

```tsx
import { useEffect, useState } from "react";

export interface LocationValue {
  latitude: string;
  longitude: string;
  city: string;
  district: string;
}

export const emptyLocation = (): LocationValue => ({
  latitude: "",
  longitude: "",
  city: "",
  district: "",
});

/** Either coordinates or city+district; each pair is all-or-nothing. Mirrors
 *  the server's rule so the agent finds out before they submit. */
export function locationError(v: LocationValue): string | null {
  const hasLat = v.latitude.trim() !== "";
  const hasLng = v.longitude.trim() !== "";
  const hasCity = v.city.trim() !== "";
  const hasDistrict = v.district.trim() !== "";

  if (hasLat !== hasLng) return "Give both latitude and longitude, or neither.";
  if (hasCity !== hasDistrict) return "Give both city and district, or neither.";
  if (!hasLat && !hasCity) return "Provide coordinates or city and district.";
  return null;
}

export default function LocationInput({
  value,
  onChange,
}: {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
}) {
  const [geoState, setGeoState] = useState<"idle" | "asking" | "ok" | "denied">("idle");

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState("ok");
        onChange({
          ...value,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        });
      },
      // Denial is expected and must not block the form — city and district
      // satisfy the requirement on their own.
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
    // Runs once on mount; re-running would fight the agent's manual edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const error = locationError(value);

  return (
    <fieldset>
      <legend>Location</legend>
      {geoState === "asking" && <p className="muted">Finding your position…</p>}
      {geoState === "denied" && (
        <p className="muted">
          No GPS fix. Type coordinates by hand, or just fill in city and district.
        </p>
      )}
      <div className="row">
        <input
          placeholder="Latitude"
          inputMode="decimal"
          value={value.latitude}
          onChange={(e) => onChange({ ...value, latitude: e.target.value })}
        />
        <input
          placeholder="Longitude"
          inputMode="decimal"
          value={value.longitude}
          onChange={(e) => onChange({ ...value, longitude: e.target.value })}
        />
      </div>
      <div className="row">
        <input
          placeholder="City"
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value })}
        />
        <input
          placeholder="District"
          value={value.district}
          onChange={(e) => onChange({ ...value, district: e.target.value })}
        />
      </div>
      {error && <p className="error">{error}</p>}
    </fieldset>
  );
}
```

- [ ] **Step 4: Create `NameplateInput.tsx`**

```tsx
import { useState } from "react";

const MAX_BYTES = 10 * 1024 * 1024;

export default function NameplateInput({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <fieldset>
      <legend>Doctor nameplate photo</legend>
      <p className="muted">
        Required. The doctor's name, degrees and specializations are read from
        this image later.
      </p>
      <input
        type="file"
        accept="image/*"
        required
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          // Checked here so a 10MB upload does not travel before being refused.
          if (picked && picked.size > MAX_BYTES) {
            setError("Image is larger than 10MB.");
            setPreview(null);
            onChange(null);
            return;
          }
          setError(null);
          setPreview(picked ? URL.createObjectURL(picked) : null);
          onChange(picked);
        }}
      />
      {error && <p className="error">{error}</p>}
      {preview && <img src={preview} alt="Nameplate preview" style={{ maxWidth: "100%" }} />}
      {file && !error && <p className="muted">{file.name}</p>}
    </fieldset>
  );
}
```

- [ ] **Step 5: Replace `frontend/src/routes/AgentPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";

import { createSurvey, listMySurveys, myStats, type Slot, type Stats, type Survey } from "../api";
import LocationInput, {
  emptyLocation,
  locationError,
  type LocationValue,
} from "../components/LocationInput";
import NameplateInput from "../components/NameplateInput";
import PhoneEditor from "../components/PhoneEditor";
import SlotEditor, { emptySlot } from "../components/SlotEditor";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function AgentPage() {
  const [stats, setStats] = useState<Stats>({ total: 0, today: 0 });
  const [mine, setMine] = useState<Survey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [hospital, setHospital] = useState("");
  const [location, setLocation] = useState<LocationValue>(emptyLocation());
  const [slots, setSlots] = useState<Slot[]>([emptySlot()]);
  const [phones, setPhones] = useState<string[]>([""]);
  const [nameplate, setNameplate] = useState<File | null>(null);
  const [dailyPatients, setDailyPatients] = useState("");
  const [avgDuration, setAvgDuration] = useState("");
  const [fee, setFee] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([myStats(), listMySurveys()]);
      setStats(s);
      setMine(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function reset() {
    setHospital("");
    setLocation(emptyLocation());
    setSlots([emptySlot()]);
    setPhones([""]);
    setNameplate(null);
    setDailyPatients("");
    setAvgDuration("");
    setFee("");
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const locError = locationError(location);
    if (locError) return setError(locError);
    if (!nameplate) return setError("A nameplate photo is required.");

    const form = new FormData();
    form.set("hospital_name", hospital);
    form.set("daily_patients", dailyPatients);
    form.set("avg_duration_min", avgDuration);
    form.set("consultation_fee_bdt", fee);
    // Multipart cannot nest, so these travel as JSON strings.
    form.set("slots", JSON.stringify(slots));
    form.set("phones", JSON.stringify(phones.filter((p) => p.trim() !== "")));
    form.set("nameplate", nameplate);
    if (location.city.trim()) form.set("city", location.city.trim());
    if (location.district.trim()) form.set("district", location.district.trim());
    if (location.latitude.trim()) form.set("latitude", location.latitude.trim());
    if (location.longitude.trim()) form.set("longitude", location.longitude.trim());

    setSaving(true);
    try {
      await createSurvey(form);
      reset();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>New chamber survey</h1>
        <p className="sub">
          <strong>{stats.today}</strong> filed today · <strong>{stats.total}</strong> in total
        </p>
      </header>

      {error && <div className="error">{error}</div>}

      <form onSubmit={onSubmit} className="card">
        <label>
          Hospital name
          <input required maxLength={200} value={hospital} onChange={(e) => setHospital(e.target.value)} />
        </label>

        <LocationInput value={location} onChange={setLocation} />
        <NameplateInput file={nameplate} onChange={setNameplate} />
        <SlotEditor slots={slots} onChange={setSlots} />
        <PhoneEditor phones={phones} onChange={setPhones} />

        <label>
          Patients per day
          <input required type="number" min={1} value={dailyPatients} onChange={(e) => setDailyPatients(e.target.value)} />
        </label>
        <label>
          Average minutes per patient
          <input required type="number" min={1} value={avgDuration} onChange={(e) => setAvgDuration(e.target.value)} />
        </label>
        <label>
          Consultation fee (BDT)
          <input required type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} />
        </label>

        <button type="submit" disabled={saving}>
          {saving ? "Submitting…" : "Submit survey"}
        </button>
      </form>

      <section>
        <h2>My surveys</h2>
        {mine.length === 0 ? (
          <p className="muted">Nothing filed yet.</p>
        ) : (
          <ul className="list">
            {mine.map((s) => (
              <li key={s.id} className="card">
                <div className="row">
                  <strong>{s.hospital_name}</strong>
                  <time className="muted">{new Date(s.created_at).toLocaleString()}</time>
                </div>
                <div className="muted">
                  {s.city && s.district ? `${s.city}, ${s.district}` : null}
                  {s.latitude !== null && s.longitude !== null
                    ? ` (${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`
                    : null}
                </div>
                <div className="muted">
                  {s.slots
                    .map((sl) => `${DAY_LABELS[sl.day_of_week]} ${sl.start_time.slice(0, 5)}–${sl.end_time.slice(0, 5)}`)
                    .join(" · ")}
                </div>
                <div className="muted">{s.phones.join(" · ")}</div>
                <div className="muted">
                  {s.daily_patients}/day · {s.avg_duration_min} min · ৳{s.consultation_fee_bdt}
                </div>
                {s.nameplate_url && (
                  <a href={s.nameplate_url} target="_blank" rel="noreferrer">
                    View nameplate
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Verify**

```bash
cd frontend && npm run build
```

Expected: build succeeds.

Manual check with `docker compose up -d`, at `http://localhost:5173`:
1. Pick the seeded admin. Fill the form using **city and district only**, leaving coordinates blank. It submits — this proves coordinates really are optional.
2. Submit again with a slot whose end time precedes its start. The inline error appears.
3. Confirm the counter above the form increments after each successful submit.
4. Confirm "View nameplate" opens the uploaded image from RustFS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): agent survey form with slots, phones, location and nameplate"
```

---

## Task 11: The admin page

**Files:**
- Modify: `frontend/src/routes/AdminPage.tsx` (replace the placeholder)
- Test: `npm run build` + manual check

**Interfaces:**
- Consumes: `adminStats`, `listAllSurveys`, `deleteSurvey`, `createUser` (Task 9).
- Produces: nothing.

- [ ] **Step 1: Replace `frontend/src/routes/AdminPage.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";

import {
  adminStats,
  createUser,
  deleteSurvey,
  listAllSurveys,
  type AdminStats,
  type Survey,
} from "../api";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [district, setDistrict] = useState("");
  const [agentId, setAgentId] = useState("");

  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCompany, setNewCompany] = useState("");

  const refresh = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (district.trim()) params.district = district.trim();
      if (agentId) params.user_id = agentId;
      const [s, list] = await Promise.all([adminStats(), listAllSurveys(params)]);
      setStats(s);
      setSurveys(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [district, agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAddAgent(event: React.FormEvent) {
    event.preventDefault();
    try {
      await createUser({
        name: newName,
        phone: newPhone,
        company: newCompany,
        role: "agent",
      });
      setNewName("");
      setNewPhone("");
      setNewCompany("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onDelete(id: string) {
    // Soft on the server: the row and its nameplate survive for audit.
    if (!confirm("Remove this survey from the active list?")) return;
    try {
      await deleteSurvey(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>All surveys</h1>
      </header>

      {error && <div className="error">{error}</div>}

      {stats && (
        <section className="row">
          <div className="card">
            <strong>{stats.total}</strong>
            <div className="muted">total surveys</div>
          </div>
          <div className="card">
            <strong>{stats.today}</strong>
            <div className="muted">today</div>
          </div>
          <div className="card">
            <strong>{stats.agent_count}</strong>
            <div className="muted">active users</div>
          </div>
        </section>
      )}

      {stats && stats.per_agent.length > 0 && (
        <section>
          <h2>By agent</h2>
          <ul className="list">
            {stats.per_agent.map((a) => (
              <li key={a.user_id} className="card row">
                <button className="link" onClick={() => setAgentId(a.user_id)}>
                  {a.name}
                </button>
                <span className="muted">
                  {a.today} today · {a.total} total
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Filters</h2>
        <div className="row">
          <input
            placeholder="District"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
          />
          <button type="button" className="link" onClick={() => { setAgentId(""); setDistrict(""); }}>
            Clear
          </button>
        </div>
      </section>

      <form className="card" onSubmit={onAddAgent}>
        <h2>Add an agent</h2>
        <label>
          Name
          <input required value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <label>
          Phone
          <input
            required
            placeholder="01712345678"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
          />
        </label>
        <label>
          Company
          <input required value={newCompany} onChange={(e) => setNewCompany(e.target.value)} />
        </label>
        <button type="submit">Create agent</button>
      </form>

      <section>
        <h2>Surveys</h2>
        {surveys.length === 0 ? (
          <p className="muted">Nothing matches.</p>
        ) : (
          <ul className="list">
            {surveys.map((s) => (
              <li key={s.id} className="card">
                <div className="row">
                  <strong>
                    {/* OCR has not run yet for anything filed by this system. */}
                    {s.doctor_name ?? "Dr. — (nameplate pending)"}
                  </strong>
                  <button className="link" onClick={() => void onDelete(s.id)}>
                    Delete
                  </button>
                </div>
                <div>{s.hospital_name}</div>
                <div className="muted">
                  filed by {s.agent_name ?? "unknown"} ·{" "}
                  {new Date(s.created_at).toLocaleString()}
                </div>
                <div className="muted">
                  {s.city && s.district ? `${s.city}, ${s.district}` : null}
                  {s.latitude !== null && s.longitude !== null
                    ? ` (${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`
                    : null}
                </div>
                <div className="muted">
                  {s.slots
                    .map((sl) => `${DAY_LABELS[sl.day_of_week]} ${sl.start_time.slice(0, 5)}–${sl.end_time.slice(0, 5)}`)
                    .join(" · ")}
                </div>
                <div className="muted">{s.phones.join(" · ")}</div>
                <div className="muted">
                  {s.daily_patients}/day · {s.avg_duration_min} min · ৳{s.consultation_fee_bdt}
                </div>
                {s.nameplate_url && (
                  <a href={s.nameplate_url} target="_blank" rel="noreferrer">
                    View nameplate
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm run build
```

Manual check:
1. As the seeded admin, create an agent with phone `01712345678`.
2. Switch to that agent (header → Switch user) and file a survey.
3. Switch back to the admin. The survey appears with `filed by <agent>` and
   `Dr. — (nameplate pending)`.
4. Click an agent in the "By agent" list — the survey list filters to them.
5. Delete the survey. It disappears from the list and the totals drop.
6. As the **agent**, navigate to `/admin` directly. Expected: redirected to `/`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): admin dashboard with stats, filters and soft delete"
```

---

## Task 12: Documentation and environment

**Files:**
- Modify: `README.md`, `.env.example`, `docker-compose.prod.yml`
- Test: manual read-through

- [ ] **Step 1: Add the new settings to `.env.example`**

After the `S3_BUCKET=uploads` line:

```bash
# ---- Application ----
# Daily counts are reported per local day, not per UTC day.
APP_TIMEZONE=Asia/Dhaka

# Seeds the first admin on boot when the users table is empty. Identity is
# picked from the users list, so an empty list is an unusable system.
ADMIN_NAME=Admin
ADMIN_PHONE=+8801700000000
```

- [ ] **Step 2: Pass them through in `docker-compose.prod.yml`**

In the backend service's `environment:` block:

```yaml
      APP_TIMEZONE: ${APP_TIMEZONE:-Asia/Dhaka}
      ADMIN_NAME: ${ADMIN_NAME:-Admin}
      ADMIN_PHONE: ${ADMIN_PHONE:-+8801700000000}
```

- [ ] **Step 3: Rewrite the README's Layout and add a Roles section**

Replace the `backend/` block under "## Layout":

```
backend/          FastAPI app (SQLModel + asyncpg + boto3)
  app/core/       settings, deps (auth seam), phone + timezone helpers
  app/db/         async engine, session dependency, Alembic runner, admin seed
  app/models/     SQLModel tables: users, chamber_surveys, availability_slots,
                  survey_phones
  app/schemas/    request/response models
  app/services/   S3/RustFS storage helpers
  app/api/        routers: health, users, surveys, admin
  alembic/        migrations (Postgres only; tests use create_all on SQLite)
```

Add a new section after "## Architecture":

```markdown
## Roles

Two roles, and **no authentication yet**. A user picks who they are from
`GET /api/users`; the choice is kept in `localStorage` and sent as `X-User-Id`.
Anyone can send any id — this is a role structure, not a security boundary.

| Role | Sees |
| --- | --- |
| agent | `/` — files surveys, sees only their own and their own counts |
| admin | `/admin` — every survey, overall and per-agent counts, soft delete |

The first admin is seeded on boot from `ADMIN_NAME` / `ADMIN_PHONE` when the
users table is empty, because identity is picked from a list that cannot start
empty.

**Migrating to real login** touches three places: `get_current_user` in
`app/core/deps.py` (read a verified token instead of the header), the `request()`
wrapper in `frontend/src/api.ts` (send `Authorization` instead of `X-User-Id`),
and `IdentityProvider` in `frontend/src/auth.tsx` (a login form instead of a
picker). No route, model, or page changes.

Deletion is soft: `deleted_at` is set and the nameplate stays in storage, so
field data remains auditable.
```

- [ ] **Step 4: Note the known gaps**

Add at the end of the README:

```markdown
## Known gaps

- **No authentication.** See Roles above. `<RequireAdmin>` is a UX guard; the
  only enforcement is the server's 403.
- **No frontend test runner.** The frontend's gate is `npm run build`
  (`tsc --noEmit` + Vite). Adding vitest would be a worthwhile next step.
- **No CI.** The backend suite is deliberately infrastructure-free — SQLite plus
  `moto` — so a CI job would be `pytest` with no services block.
- **OCR is not implemented.** `ocr_status` is `pending` on every row, and
  `doctor_name` / `doctor_degrees` / `doctor_specializations` are always NULL.
- **`storage.delete_object` is unused** now that deletion is soft. Kept for a
  future retention or purge job.
```

- [ ] **Step 5: Verify the whole system end to end**

```bash
cd backend && uv run pytest -v && uv run ruff check . && cd ..
cd frontend && npm run build && cd ..
docker compose down -v && docker compose up --build -d
sleep 15
curl -fsS http://localhost:8000/api/readyz
curl -fsS http://localhost:8000/api/users
```

Expected: all tests pass; `readyz` reports `database: ok` and `storage: ok`;
`/api/users` returns exactly one admin on a freshly wiped volume.

- [ ] **Step 6: Commit**

```bash
git add README.md .env.example docker-compose.prod.yml
git commit -m "docs: roles, migration path to real login, and known gaps"
```

---

## Self-Review Notes

Checked against the spec:

- Every spec section maps to a task: identity → 4, users/seed → 5, models and
  constraints → 2, Alembic → 3, validation → 6, agent routes → 7, admin routes
  and soft delete → 8, frontend → 9–11, docs/env → 12.
- The spec's "Testing" bullets each appear as a named test: identity,
  deactivation, role gate, scoping, ownership, location, slots, phones,
  nameplate, soft delete, stats timezone, admin stats.
- Names are consistent across tasks: `survey_to_read` (defined Task 7, imported
  Task 8), `CurrentUser`/`AdminUser` (Task 4, used 5/7/8), `auth()` helper
  (Task 4 conftest, used 5/7/8), `emptySlot`/`emptyLocation`/`locationError`
  (Task 10 components, used by `AgentPage`).
- Deviation worth flagging to the reviewer: the spec listed
  `app/models/{user,survey,slot,phone}.py`; this plan uses
  `availability.py` and `survey_phone.py` instead, because `app/models/phone.py`
  next to `app/core/phone.py` would be a genuine confusion.
