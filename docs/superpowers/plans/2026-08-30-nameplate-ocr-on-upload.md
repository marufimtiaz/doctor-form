# Nameplate OCR on Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the nameplate when the agent picks the photo, show the doctor's name, degrees and specialisations as editable fields, and store what the agent approved — with the existing background worker as the fallback whenever that does not happen.

**Architecture:** A new preview endpoint reuses `extract_doctor_fields` without touching the database or S3. `SurveyCreate` accepts the approved fields and files the row `done`/`upload`; otherwise the row files `pending` and the worker reads it. A new `ocr_source` column records which path filled each row. `OCR_MODE=inline` is deleted.

**Tech Stack:** FastAPI, SQLModel, Alembic, pytest + pytest-asyncio, moto S3; React 19, react-hook-form 7.86, zod 3.25, vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-30-nameplate-ocr-on-upload-design.md`

## Global Constraints

- Backend gate: `cd backend && uv run pytest && uv run ruff check .` — no services needed (SQLite + local moto S3).
- Frontend gate: `cd frontend && npx tsc --noEmit && npx vitest run && npm run lint && npx vite build`.
- **No test may call OpenRouter.** `extract_doctor_fields` is monkeypatched everywhere, as `tests/test_ocr_modes.py` already does.
- `OCR_MODE` after this work is `worker | off`. `inline` must be rejected.
- Migrations are Postgres-targeted but must run on SQLite — use `op.batch_alter_table`, as `0004` does.
- `tests/test_migrations.py::test_migrated_schema_matches_the_models` compares models to migrations automatically; a mismatch fails there, so no bespoke schema test is needed.
- Frontend: no DOM tests. `vitest.config.ts` is `environment: "node"`, `include: ["src/**/*.test.ts"]`.
- Import order: external packages, blank line, then `@/` imports.
- Commit messages: conventional commits, ending with the two trailer lines used in this repo's history.

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/models/survey.py` | `ocr_source` column + CHECK constraint |
| `backend/alembic/versions/0005_ocr_source.py` (new) | The migration |
| `backend/app/schemas/survey.py` | Doctor fields on `SurveyCreate`; `ocr_source` on `SurveyRead` |
| `backend/app/api/surveys.py` | Preview endpoint; accept doctor fields; drop inline |
| `backend/app/api/admin.py` | Set `ocr_source` on correct; clear on reread; drop inline |
| `backend/app/workers/ocr.py` | Set `ocr_source="worker"` on success |
| `backend/app/core/config.py` | `OCR_MODE` validator drops `inline` |
| `frontend/src/api.ts` | `previewNameplate`; `ocr_source` on `Survey` |
| `frontend/src/schemas/survey.ts` | Three optional doctor fields on `doctorSchema` |
| `frontend/src/components/NameplateInput.tsx` | Upload / camera buttons |
| `frontend/src/routes/DoctorPage.tsx` | Preview trigger, race guard, doctor fields block |

---

### Task 1: `ocr_source` column

**Files:**
- Modify: `backend/app/models/survey.py`
- Create: `backend/alembic/versions/0005_ocr_source.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ChamberSurvey.ocr_source: str | None` accepting `"upload" | "worker" | "admin"` or `NULL`.

- [ ] **Step 1: Add the column to the model**

In `backend/app/models/survey.py`, add to `__table_args__` beside `ck_surveys_ocr_status`:

```python
        CheckConstraint(
            "ocr_source IS NULL OR ocr_source IN ('upload', 'worker', 'admin')",
            name="ck_surveys_ocr_source",
        ),
```

and add the field directly after `ocr_error`:

```python
    # Which path produced the doctor fields: read on upload and approved by the
    # agent, filled silently by the worker, or corrected by an admin. NULL means
    # the row predates this column or has not been read yet.
    ocr_source: str | None = Field(default=None, max_length=16)
```

- [ ] **Step 2: Watch the drift test fail**

Run: `cd backend && uv run pytest tests/test_migrations.py -v`
Expected: `test_migrated_schema_matches_the_models` FAILS — the models now have a column the migrations do not.

- [ ] **Step 3: Write the migration**

Create `backend/alembic/versions/0005_ocr_source.py`:

```python
"""Add ocr_source column to chamber_surveys table.

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-30

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Nullable with no backfill: NULL correctly means "filed before this
    # column existed, or not read yet".
    with op.batch_alter_table("chamber_surveys", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ocr_source", sa.String(length=16), nullable=True))
        batch_op.create_check_constraint(
            "ck_surveys_ocr_source",
            "ocr_source IS NULL OR ocr_source IN ('upload', 'worker', 'admin')",
        )


def downgrade() -> None:
    with op.batch_alter_table("chamber_surveys", schema=None) as batch_op:
        batch_op.drop_constraint("ck_surveys_ocr_source", type_="check")
        batch_op.drop_column("ocr_source")
```

- [ ] **Step 4: Watch it pass**

Run: `cd backend && uv run pytest tests/test_migrations.py -v`
Expected: both tests PASS.

- [ ] **Step 5: Full backend gate**

Run: `cd backend && uv run pytest && uv run ruff check .`
Expected: all pass, ruff clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/models/survey.py backend/alembic/versions/0005_ocr_source.py
git commit -m "feat(ocr): record which path filled a row's doctor fields

Nullable ocr_source taking upload, worker or admin. Without it there is no way
to tell a value a human approved from one a model guessed, which starts
mattering as soon as agents can edit them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 2: Remove `OCR_MODE=inline`

**Files:**
- Modify: `backend/app/core/config.py:126`
- Modify: `backend/app/api/surveys.py` (the inline block at the end of `create_survey`)
- Modify: `backend/app/api/admin.py` (the inline block at the end of `reread_nameplate`)
- Modify: `backend/tests/test_ocr_modes.py`
- Modify: `README.md`, `.env.example`

**Interfaces:**
- Consumes: nothing.
- Produces: `OCR_MODE` accepting only `worker` and `off`.

`inline` blocks the submit for up to 60s and the agent still never sees the result, so it is strictly worse than `worker`. Nothing in the repo sets it.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/test_ocr_modes.py`, delete the `inline_mode` fixture, `test_inline_mode_fills_the_fields_before_returning`, and `test_inline_failure_never_loses_the_survey`. Add in their place:

```python
def test_inline_is_no_longer_a_valid_mode():
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(ocr_mode="inline")


async def test_a_failing_read_never_loses_the_survey(client, make_user, s3, monkeypatch):
    """Rescued from the deleted inline tests: the property still matters.

    A survey is filed before any model call happens, so an OCR failure must
    leave a filed survey behind, not swallow it.
    """
    from app.services import ocr as ocr_service
    from app.workers import ocr as ocr_worker

    async def boom(*args, **kwargs):
        raise ocr_service.OcrError("model exploded")

    monkeypatch.setattr(ocr_worker, "extract_doctor_fields", boom)

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201
    survey_id = resp.json()["id"]

    await ocr_worker.process_survey(UUID(survey_id))

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(survey_id))
        assert row is not None
        assert row.ocr_status == "pending"
        assert row.ocr_attempts == 1
        assert "model exploded" in (row.ocr_error or "")
```

Add `from uuid import UUID` to the imports at the top of the file.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_ocr_modes.py -v`
Expected: `test_inline_is_no_longer_a_valid_mode` FAILS — `Settings(ocr_mode="inline")` is currently accepted.

- [ ] **Step 3: Remove the mode**

In `backend/app/core/config.py`, change the validator body so only two modes are accepted:

```python
    @field_validator("ocr_mode")
    @classmethod
    def _known_ocr_mode(cls, value: str) -> str:
        if value not in ("worker", "off"):
            raise ValueError("ocr_mode must be 'worker' or 'off'")
        return value
```

In `backend/app/api/surveys.py`, delete the whole trailing block:

```python
    if settings.ocr_mode == "inline":
        from app.workers.ocr import process_survey

        await process_survey(row.id)
        await session.refresh(row)
```

so `create_survey` ends at `return await survey_to_read(session, row)`.

In `backend/app/api/admin.py`, delete the equivalent trailing block in `reread_nameplate`:

```python
    if settings.ocr_mode == "inline":
        from app.workers.ocr import process_survey

        await process_survey(row.id)
```

Re-queueing alone is enough; the worker polls every `ocr_poll_seconds` (10s).

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest && uv run ruff check .`
Expected: all pass. If ruff reports `settings` as unused in `admin.py`, remove the import it flags — do not leave it.

- [ ] **Step 5: Update the docs**

In `README.md`, delete the `inline` bullet at line 209 and change the `OCR_MODE` row of the settings table (line 275) to read `worker`, `off`.

In `.env.example`, change the comment at line 51 to:

```
# Where extraction runs: worker (background poll), off (disabled entirely).
```

- [ ] **Step 6: Commit**

```bash
git add backend/app/core/config.py backend/app/api/surveys.py backend/app/api/admin.py \
        backend/tests/test_ocr_modes.py README.md .env.example
git commit -m "refactor(ocr): remove the inline mode

It ran the extraction inside POST /api/surveys, blocking the agent's submit for
up to 60 seconds while still never showing them the result - the same outcome as
worker mode at the cost of a stalled form. Reading the nameplate on upload is
what it was reaching for, and that arrives as its own endpoint.

Nothing set it: .env.example and both compose files default to worker, so no
deployment changes. The guarantee its failure test covered - a failing read
never loses a filed survey - is kept, rewritten against the worker path.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 3: Preview endpoint

**Files:**
- Modify: `backend/app/api/surveys.py`
- Create: `backend/tests/test_nameplate_preview.py`

**Interfaces:**
- Consumes: `extract_doctor_fields`, `OcrError`, `storage.sniff_image_type`, `MAX_UPLOAD_BYTES`.
- Produces: `POST /api/surveys/nameplate/preview` returning `DoctorFields` JSON (200), empty (204 when `OCR_MODE=off`), 413, or 502.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_nameplate_preview.py`:

```python
import io

import pytest
from sqlmodel import select

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from app.services import ocr as ocr_service
from app.services.ocr import DoctorFields
from tests.conftest import auth

URL = "/api/surveys/nameplate/preview"


def nameplate(size: int = 32) -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff" + b"x" * size), "image/jpeg")}


@pytest.fixture
def worker_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "worker")


@pytest.fixture
def off_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "off")


async def test_returns_the_fields_it_read(client, make_user, worker_mode, monkeypatch):
    async def fake(image, content_type, *, client=None):
        assert content_type == "image/jpeg"
        return DoctorFields(
            doctor_name="Rahman",
            doctor_degrees="MBBS, FCPS (Medicine)",
            doctor_specializations="Cardiology",
        )

    monkeypatch.setattr("app.api.surveys.extract_doctor_fields", fake)

    agent = await make_user()
    resp = await client.post(URL, files=nameplate(), headers=auth(agent))

    assert resp.status_code == 200
    assert resp.json() == {
        "doctor_name": "Rahman",
        "doctor_degrees": "MBBS, FCPS (Medicine)",
        "doctor_specializations": "Cardiology",
    }


async def test_creates_no_survey(client, make_user, worker_mode, monkeypatch):
    monkeypatch.setattr(
        "app.api.surveys.extract_doctor_fields",
        lambda *a, **k: DoctorFields(doctor_name="Rahman"),
    )
    agent = await make_user()
    await client.post(URL, files=nameplate(), headers=auth(agent))

    async with SessionLocal() as session:
        rows = (await session.exec(select(ChamberSurvey))).all()
    assert rows == []


async def test_off_mode_returns_no_content(client, make_user, off_mode):
    agent = await make_user()
    resp = await client.post(URL, files=nameplate(), headers=auth(agent))
    assert resp.status_code == 204


async def test_an_ocr_failure_is_a_502(client, make_user, worker_mode, monkeypatch):
    async def boom(*args, **kwargs):
        raise ocr_service.OcrError("model exploded")

    monkeypatch.setattr("app.api.surveys.extract_doctor_fields", boom)

    agent = await make_user()
    resp = await client.post(URL, files=nameplate(), headers=auth(agent))
    assert resp.status_code == 502


async def test_an_oversized_image_is_refused(client, make_user, worker_mode):
    agent = await make_user()
    resp = await client.post(URL, files=nameplate(size=11 * 1024 * 1024), headers=auth(agent))
    assert resp.status_code == 413


async def test_it_requires_authentication(client, worker_mode):
    resp = await client.post(URL, files=nameplate())
    assert resp.status_code == 401
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_nameplate_preview.py -v`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Add the endpoint**

In `backend/app/api/surveys.py`, add to the imports:

```python
from app.services.ocr import DoctorFields, OcrError, extract_doctor_fields
```

Add the route **above** `@router.get("/{survey_id}")`, next to `/stats` — the comment there explains why literal paths are grouped:

```python
# Declared with the other literal paths, above /{survey_id}.
@router.post("/nameplate/preview", response_model=DoctorFields | None)
async def preview_nameplate(
    user: CurrentUser,
    nameplate: Annotated[UploadFile, File()],
) -> Response | DoctorFields:
    """Read a nameplate without filing anything.

    Creates no row and writes nothing to storage: the image is uploaded once,
    at submit. A failure here is not the agent's problem - the form files the
    survey `pending` and the worker reads it later.
    """
    if settings.ocr_mode == "off":
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    blob = await nameplate.read()
    if len(blob) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"nameplate exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)}MB",
        )

    content_type = storage.sniff_image_type(blob, nameplate.content_type)
    try:
        return await extract_doctor_fields(blob, content_type)
    except OcrError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)[:200]) from exc
```

Add `Response` to the `fastapi` import line.

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && uv run pytest tests/test_nameplate_preview.py -v`
Expected: all six PASS.

- [ ] **Step 5: Full backend gate**

Run: `cd backend && uv run pytest && uv run ruff check .`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/surveys.py backend/tests/test_nameplate_preview.py
git commit -m "feat(ocr): add a nameplate preview endpoint

Reads an image and returns the doctor fields without creating a row or writing
to storage, so the form can show them while the agent is still in front of the
nameplate. extract_doctor_fields needed no change - it already knows nothing
about surveys or the database.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 4: Accept approved fields at submit

**Files:**
- Modify: `backend/app/schemas/survey.py`
- Modify: `backend/app/api/surveys.py`
- Modify: `backend/app/api/admin.py`
- Modify: `backend/app/workers/ocr.py`
- Create: `backend/tests/test_ocr_source.py`

**Interfaces:**
- Consumes: `ChamberSurvey.ocr_source` from Task 1.
- Produces: `SurveyCreate.doctor_name/doctor_degrees/doctor_specializations`; `SurveyRead.ocr_source`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ocr_source.py`:

```python
import io
import json
from uuid import UUID

import pytest

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from app.services.ocr import DoctorFields
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form(**extra) -> dict:
    base = {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }
    base.update(extra)
    return base


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake"), "image/jpeg")}


async def row_for(survey_id: str) -> ChamberSurvey:
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(survey_id))
    assert row is not None
    return row


async def test_approved_fields_are_stored_done_and_sourced_upload(client, make_user, s3):
    agent = await make_user()
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="Rahman", doctor_degrees="MBBS"),
        files=nameplate(),
        headers=auth(agent),
    )
    assert resp.status_code == 201

    row = await row_for(resp.json()["id"])
    assert row.doctor_name == "Rahman"
    assert row.doctor_degrees == "MBBS"
    assert row.ocr_status == "done"
    assert row.ocr_source == "upload"
    assert row.ocr_completed_at is not None


async def test_no_fields_leaves_the_row_for_the_worker(client, make_user, s3):
    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))

    row = await row_for(resp.json()["id"])
    assert row.ocr_status == "pending"
    assert row.ocr_source is None


async def test_all_blank_fields_count_as_no_preview(client, make_user, s3):
    """A nameplate the model could not read must be retried, not recorded as a
    finished empty read."""
    agent = await make_user()
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="  ", doctor_degrees="", doctor_specializations=""),
        files=nameplate(),
        headers=auth(agent),
    )

    row = await row_for(resp.json()["id"])
    assert row.ocr_status == "pending"
    assert row.ocr_source is None


async def test_an_overlong_doctor_name_is_refused(client, make_user, s3):
    agent = await make_user()
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="x" * 201),
        files=nameplate(),
        headers=auth(agent),
    )
    assert resp.status_code == 422


async def test_the_worker_marks_its_own_rows(client, make_user, s3, monkeypatch):
    from app.workers import ocr as ocr_worker

    async def fake(image, content_type, *, client=None):
        return DoctorFields(doctor_name="Rahman")

    monkeypatch.setattr(ocr_worker, "extract_doctor_fields", fake)

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    survey_id = resp.json()["id"]

    await ocr_worker.process_survey(UUID(survey_id))

    row = await row_for(survey_id)
    assert row.ocr_status == "done"
    assert row.ocr_source == "worker"


async def test_an_admin_correction_is_sourced_admin(client, make_user, s3):
    agent = await make_user()
    admin = await make_user(role="admin")
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    survey_id = resp.json()["id"]

    patched = await client.patch(
        f"/api/admin/surveys/{survey_id}/doctor",
        json={"doctor_name": "Corrected"},
        headers=auth(admin),
    )
    assert patched.status_code == 200
    assert patched.json()["ocr_source"] == "admin"


async def test_a_reread_clears_the_source(client, make_user, s3):
    agent = await make_user()
    admin = await make_user(role="admin")
    resp = await client.post(
        "/api/surveys",
        data=form(doctor_name="Rahman"),
        files=nameplate(),
        headers=auth(agent),
    )
    survey_id = resp.json()["id"]

    await client.post(f"/api/admin/surveys/{survey_id}/reread", headers=auth(admin))

    row = await row_for(survey_id)
    assert row.ocr_status == "pending"
    assert row.ocr_source is None
```

If `make_user` does not take a `role` argument, check `tests/conftest.py` and use whatever it provides for creating an admin — `tests/test_admin_api.py` shows the working pattern.

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && uv run pytest tests/test_ocr_source.py -v`
Expected: FAIL — the doctor form fields are ignored and `ocr_source` is never set.

- [ ] **Step 3: Extend the schemas**

In `backend/app/schemas/survey.py`, add to `SurveyCreate` after `phones`:

```python
    # Read from the nameplate on upload and approved by the agent. Absent when
    # no preview ran, which leaves the row to the worker.
    doctor_name: str | None = Field(default=None, max_length=200)
    doctor_degrees: str | None = Field(default=None, max_length=1000)
    doctor_specializations: str | None = Field(default=None, max_length=1000)
```

and a validator beside `_blank_is_absent`:

```python
    @field_validator("doctor_name", "doctor_degrees", "doctor_specializations")
    @classmethod
    def _blank_doctor_field_is_absent(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None
```

Add to `SurveyRead` after `ocr_error`:

```python
    ocr_source: str | None = None
```

- [ ] **Step 4: Accept and store them**

In `backend/app/api/surveys.py`, add three parameters to `create_survey`'s signature, after `longitude`:

```python
    doctor_name: Annotated[str | None, Form()] = None,
    doctor_degrees: Annotated[str | None, Form()] = None,
    doctor_specializations: Annotated[str | None, Form()] = None,
```

pass them into the `SurveyCreate(...)` construction:

```python
            doctor_name=doctor_name,
            doctor_degrees=doctor_degrees,
            doctor_specializations=doctor_specializations,
```

and set them on the row when building it. After `row = ChamberSurvey(...)` and before `session.add(row)`:

```python
    # Any one field present means a preview ran and the agent approved what they
    # saw, so there is nothing left for the worker to do. All three blank is
    # treated as no preview: a nameplate the model could not read is worth
    # retrying, not recording as a finished empty read.
    approved = (
        payload.doctor_name or payload.doctor_degrees or payload.doctor_specializations
    )
    if approved:
        row.doctor_name = payload.doctor_name
        row.doctor_degrees = payload.doctor_degrees
        row.doctor_specializations = payload.doctor_specializations
        row.ocr_status = "done"
        row.ocr_source = "upload"
        row.ocr_completed_at = datetime.now(UTC)
```

Add `from datetime import UTC, datetime` to the imports if it is not already there.

- [ ] **Step 5: Mark the other two paths**

In `backend/app/workers/ocr.py`, in the success block of `process_survey`, beside `row.ocr_status = "done"`:

```python
            row.ocr_source = "worker"
```

In `backend/app/api/admin.py`, in `correct_doctor_fields`, beside `row.ocr_status = "done"`:

```python
    row.ocr_source = "admin"
```

and in `reread_nameplate`, beside `row.ocr_status = "pending"`:

```python
    row.ocr_source = None
```

- [ ] **Step 6: Run to verify they pass**

Run: `cd backend && uv run pytest && uv run ruff check .`
Expected: all pass, including the pre-existing suites.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas/survey.py backend/app/api/surveys.py \
        backend/app/api/admin.py backend/app/workers/ocr.py \
        backend/tests/test_ocr_source.py
git commit -m "feat(ocr): store the doctor fields the agent approved

When the form carries doctor fields the row is filed done/upload and no second
model call is made, so what the agent saw is what is stored and a nameplate
costs one call rather than two. All three blank is deliberately treated as no
preview, so an unreadable nameplate is retried by the worker rather than
recorded as a finished empty read.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 5: Frontend API client and schema

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/schemas/survey.ts`
- Test: `frontend/src/schemas/survey.test.ts`

**Interfaces:**
- Consumes: the endpoint from Task 3.
- Produces: `previewNameplate(file: File): Promise<DoctorFields | null>`, `interface DoctorFields`, and `doctor_name` / `doctor_degrees` / `doctor_specializations` on `doctorSchema`.

- [ ] **Step 1: Write the failing tests**

Append to the `describe("schema split", ...)` block in `frontend/src/schemas/survey.test.ts`:

```ts
  it("accepts a doctor with no nameplate fields read", () => {
    const parsed = doctorSchema.parse(doctor);
    expect(parsed.doctor_name).toBe("");
    expect(parsed.doctor_degrees).toBe("");
    expect(parsed.doctor_specializations).toBe("");
  });

  it("keeps the fields the agent approved", () => {
    const parsed = doctorSchema.parse({
      ...doctor,
      doctor_name: "  Rahman  ",
      doctor_specializations: "Cardiology",
    });
    expect(parsed.doctor_name).toBe("Rahman");
    expect(parsed.doctor_specializations).toBe("Cardiology");
  });

  it("rejects a doctor name longer than the column allows", () => {
    const bad = { ...doctor, doctor_name: "x".repeat(201) };
    expect(doctorSchema.safeParse(bad).success).toBe(false);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd frontend && npx vitest run src/schemas/survey.test.ts`
Expected: FAIL — the fields do not exist, so `parsed.doctor_name` is `undefined`.

- [ ] **Step 3: Add the fields to the schema**

In `frontend/src/schemas/survey.ts`, add to `doctorShape`:

```ts
  // Read from the nameplate on upload and editable by the agent. Blank means
  // no preview ran, which leaves the row to the background worker.
  doctor_name: z.string().trim().max(200).default(""),
  doctor_degrees: z.string().trim().max(1000).default(""),
  doctor_specializations: z.string().trim().max(1000).default(""),
```

and to `emptyDoctorValues()`:

```ts
  doctor_name: "",
  doctor_degrees: "",
  doctor_specializations: "",
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd frontend && npx vitest run`
Expected: all pass.

- [ ] **Step 5: Add the API client**

In `frontend/src/api.ts`, add the interface beside the other exported types:

```ts
export interface DoctorFields {
  doctor_name: string | null;
  doctor_degrees: string | null;
  doctor_specializations: string | null;
}
```

add `ocr_source` to the `Survey` interface after `ocr_error`:

```ts
  ocr_source: "upload" | "worker" | "admin" | null;
```

and the call beside `createSurvey`:

```ts
/** Reads a nameplate without filing anything. Resolves to null when the server
 *  has OCR switched off, which the form treats the same as a failure: quiet,
 *  and the worker reads it after submit. */
export const previewNameplate = (file: File) => {
  const body = new FormData();
  body.set("nameplate", file);
  return request<DoctorFields | null>("/api/surveys/nameplate/preview", {
    method: "POST",
    body,
  });
};
```

`request` already returns `undefined` for a 204, which is falsy — the caller checks for a truthy result.

- [ ] **Step 6: Full frontend gate**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run lint && npx vite build`
Expected: all exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.ts frontend/src/schemas/survey.ts frontend/src/schemas/survey.test.ts
git commit -m "feat(ocr): add the preview client and the doctor form fields

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 6: Upload image or open camera

**Files:**
- Modify: `frontend/src/components/NameplateInput.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change — `NameplateInput` keeps the same props, so `DoctorPage` is untouched by this task.

One input, two buttons. `capture` is set immediately before `.click()`. Two inputs would mean two refs to clear on every reset, and missing one silently breaks re-picking the same filename after a submit — which is the second doctor at every hospital.

- [ ] **Step 1: Replace the bare input with two buttons**

In `frontend/src/components/NameplateInput.tsx`, add `Camera` and `ImageUp` to the lucide import and `Button` to the component imports, then replace the `<Input type="file" .../>` element with:

```tsx
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Nameplate photo"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          // Checked here so a 10MB upload does not travel before being refused.
          if (picked && picked.size > MAX_BYTES) {
            setSizeError("Image is larger than 10MB.");
            onChange(null);
            return;
          }
          setSizeError(null);
          onChange(picked);
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => open("camera")}>
          <Camera className="size-4" aria-hidden /> Open camera
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => open("library")}>
          <ImageUp className="size-4" aria-hidden /> Upload image
        </Button>
      </div>
```

and add the opener above the `return`:

```tsx
  /** `capture` is set per click rather than fixed on the element: with it the
   *  OS opens the camera straight to the rear lens, without it the normal
   *  picker. Desktop browsers ignore it, so "Open camera" degrades to the
   *  picker there, which is fine - the agents are on phones. */
  const open = (source: "camera" | "library") => {
    const el = inputRef.current;
    if (!el) return;
    if (source === "camera") el.setAttribute("capture", "environment");
    else el.removeAttribute("capture");
    el.click();
  };
```

The `Input` import is now unused — remove it if nothing else in the file uses it.

- [ ] **Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run lint && npx vite build`
Expected: all exit 0. There is no unit test here — the component is a file input and two buttons, and the project has no DOM tests.

- [ ] **Step 3: Manual check on a phone**

Serve the build and confirm on a real device:
1. "Open camera" opens the camera at the rear lens.
2. "Upload image" opens the gallery/file picker.
3. Cancelling either leaves the form untouched.
4. After filing a doctor, picking the **same filename** again still registers — this is what the single-input decision protects.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/NameplateInput.tsx
git commit -m "feat(nameplate): offer camera and file picker separately

An agent at a nameplate is taking a photo, not browsing a gallery. One hidden
input still owns the file; capture is set per click so the camera opens to the
rear lens. Kept to one input because the existing reset clears
inputRef.current.value, and a second ref left uncleared would silently break
re-picking the same filename on the next doctor.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 7: Wire the preview into the doctor form

**Files:**
- Modify: `frontend/src/routes/DoctorPage.tsx`

**Interfaces:**
- Consumes: `previewNameplate` and `DoctorFields` (Task 5), the schema fields (Task 5), `NameplateInput` (Task 6).
- Produces: the finished flow.

- [ ] **Step 1: Add the preview state and the race guard**

In `frontend/src/routes/DoctorPage.tsx`, add `useRef` to the react import, `previewNameplate` to the `@/api` import, and inside the component:

```tsx
  const [ocrState, setOcrState] = useState<"idle" | "reading" | "done" | "failed">(
    "idle",
  );
  // An agent can replace the photo while a call is in flight. Without this the
  // slower first response overwrites the second photo's fields, leaving one
  // nameplate's details beside a different nameplate's image - and then stored
  // as approved by a human.
  const previewToken = useRef(0);

  const readNameplate = async (picked: File | null) => {
    const token = ++previewToken.current;
    form.setValue("doctor_name", "");
    form.setValue("doctor_degrees", "");
    form.setValue("doctor_specializations", "");

    if (!picked) {
      setOcrState("idle");
      return;
    }

    setOcrState("reading");
    try {
      const fields = await previewNameplate(picked);
      if (token !== previewToken.current) return;
      if (!fields) {
        setOcrState("idle");
        return;
      }
      form.setValue("doctor_name", fields.doctor_name ?? "");
      form.setValue("doctor_degrees", fields.doctor_degrees ?? "");
      form.setValue("doctor_specializations", fields.doctor_specializations ?? "");
      setOcrState("done");
    } catch {
      if (token !== previewToken.current) return;
      // Not shouted at the agent: the worker reads it after filing.
      setOcrState("failed");
    }
  };
```

- [ ] **Step 2: Trigger it from the nameplate**

Change the `NameplateInput` `onChange` prop to also start the read:

```tsx
                onChange={(f) => {
                  setNameplate(f);
                  // Otherwise the destructive "required" text sits under a
                  // perfectly valid image until the next submit attempt.
                  if (f) setNameplateError(null);
                  void readNameplate(f);
                }}
```

- [ ] **Step 3: Render the doctor fields**

Add directly below `NameplateInput`:

```tsx
              <fieldset className="space-y-3 rounded-lg border p-4">
                <div>
                  <Label className="text-sm font-medium">Doctor details</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ocrState === "reading"
                      ? "Reading the nameplate…"
                      : ocrState === "done"
                        ? "Read from the nameplate. Correct anything that is wrong."
                        : ocrState === "failed"
                          ? "Couldn't read the nameplate. It will be read after filing."
                          : "Filled in from the nameplate photo once you add one."}
                  </p>
                </div>
                {(
                  [
                    ["doctor_name", "Name"],
                    ["doctor_degrees", "Degrees"],
                    ["doctor_specializations", "Specializations"],
                  ] as const
                ).map(([name, label]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">{label}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value ?? ""}
                            disabled={ocrState === "reading"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </fieldset>
```

Add `Label` to the imports from `@/components/ui/label`.

- [ ] **Step 4: Send them and reset them**

In `onSubmit`, after the `consultation_fee_bdt` line:

```tsx
      // Blank means no preview ran; the server then leaves the row to the worker.
      if (parsed.doctor_name) body.set("doctor_name", parsed.doctor_name);
      if (parsed.doctor_degrees) body.set("doctor_degrees", parsed.doctor_degrees);
      if (parsed.doctor_specializations)
        body.set("doctor_specializations", parsed.doctor_specializations);
```

and in the success branch, beside the existing resets:

```tsx
      setOcrState("idle");
      previewToken.current++;
```

Bumping the token discards any preview still in flight for the doctor just filed, so it cannot land in the next doctor's form.

- [ ] **Step 5: Verify**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npm run lint && npx vite build`
Expected: all exit 0.

- [ ] **Step 6: Manual check of the whole flow**

With the stack running and `OPENROUTER_API_KEY` set:
1. Pick a nameplate → fields populate; correct one; file → survey shows `ocr_source: "upload"` and the corrected value.
2. Replace the photo mid-read → the fields match the **second** photo.
3. Submit while still reading → survey files `pending`, worker fills it, `ocr_source: "worker"`.
4. `OCR_MODE=off` → no fields appear, submit still works.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/routes/DoctorPage.tsx
git commit -m "feat(ocr): read the nameplate while the agent is still on the form

Picking a photo posts it to the preview endpoint and drops the name, degrees
and specializations into editable fields, so the agent standing at the
nameplate is the one who corrects the model. A failure is quiet - the survey
files pending and the worker reads it later.

A request token discards stale preview responses: replacing the photo mid-call
would otherwise show one nameplate's details beside another's image and store
them as human-approved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

## Self-Review

**Spec coverage:** preview endpoint → Task 3. Editable fields → Tasks 5, 7. Reuse at submit → Task 4. `ocr_source` at all four write points → Tasks 1, 4. `inline` removal incl. the rescued guarantee → Task 2. Two upload routes → Task 6. Race guard → Task 7. All-blank-means-no-preview → Task 4 Step 4 and its test. `OCR_MODE=off` → Task 3 (204) and Task 7 (null handled as idle).

**Spec items deliberately not implemented:** rate limiting on the preview endpoint and image downscaling — both recorded as known gaps in the spec's "Cost and abuse" and "Non-goals".

**Placeholder scan:** every code step carries the actual code. The two "check the existing pattern" notes (the `make_user` role argument in Task 4, the unused `Input` import in Task 6) are verification instructions, not deferred decisions.

**Type consistency:** `DoctorFields` is the same name in `services/ocr.py` and `api.ts`, with `null` fields in both. `ocr_source` is `str | None` on the model, `str | None` on `SurveyRead`, and a union with `null` in `api.ts`. `previewNameplate` returns `DoctorFields | null` and Task 7 checks the falsy case. `emptyDoctorValues()` gains exactly the three keys Task 5 adds to `doctorShape`.
