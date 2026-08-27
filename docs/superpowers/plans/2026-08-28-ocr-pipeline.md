# Nameplate OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill `doctor_name`, `doctor_degrees` and `doctor_specializations` from the nameplate photograph, using a vision model on OpenRouter.

**Architecture:** A pure `extract_doctor_fields(image, content_type)` that knows OpenRouter and nothing else, and a runner that knows the database and the clock. `OCR_MODE` decides who calls it — a background poll loop, the submit request itself, or nobody — so moving the work inline or into a separate service is configuration, not a rewrite.

**Tech Stack:** httpx (promoted to a runtime dependency), OpenRouter chat-completions, `google/gemma-4-31b-it` by default, Alembic, SQLModel, React + shadcn on the admin side.

**Spec:** `docs/superpowers/specs/2026-08-28-ocr-pipeline-design.md`

## Global Constraints

- `pytest` must pass with **no stack running and no network**. Every OpenRouter call in tests goes through `httpx.MockTransport`. **No test makes a real API call.**
- Ruff `line-length = 100`, `select = ["E", "F", "I", "UP", "B"]`; run `uv run ruff check .` before every commit.
- **A failed extraction must never fail a survey submit.** In `inline` mode the survey commits first; any `OcrError` is caught, recorded, and swallowed.
- **A missing `OPENROUTER_API_KEY` is not a startup failure.** It logs once and leaves the worker idle. Unlike `JWT_SECRET`, the app must still run.
- The prompt instructs `null` for anything the nameplate does not show. **Never a guess** — a hallucinated degree list is indistinguishable from a correct one downstream.
- `ocr_error` is truncated to 1000 characters on write.
- Existing behaviour is untouched: the 116 backend tests and 22 frontend tests must stay green.

### Two facts about this repo that the tasks depend on

**`httpx` is currently a dev-only dependency** (`pyproject.toml` `[dependency-groups] dev`). The OCR client needs it in production; Task 1 promotes it.

**The test database is SQLite, which has no `FOR UPDATE SKIP LOCKED`.** The claim query is dialect-aware: `skip_locked` on Postgres, a plain ordered select on SQLite. `app/db/session.py` already exposes `_is_sqlite` for exactly this kind of branch.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/services/ocr.py` | **New, pure.** OpenRouter request, tolerant JSON parsing, `DoctorFields`, `OcrError`. No database, no FastAPI, no survey concept. |
| `app/workers/ocr.py` | **New.** Claim, process, reap, the poll loop, and a `__main__` entry so `python -m app.workers.ocr` runs it detached. |
| `app/services/storage.py` | Gains `download_object`. |
| `app/core/config.py` | Eight OCR settings plus a mode validator. |
| `app/models/survey.py` | Four new columns. |
| `alembic/versions/0003_ocr.py` | Migration. |
| `app/api/admin.py` | Correction and re-read endpoints. |
| `app/api/surveys.py` | Inline-mode hook after commit. |
| `app/main.py` | Starts and cancels the worker task. |
| `frontend/src/routes/AdminPage.tsx` | Editable doctor fields, re-read, failure text. |

---

## Task 1: Settings, the storage helper, and the httpx promotion

**Files:**
- Modify: `backend/pyproject.toml`, `backend/app/core/config.py`, `backend/app/services/storage.py`
- Test: `backend/tests/test_ocr_config.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `download_object(key: str) -> tuple[bytes, str]` — bytes and stored content type
  - Settings: `ocr_mode`, `openrouter_api_key`, `openrouter_base_url`, `ocr_model`, `ocr_poll_seconds`, `ocr_batch_size`, `ocr_max_attempts`, `ocr_timeout_seconds`, `ocr_stale_minutes`

- [ ] **Step 1: Promote httpx to a runtime dependency**

```bash
cd backend && uv add httpx
```

It stays listed under dev as well; `uv add` moves it into `[project] dependencies`, which is what the worker needs in the production image.

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_ocr_config.py`:

```python
import io

import pytest

from app.core.config import Settings


def test_ocr_mode_defaults_to_worker():
    assert Settings(_env_file=None).ocr_mode == "worker"


def test_ocr_mode_accepts_the_three_modes():
    for mode in ("worker", "inline", "off"):
        assert Settings(_env_file=None, ocr_mode=mode).ocr_mode == mode


def test_an_unknown_ocr_mode_is_rejected():
    # A typo'd mode must fail at boot, not silently disable extraction.
    with pytest.raises(ValueError, match="ocr_mode"):
        Settings(_env_file=None, ocr_mode="backgruond")


def test_a_missing_api_key_is_not_a_startup_failure():
    """Unlike JWT_SECRET: OCR enriches data, it does not gate the system."""
    settings = Settings(
        _env_file=None,
        debug=False,
        jwt_secret="x" * 40,
        admin_password="a-real-password",
        openrouter_api_key="",
    )
    assert settings.openrouter_api_key == ""


def test_default_model_is_a_vision_capable_gemma():
    assert Settings(_env_file=None).ocr_model == "google/gemma-4-31b-it"


async def test_download_object_round_trips_bytes_and_content_type(s3):
    from app.services import storage

    storage.upload_fileobj(io.BytesIO(b"\xff\xd8\xff-fake-jpeg"), "surveys/x.jpg", "image/jpeg")
    blob, content_type = storage.download_object("surveys/x.jpg")
    assert blob == b"\xff\xd8\xff-fake-jpeg"
    assert content_type == "image/jpeg"
```

- [ ] **Step 3: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_ocr_config.py -q`
Expected: FAIL — `ocr_mode` does not exist, `download_object` is not defined.

- [ ] **Step 4: Add the settings**

In `backend/app/core/config.py`, inside `class Settings` after `demo_password`:

```python
    # Where extraction runs. "worker" polls in the background, "inline" runs it
    # during POST /api/surveys, "off" runs nothing. Changing this is how the
    # work moves inline or into a detached service - no code change.
    ocr_mode: str = "worker"
    # Empty disables extraction without preventing boot: OCR enriches data, it
    # does not gate the system.
    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Swappable without a deploy: which Gemma reads a Bangla-English nameplate
    # better cannot be known without trying both against real photographs.
    ocr_model: str = "google/gemma-4-31b-it"
    ocr_poll_seconds: int = 10
    ocr_batch_size: int = 5
    ocr_max_attempts: int = 3
    ocr_timeout_seconds: int = 60
    # A claimed row whose process died is returned to pending after this.
    ocr_stale_minutes: int = 15
```

And add a validator beside `_refuse_insecure_defaults`:

```python
    @field_validator("ocr_mode")
    @classmethod
    def _known_ocr_mode(cls, value: str) -> str:
        if value not in ("worker", "inline", "off"):
            raise ValueError("ocr_mode must be 'worker', 'inline' or 'off'")
        return value
```

Add `field_validator` to the pydantic import at the top:

```python
from pydantic import field_validator, model_validator
```

- [ ] **Step 5: Add the storage helper**

Append to `backend/app/services/storage.py`:

```python
def download_object(key: str) -> tuple[bytes, str]:
    """Fetch an object's bytes and its stored content type.

    The OCR runner needs the image itself, not a link: OpenRouter fetches
    images from its own servers, and a presigned URL here points at an
    address only this network can reach.
    """
    settings = get_settings()
    resp = get_s3_client().get_object(Bucket=settings.s3_bucket, Key=key)
    content_type = resp.get("ContentType") or "application/octet-stream"
    return resp["Body"].read(), content_type
```

- [ ] **Step 6: Run to verify passing**

Run: `cd backend && uv run pytest tests/test_ocr_config.py -q`
Expected: PASS, 6 tests

- [ ] **Step 7: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app backend/tests backend/pyproject.toml backend/uv.lock
git commit -m "feat(ocr): settings, mode validation, and a storage download helper

httpx becomes a runtime dependency: the OCR client needs it in the production
image, where dev groups are not installed."
```

---

## Task 2: The extraction call

**Files:**
- Create: `backend/app/services/ocr.py`
- Test: `backend/tests/test_ocr_service.py`

**Interfaces:**
- Consumes: the settings from Task 1.
- Produces:
  - `class DoctorFields(BaseModel)` with `doctor_name`, `doctor_degrees`, `doctor_specializations`, all `str | None`
  - `class OcrError(RuntimeError)`
  - `async def extract_doctor_fields(image: bytes, content_type: str, *, client: httpx.AsyncClient | None = None) -> DoctorFields`

**The `client` parameter is the testing seam.** Passing an `httpx.AsyncClient`
built on `MockTransport` is how every test here avoids the network; production
callers omit it.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ocr_service.py`:

```python
import httpx
import pytest

from app.services.ocr import DoctorFields, OcrError, extract_doctor_fields

IMAGE = b"\xff\xd8\xff-fake-jpeg"


def reply(content: str, status: int = 200) -> httpx.AsyncClient:
    """An OpenRouter stand-in that returns `content` as the message body."""

    def handler(request: httpx.Request) -> httpx.Response:
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "boom"}})
        return httpx.Response(
            200, json={"choices": [{"message": {"content": content}}]}
        )

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_clean_json_is_parsed():
    body = (
        '{"doctor_name": "Rahim Uddin", '
        '"doctor_degrees": "MBBS, FCPS (Medicine)", '
        '"doctor_specializations": "Cardiology"}'
    )
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields == DoctorFields(
        doctor_name="Rahim Uddin",
        doctor_degrees="MBBS, FCPS (Medicine)",
        doctor_specializations="Cardiology",
    )


async def test_json_inside_a_code_fence_is_parsed():
    """Models return fenced JSON no matter how the prompt is worded."""
    body = '```json\n{"doctor_name": "Rahim Uddin"}\n```'
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_name == "Rahim Uddin"
    assert fields.doctor_degrees is None


async def test_json_with_surrounding_prose_is_parsed():
    body = 'Here is what I found:\n{"doctor_name": "Rahim Uddin"}\nHope that helps!'
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_name == "Rahim Uddin"


async def test_explicit_nulls_stay_none():
    """The prompt asks for null rather than a guess; that must survive."""
    body = (
        '{"doctor_name": "Rahim Uddin", "doctor_degrees": null, '
        '"doctor_specializations": null}'
    )
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_degrees is None
    assert fields.doctor_specializations is None


async def test_empty_strings_are_normalised_to_none():
    """A blank string would render as an empty field rather than 'pending'."""
    body = '{"doctor_name": "Rahim Uddin", "doctor_degrees": "", "doctor_specializations": "  "}'
    async with reply(body) as client:
        fields = await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    assert fields.doctor_degrees is None
    assert fields.doctor_specializations is None


async def test_prose_with_no_json_raises_after_one_retry():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200, json={"choices": [{"message": {"content": "I cannot read this."}}]}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(OcrError, match="could not parse"):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)
    # One retry, not an unbounded loop.
    assert calls == 2


async def test_rate_limiting_raises_without_retrying():
    async with reply("", status=429) as client:
        with pytest.raises(OcrError, match="429"):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)


async def test_server_error_raises():
    async with reply("", status=500) as client:
        with pytest.raises(OcrError, match="500"):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)


async def test_a_timeout_becomes_an_ocr_error():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(OcrError):
            await extract_doctor_fields(IMAGE, "image/jpeg", client=client)


async def test_the_image_is_sent_inline_as_a_data_uri():
    """Not a URL: OpenRouter cannot reach this network's object storage."""
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json as _json

        captured.update(_json.loads(request.content))
        return httpx.Response(
            200, json={"choices": [{"message": {"content": '{"doctor_name": "X"}'}}]}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await extract_doctor_fields(IMAGE, "image/jpeg", client=client)

    parts = captured["messages"][0]["content"]
    image_part = next(p for p in parts if p["type"] == "image_url")
    assert image_part["image_url"]["url"].startswith("data:image/jpeg;base64,")
    assert "localhost" not in image_part["image_url"]["url"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_ocr_service.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ocr'`

- [ ] **Step 3: Implement `app/services/ocr.py`**

```python
import base64
import json
import logging
import re

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class OcrError(RuntimeError):
    """Any failure to obtain fields from the model: transport, status, parse."""


class DoctorFields(BaseModel):
    doctor_name: str | None = None
    doctor_degrees: str | None = None
    doctor_specializations: str | None = None


PROMPT = """You are reading a photograph of a doctor's nameplate from a hospital in Bangladesh.

Return ONLY a JSON object with exactly these three keys:
  "doctor_name", "doctor_degrees", "doctor_specializations"

Rules:
- Use null for anything the nameplate does not clearly show. Never guess.
- doctor_name: the person's name as printed, without the "Dr." honorific.
- doctor_degrees: the qualifications exactly as printed, e.g. "MBBS, FCPS (Medicine)".
- doctor_specializations: the stated specialty or department, e.g. "Cardiology".
- The text may be Bangla, English, or both. Transcribe it as printed.
- No commentary, no explanation, no markdown."""

_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)
_OBJECT = re.compile(r"\{.*\}", re.S)


def _blank_to_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _parse(content: str) -> DoctorFields:
    """Tolerant on purpose: models return fenced JSON and chatty preambles
    regardless of what the prompt asks for."""
    candidate = content.strip()
    fenced = _FENCE.search(candidate)
    if fenced:
        candidate = fenced.group(1).strip()
    else:
        obj = _OBJECT.search(candidate)
        if obj:
            candidate = obj.group(0)

    try:
        raw = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise OcrError(f"could not parse model output as JSON: {content[:200]}") from exc
    if not isinstance(raw, dict):
        raise OcrError(f"could not parse model output as an object: {content[:200]}")

    try:
        fields = DoctorFields.model_validate(
            {k: raw.get(k) for k in DoctorFields.model_fields}
        )
    except ValidationError as exc:
        raise OcrError(f"could not parse model output: {exc}") from exc

    return DoctorFields(
        doctor_name=_blank_to_none(fields.doctor_name),
        doctor_degrees=_blank_to_none(fields.doctor_degrees),
        doctor_specializations=_blank_to_none(fields.doctor_specializations),
    )


def _payload(image: bytes, content_type: str) -> dict:
    # Inline base64, not a URL: OpenRouter fetches images from its own servers,
    # and a presigned RustFS link points at an address only we can reach.
    encoded = base64.b64encode(image).decode()
    return {
        "model": settings.ocr_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{content_type};base64,{encoded}"},
                    },
                ],
            }
        ],
    }


async def _ask(client: httpx.AsyncClient, payload: dict) -> str:
    try:
        resp = await client.post(
            f"{settings.openrouter_base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {settings.openrouter_api_key}"},
            timeout=settings.ocr_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        raise OcrError(f"request to OpenRouter failed: {exc}") from exc

    if resp.status_code != 200:
        raise OcrError(f"OpenRouter returned {resp.status_code}: {resp.text[:200]}")

    try:
        return resp.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, ValueError) as exc:
        raise OcrError(f"unexpected OpenRouter response shape: {exc}") from exc


async def extract_doctor_fields(
    image: bytes,
    content_type: str,
    *,
    client: httpx.AsyncClient | None = None,
) -> DoctorFields:
    """Read a nameplate. Raises OcrError on any failure.

    Knows nothing about surveys, the database, or HTTP routing - which is what
    lets the same function serve the background worker, an inline call during
    submit, and a detached service.
    """
    payload = _payload(image, content_type)
    owned = client is None
    http = client or httpx.AsyncClient()
    try:
        content = await _ask(http, payload)
        try:
            return _parse(content)
        except OcrError:
            # One retry: a malformed response is often transient. A status
            # error is not, and is not retried here.
            logger.warning("unparseable OCR response, retrying once")
            return _parse(await _ask(http, payload))
    finally:
        if owned:
            await http.aclose()
```

- [ ] **Step 4: Run to verify passing**

Run: `cd backend && uv run pytest tests/test_ocr_service.py -q`
Expected: PASS, 10 tests

- [ ] **Step 5: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app/services/ocr.py backend/tests/test_ocr_service.py
git commit -m "feat(ocr): pure nameplate extraction against OpenRouter

Knows nothing about surveys or the database, so the same function serves the
worker, an inline call, and a detached service."
```

---

## Task 3: Columns and migration

**Files:**
- Modify: `backend/app/models/survey.py`
- Create: `backend/alembic/versions/0003_ocr.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `ChamberSurvey.ocr_attempts: int`, `.ocr_error: str | None`, `.ocr_started_at`, `.ocr_next_attempt_at`, `.ocr_completed_at`; `ocr_status` now allows `'processing'`.

**Deviation from the spec, deliberate.** The spec calls for exponential backoff
between attempts but lists no column to hold the next attempt time — with only
`status='pending'` the poll loop would re-claim a failed row on the very next
pass and hammer a failing API. `ocr_next_attempt_at` makes the backoff real.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_models.py`:

```python
async def test_survey_starts_with_no_ocr_attempts(session: AsyncSession):
    user = await _agent(session)
    survey = _survey(user.id, city="Dhaka", district="Dhaka")
    session.add(survey)
    await session.commit()
    await session.refresh(survey)
    assert survey.ocr_status == "pending"
    assert survey.ocr_attempts == 0
    assert survey.ocr_error is None
    assert survey.ocr_started_at is None
    assert survey.ocr_next_attempt_at is None
    assert survey.ocr_completed_at is None


async def test_processing_is_now_a_valid_ocr_status(session: AsyncSession):
    user = await _agent(session)
    survey = _survey(user.id, city="Dhaka", district="Dhaka", ocr_status="processing")
    session.add(survey)
    await session.commit()


async def test_an_unknown_ocr_status_is_still_rejected(session: AsyncSession):
    user = await _agent(session)
    session.add(_survey(user.id, city="Dhaka", district="Dhaka", ocr_status="wat"))
    with pytest.raises(IntegrityError):
        await session.commit()
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_models.py -q`
Expected: FAIL — `ocr_attempts` is not a field; `'processing'` violates the CHECK.

- [ ] **Step 3: Add the columns**

In `backend/app/models/survey.py`, replace the `ocr_status` line and add the
new columns beneath the doctor fields:

```python
    ocr_status: str = Field(default="pending", max_length=16)
    doctor_name: str | None = Field(default=None, max_length=200)
    doctor_degrees: str | None = Field(default=None, max_length=1000)
    doctor_specializations: str | None = Field(default=None, max_length=1000)
    # server_default: these are NOT NULL on a table that already has rows.
    ocr_attempts: int = Field(
        default=0, sa_column=Column(Integer, nullable=False, server_default="0")
    )
    # Truncated to 1000 chars on write; a model returning prose would otherwise
    # write an unbounded string into every failed row.
    ocr_error: str | None = Field(default=None, max_length=1000)
    ocr_started_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # Backoff between attempts. Without it the poll loop re-claims a failed row
    # on the very next pass and hammers a failing API.
    ocr_next_attempt_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), index=True, nullable=True)
    )
    ocr_completed_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
```

Update the CHECK constraint in `__table_args__`:

```python
        CheckConstraint(
            "ocr_status IN ('pending', 'processing', 'done', 'failed')",
            name="ck_surveys_ocr_status",
        ),
```

Add `Integer` to the sqlalchemy import:

```python
from sqlalchemy import CheckConstraint, Column, DateTime, Integer
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend
rm -f _autogen.db
export DATABASE_URL="sqlite:///./_autogen.db" DEBUG=true
uv run alembic upgrade head
uv run alembic revision --autogenerate -m "ocr columns"
unset DATABASE_URL DEBUG
mv alembic/versions/*_ocr_columns.py alembic/versions/0003_ocr.py
rm -f _autogen.db
```

Set `revision = "0003"` and `down_revision = "0002"` in the generated file.

**Autogenerate will not notice the changed CHECK constraint** — Alembic does
not diff named check constraints by default. Add the drop and recreate by hand
inside the existing `batch_alter_table('users'…)`-style block for
`chamber_surveys`:

```python
    with op.batch_alter_table("chamber_surveys", schema=None) as batch_op:
        batch_op.drop_constraint("ck_surveys_ocr_status", type_="check")
        batch_op.create_check_constraint(
            "ck_surveys_ocr_status",
            "ocr_status IN ('pending', 'processing', 'done', 'failed')",
        )
```

- [ ] **Step 5: Verify the migration matches the models**

Run: `cd backend && uv run pytest tests/test_models.py tests/test_migrations.py -q`
Expected: PASS. `test_migrated_schema_matches_the_models` is the check that
matters — if it reports a diff, fix the revision, not the test.

- [ ] **Step 6: Apply it to the running database**

```bash
cd .. && docker compose up -d backend && sleep 12
docker compose logs --tail=30 backend 2>&1 | grep -i "running upgrade"
docker compose exec -T postgres psql -U app -d app -c \
  "SELECT ocr_status, ocr_attempts FROM chamber_surveys LIMIT 3;"
```

Expected: `0002 -> 0003` in the log, and the query succeeds with
`ocr_attempts` defaulted to 0 on any existing rows.

- [ ] **Step 7: Lint and commit**

```bash
cd backend && uv run ruff check . && cd ..
git add backend/app/models/survey.py backend/alembic/versions/0003_ocr.py backend/tests/test_models.py
git commit -m "feat(ocr): attempt tracking, error text, and a processing status

ocr_next_attempt_at is a deliberate addition to the spec: without it the poll
loop re-claims a failed row immediately and hammers a failing API."
```

---

## Task 4: The runner

**Files:**
- Create: `backend/app/workers/__init__.py`, `backend/app/workers/ocr.py`
- Test: `backend/tests/test_ocr_runner.py`

**Interfaces:**
- Consumes: `extract_doctor_fields`, `OcrError`, `DoctorFields` (Task 2); `download_object` (Task 1); the columns (Task 3).
- Produces:
  - `async def claim_pending(session, limit: int) -> list[UUID]`
  - `async def process_survey(survey_id: UUID, *, client: httpx.AsyncClient | None = None) -> None`
  - `async def reap_stale(session) -> int`
  - `async def run_once(*, client=None) -> int` — reap, claim, process; returns rows processed
  - `async def run_worker_forever() -> None`

**Named `app/workers/ocr.py`, not `ocr_runner.py` as the spec sketched**, so
that `python -m app.workers.ocr` is the detached entry point without a second
file whose only job is to import the first.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ocr_runner.py`:

```python
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
import pytest
from sqlmodel import select

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from app.workers.ocr import claim_pending, process_survey, reap_stale, run_once


def reply(content: str, status: int = 200) -> httpx.AsyncClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if status != 200:
            return httpx.Response(status, json={"error": {"message": "boom"}})
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


GOOD = (
    '{"doctor_name": "Rahim Uddin", "doctor_degrees": "MBBS, FCPS", '
    '"doctor_specializations": "Cardiology"}'
)


@pytest.fixture
async def survey(make_user, s3):
    """A pending survey whose nameplate really exists in storage."""
    import io

    from app.services import storage

    user = await make_user()
    key = "surveys/nameplate.jpg"
    storage.upload_fileobj(io.BytesIO(b"\xff\xd8\xff-fake"), key, "image/jpeg")

    async with SessionLocal() as session:
        row = ChamberSurvey(
            user_id=user.id,
            hospital_name="Square",
            city="Dhaka",
            district="Dhanmondi",
            nameplate_key=key,
            daily_patients=30,
            avg_duration_min=10,
            consultation_fee_bdt=1200,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row


async def _reload(survey_id: UUID) -> ChamberSurvey:
    async with SessionLocal() as session:
        return await session.get(ChamberSurvey, survey_id)


async def test_claim_marks_rows_processing(survey):
    async with SessionLocal() as session:
        claimed = await claim_pending(session, 5)
    assert claimed == [survey.id]
    assert (await _reload(survey.id)).ocr_status == "processing"


async def test_a_claimed_row_is_not_claimed_again(survey):
    async with SessionLocal() as session:
        await claim_pending(session, 5)
    async with SessionLocal() as session:
        assert await claim_pending(session, 5) == []


async def test_a_successful_read_writes_all_three_fields(survey):
    async with reply(GOOD) as client:
        await process_survey(survey.id, client=client)

    row = await _reload(survey.id)
    assert row.doctor_name == "Rahim Uddin"
    assert row.doctor_degrees == "MBBS, FCPS"
    assert row.doctor_specializations == "Cardiology"
    assert row.ocr_status == "done"
    assert row.ocr_completed_at is not None
    assert row.ocr_error is None


async def test_a_failure_increments_attempts_and_returns_to_pending(survey):
    async with reply("", status=500) as client:
        await process_survey(survey.id, client=client)

    row = await _reload(survey.id)
    assert row.ocr_status == "pending"
    assert row.ocr_attempts == 1
    assert "500" in row.ocr_error
    # Backoff, so the next pass does not immediately re-claim it.
    assert row.ocr_next_attempt_at > datetime.now(UTC)


async def test_it_gives_up_after_max_attempts(survey):
    from app.core.config import get_settings

    for _ in range(get_settings().ocr_max_attempts):
        async with SessionLocal() as session:
            row = await session.get(ChamberSurvey, survey.id)
            row.ocr_next_attempt_at = None
            session.add(row)
            await session.commit()
        async with reply("", status=500) as client:
            await process_survey(survey.id, client=client)

    row = await _reload(survey.id)
    assert row.ocr_status == "failed"
    assert row.ocr_attempts == get_settings().ocr_max_attempts


async def test_a_very_long_error_is_truncated(survey):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="x" * 5000)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        await process_survey(survey.id, client=client)

    assert len((await _reload(survey.id)).ocr_error) <= 1000


async def test_the_reaper_returns_a_stale_claim_to_pending(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "processing"
        row.ocr_started_at = datetime.now(UTC) - timedelta(hours=2)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await reap_stale(session) == 1
    assert (await _reload(survey.id)).ocr_status == "pending"


async def test_the_reaper_leaves_a_fresh_claim_alone(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_status = "processing"
        row.ocr_started_at = datetime.now(UTC)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await reap_stale(session) == 0
    assert (await _reload(survey.id)).ocr_status == "processing"


async def test_run_once_claims_and_processes(survey):
    async with reply(GOOD) as client:
        assert await run_once(client=client) == 1
    assert (await _reload(survey.id)).ocr_status == "done"


async def test_soft_deleted_surveys_are_never_claimed(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.deleted_at = datetime.now(UTC)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await claim_pending(session, 5) == []


async def test_backoff_hides_a_row_until_its_time(survey):
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey.id)
        row.ocr_next_attempt_at = datetime.now(UTC) + timedelta(hours=1)
        session.add(row)
        await session.commit()

    async with SessionLocal() as session:
        assert await claim_pending(session, 5) == []
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_ocr_runner.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.workers'`

- [ ] **Step 3: Create the package**

```bash
cd backend && mkdir -p app/workers && touch app/workers/__init__.py
```

- [ ] **Step 4: Implement `app/workers/ocr.py`**

```python
import asyncio
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

import httpx
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.core.config import get_settings
from app.db.session import SessionLocal, _is_sqlite
from app.models.survey import ChamberSurvey
from app.services import storage
from app.services.ocr import OcrError, extract_doctor_fields

logger = logging.getLogger(__name__)
settings = get_settings()

ERROR_MAX = 1000


async def claim_pending(session: AsyncSession, limit: int) -> list[UUID]:
    """Mark rows `processing` and commit before any network call.

    Holding a transaction open across a 60-second HTTP request would exhaust
    the connection pool and leave idle-in-transaction sessions, so the claim is
    its own short transaction.
    """
    now = datetime.now(UTC)
    query = (
        select(ChamberSurvey)
        .where(
            ChamberSurvey.ocr_status == "pending",
            ChamberSurvey.deleted_at.is_(None),
            (ChamberSurvey.ocr_next_attempt_at.is_(None))
            | (ChamberSurvey.ocr_next_attempt_at <= now),
        )
        .order_by(ChamberSurvey.created_at)
        .limit(limit)
    )
    # SKIP LOCKED is what makes two API instances two safe workers. SQLite,
    # which the test suite uses, has no such thing.
    if not _is_sqlite:
        query = query.with_for_update(skip_locked=True)

    rows = (await session.exec(query)).all()
    for row in rows:
        row.ocr_status = "processing"
        row.ocr_started_at = now
        session.add(row)
    await session.commit()
    return [row.id for row in rows]


async def _record_failure(survey_id: UUID, message: str) -> None:
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        if row is None:
            return
        row.ocr_attempts += 1
        row.ocr_error = message[:ERROR_MAX]
        row.updated_at = datetime.now(UTC)
        if row.ocr_attempts >= settings.ocr_max_attempts:
            row.ocr_status = "failed"
        else:
            row.ocr_status = "pending"
            # Exponential backoff: 1, 2, 4 minutes.
            delay = 2 ** (row.ocr_attempts - 1)
            row.ocr_next_attempt_at = datetime.now(UTC) + timedelta(minutes=delay)
        session.add(row)
        await session.commit()


async def process_survey(
    survey_id: UUID, *, client: httpx.AsyncClient | None = None
) -> None:
    """Read one nameplate and write the result. Never raises: a failure is
    data on the row, not an exception for the caller to handle."""
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        if row is None:
            return
        key = row.nameplate_key

    try:
        image, content_type = await asyncio.to_thread(storage.download_object, key)
        fields = await extract_doctor_fields(image, content_type, client=client)
    except OcrError as exc:
        logger.warning("OCR failed for %s: %s", survey_id, exc)
        await _record_failure(survey_id, str(exc))
        return
    except Exception as exc:  # noqa: BLE001 - storage or anything unforeseen
        logger.exception("OCR aborted for %s", survey_id)
        await _record_failure(survey_id, f"{type(exc).__name__}: {exc}")
        return

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, survey_id)
        if row is None:
            return
        row.doctor_name = fields.doctor_name
        row.doctor_degrees = fields.doctor_degrees
        row.doctor_specializations = fields.doctor_specializations
        row.ocr_status = "done"
        row.ocr_error = None
        row.ocr_next_attempt_at = None
        row.ocr_completed_at = datetime.now(UTC)
        row.updated_at = datetime.now(UTC)
        session.add(row)
        await session.commit()


async def reap_stale(session: AsyncSession) -> int:
    """Return claims whose process died to `pending`.

    A crash between claim and result would otherwise strand the row in
    `processing` forever.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=settings.ocr_stale_minutes)
    rows = (
        await session.exec(
            select(ChamberSurvey).where(
                ChamberSurvey.ocr_status == "processing",
                ChamberSurvey.ocr_started_at < cutoff,
            )
        )
    ).all()
    for row in rows:
        row.ocr_status = "pending"
        row.ocr_started_at = None
        session.add(row)
    await session.commit()
    return len(rows)


async def run_once(*, client: httpx.AsyncClient | None = None) -> int:
    async with SessionLocal() as session:
        await reap_stale(session)
        claimed = await claim_pending(session, settings.ocr_batch_size)
    for survey_id in claimed:
        await process_survey(survey_id, client=client)
    return len(claimed)


async def run_worker_forever() -> None:
    if not settings.openrouter_api_key:
        # Not a startup failure: OCR enriches data, it does not gate the system.
        logger.warning("OPENROUTER_API_KEY is empty; OCR worker will not run")
        return

    logger.info("OCR worker started, model=%s", settings.ocr_model)
    while True:
        try:
            processed = await run_once()
            if processed:
                logger.info("OCR processed %d survey(s)", processed)
        except asyncio.CancelledError:
            logger.info("OCR worker stopping")
            raise
        except Exception:  # noqa: BLE001 - the loop must outlive one bad pass
            logger.exception("OCR pass failed")
        await asyncio.sleep(settings.ocr_poll_seconds)


if __name__ == "__main__":
    # Detached mode: run this as its own container with OCR_MODE=off on the API.
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker_forever())
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_ocr_runner.py -q`
Expected: PASS, 11 tests

- [ ] **Step 6: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app/workers backend/tests/test_ocr_runner.py
git commit -m "feat(ocr): claim-then-work runner with backoff and a stale reaper

Claiming is its own short transaction: holding one open across a 60s HTTP call
would exhaust the connection pool."
```

---

## Task 5: Wiring the three modes

**Files:**
- Modify: `backend/app/main.py`, `backend/app/api/surveys.py`
- Test: `backend/tests/test_ocr_modes.py`

**Interfaces:**
- Consumes: `run_worker_forever`, `process_survey` (Task 4).
- Produces: the worker task on `app.state.ocr_task`; inline extraction inside `create_survey`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ocr_modes.py`:

```python
import io
import json

import httpx
import pytest

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form() -> dict:
    return {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake"), "image/jpeg")}


@pytest.fixture
def inline_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "inline")


@pytest.fixture
def off_mode(monkeypatch):
    monkeypatch.setattr(get_settings(), "ocr_mode", "off")


async def test_off_mode_leaves_the_row_pending(client, make_user, s3, off_mode):
    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201
    assert resp.json()["ocr_status"] == "pending"
    assert resp.json()["doctor_name"] is None


async def test_inline_mode_fills_the_fields_before_returning(
    client, make_user, s3, inline_mode, monkeypatch
):
    good = '{"doctor_name": "Rahim Uddin", "doctor_degrees": null, "doctor_specializations": null}'

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": good}}]})

    import app.workers.ocr as worker

    original = worker.process_survey

    async def patched(survey_id, *, client=None):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await original(survey_id, client=c)

    monkeypatch.setattr(worker, "process_survey", patched)

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    assert resp.status_code == 201
    assert resp.json()["doctor_name"] == "Rahim Uddin"
    assert resp.json()["ocr_status"] == "done"


async def test_inline_failure_never_loses_the_survey(
    client, make_user, s3, inline_mode, monkeypatch
):
    """An agent in a corridor must not lose a filed survey to a 429."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    import app.workers.ocr as worker

    original = worker.process_survey

    async def patched(survey_id, *, client=None):
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            await original(survey_id, client=c)

    monkeypatch.setattr(worker, "process_survey", patched)

    agent = await make_user()
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))

    # The submit still succeeds.
    assert resp.status_code == 201
    async with SessionLocal() as session:
        from uuid import UUID

        row = await session.get(ChamberSurvey, UUID(resp.json()["id"]))
        assert row is not None
        assert row.ocr_attempts == 1
        assert "429" in row.ocr_error
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_ocr_modes.py -q`
Expected: FAIL — inline mode does nothing, so `doctor_name` is `None`.

- [ ] **Step 3: Add the inline hook**

At the end of `create_survey` in `backend/app/api/surveys.py`, replace the
final `return`:

```python
    if settings.ocr_mode == "inline":
        # Imported here so the API does not depend on the worker package at
        # module scope, which keeps `OCR_MODE=off` genuinely inert.
        from app.workers.ocr import process_survey

        # The survey is already committed. process_survey never raises, so a
        # 429 from OpenRouter cannot cost an agent a filed survey.
        await process_survey(row.id)
        await session.refresh(row)

    return await survey_to_read(session, row)
```

- [ ] **Step 4: Start and stop the worker in the lifespan**

In `backend/app/main.py`, inside `lifespan`, after the bucket bootstrap block
and before `yield`:

```python
    ocr_task: asyncio.Task | None = None
    if settings.ocr_mode == "worker":
        from app.workers.ocr import run_worker_forever

        ocr_task = asyncio.create_task(run_worker_forever())
```

and after `yield`:

```python
    if ocr_task is not None:
        ocr_task.cancel()
        with suppress(asyncio.CancelledError):
            await ocr_task
```

Add to the imports at the top of `main.py`:

```python
import asyncio
from contextlib import asynccontextmanager, suppress
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_ocr_modes.py -q`
Expected: PASS, 3 tests

- [ ] **Step 6: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app backend/tests/test_ocr_modes.py
git commit -m "feat(ocr): OCR_MODE selects worker, inline, or off

Inline extraction runs after the survey is committed and swallows failures:
losing a filed survey to a rate limit would be far worse than a blank row."
```

---

## Task 6: Admin correction and re-read

**Files:**
- Modify: `backend/app/api/admin.py`, `backend/app/schemas/survey.py`
- Test: `backend/tests/test_ocr_admin_api.py`

**Interfaces:**
- Consumes: `AdminUser`, `survey_to_read` (existing).
- Produces: `PATCH /api/admin/surveys/{id}/doctor`, `POST /api/admin/surveys/{id}/reread`; `SurveyRead.ocr_attempts`, `SurveyRead.ocr_error`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_ocr_admin_api.py`:

```python
import io
import json
from uuid import uuid4

import pytest

from app.db.session import SessionLocal
from app.models.survey import ChamberSurvey
from app.models.user import User
from tests.conftest import auth

SLOTS = json.dumps([{"day_of_week": 5, "start_time": "17:00", "end_time": "20:00"}])
PHONES = json.dumps(["01712345678"])


def form() -> dict:
    return {
        "hospital_name": "Square Hospital",
        "city": "Dhaka",
        "district": "Dhanmondi",
        "daily_patients": "30",
        "avg_duration_min": "10",
        "consultation_fee_bdt": "1200",
        "slots": SLOTS,
        "phones": PHONES,
    }


def nameplate() -> dict:
    return {"nameplate": ("plate.jpg", io.BytesIO(b"\xff\xd8\xff-fake"), "image/jpeg")}


@pytest.fixture
async def filed(client, make_user, s3):
    agent = await make_user(name="Karim")
    resp = await client.post("/api/surveys", data=form(), files=nameplate(), headers=auth(agent))
    return resp.json()["id"]


async def test_admin_can_correct_the_doctor_fields(client, make_user, filed):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.patch(
        f"/api/admin/surveys/{filed}/doctor",
        json={
            "doctor_name": "Rahim Uddin",
            "doctor_degrees": "MBBS, FCPS (Medicine)",
            "doctor_specializations": "Cardiology",
        },
        headers=auth(admin),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["doctor_name"] == "Rahim Uddin"
    # A human correction is authoritative: the row is done, not pending.
    assert body["ocr_status"] == "done"
    assert body["ocr_error"] is None


async def test_an_agent_cannot_correct_them(client, make_user, filed):
    agent = await make_user(role="agent", name="Other")
    resp = await client.patch(
        f"/api/admin/surveys/{filed}/doctor",
        json={"doctor_name": "X", "doctor_degrees": None, "doctor_specializations": None},
        headers=auth(agent),
    )
    assert resp.status_code == 403


async def test_reread_returns_the_row_to_the_queue(client, make_user, filed):
    from uuid import UUID

    admin = await make_user(role="admin", name="Boss")
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(filed))
        row.ocr_status = "failed"
        row.ocr_attempts = 3
        row.ocr_error = "OpenRouter returned 500"
        session.add(row)
        await session.commit()

    resp = await client.post(f"/api/admin/surveys/{filed}/reread", headers=auth(admin))
    assert resp.status_code == 204

    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(filed))
        assert row.ocr_status == "pending"
        assert row.ocr_attempts == 0
        assert row.ocr_error is None
        assert row.ocr_next_attempt_at is None


async def test_an_agent_cannot_trigger_a_reread(client, make_user, filed):
    agent = await make_user(role="agent", name="Other")
    resp = await client.post(f"/api/admin/surveys/{filed}/reread", headers=auth(agent))
    assert resp.status_code == 403


async def test_correcting_an_unknown_survey_is_a_404(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.patch(
        f"/api/admin/surveys/{uuid4()}/doctor",
        json={"doctor_name": "X", "doctor_degrees": None, "doctor_specializations": None},
        headers=auth(admin),
    )
    assert resp.status_code == 404


async def test_admin_listing_exposes_attempts_and_error(client, make_user, filed):
    from uuid import UUID

    admin = await make_user(role="admin", name="Boss")
    async with SessionLocal() as session:
        row = await session.get(ChamberSurvey, UUID(filed))
        row.ocr_status = "failed"
        row.ocr_attempts = 3
        row.ocr_error = "OpenRouter returned 429"
        session.add(row)
        await session.commit()

    resp = await client.get("/api/admin/surveys", headers=auth(admin))
    (row,) = [r for r in resp.json() if r["id"] == filed]
    assert row["ocr_attempts"] == 3
    assert row["ocr_error"] == "OpenRouter returned 429"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_ocr_admin_api.py -q`
Expected: FAIL — 404 on both new routes; `ocr_attempts` missing from the listing.

- [ ] **Step 3: Extend the read schema**

In `backend/app/schemas/survey.py`, add to `class SurveyRead` after
`ocr_status`:

```python
    ocr_attempts: int = 0
    # Why the last attempt failed, so the dashboard can explain rather than
    # just report a failure.
    ocr_error: str | None = None
```

And add the request model at the end of the file:

```python
class DoctorFieldsUpdate(BaseModel):
    """An admin correcting what the model read off the nameplate."""

    doctor_name: str | None = Field(default=None, max_length=200)
    doctor_degrees: str | None = Field(default=None, max_length=1000)
    doctor_specializations: str | None = Field(default=None, max_length=1000)
```

- [ ] **Step 4: Add the endpoints**

Append to `backend/app/api/admin.py`:

```python
@router.patch("/surveys/{survey_id}/doctor", response_model=SurveyRead)
async def correct_doctor_fields(
    survey_id: UUID, payload: DoctorFieldsUpdate, session: SessionDep, _: AdminUser
) -> SurveyRead:
    """A human correction is authoritative: the row becomes `done` regardless
    of what the model made of it."""
    row = await session.get(ChamberSurvey, survey_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")

    row.doctor_name = payload.doctor_name
    row.doctor_degrees = payload.doctor_degrees
    row.doctor_specializations = payload.doctor_specializations
    row.ocr_status = "done"
    row.ocr_error = None
    row.ocr_next_attempt_at = None
    row.ocr_completed_at = datetime.now(UTC)
    row.updated_at = datetime.now(UTC)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return await survey_to_read(session, row)


@router.post("/surveys/{survey_id}/reread", status_code=status.HTTP_204_NO_CONTENT)
async def reread_nameplate(survey_id: UUID, session: SessionDep, _: AdminUser) -> None:
    """Put the survey back in the queue. Attempts reset, so a row that gave up
    after three failures gets a fresh three."""
    row = await session.get(ChamberSurvey, survey_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "survey not found")

    row.ocr_status = "pending"
    row.ocr_attempts = 0
    row.ocr_error = None
    row.ocr_started_at = None
    row.ocr_next_attempt_at = None
    row.updated_at = datetime.now(UTC)
    session.add(row)
    await session.commit()
```

Update the import in `admin.py`:

```python
from app.schemas.survey import AdminStatsRead, AgentStat, DoctorFieldsUpdate, SurveyRead
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_ocr_admin_api.py -q`
Expected: PASS, 6 tests

- [ ] **Step 6: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app backend/tests/test_ocr_admin_api.py
git commit -m "feat(ocr): admin correction and re-read endpoints

A vision model misreads confidently, so a wrong answer must be fixable rather
than permanent."
```

---

## Task 7: The admin dashboard

**Files:**
- Modify: `frontend/src/api.ts`, `frontend/src/routes/AdminPage.tsx`
- Test: `npm run build`, `npm test`, manual

**Interfaces:**
- Consumes: the two endpoints from Task 6.
- Produces: `correctDoctor(id, fields)`, `rereadNameplate(id)` in `api.ts`.

- [ ] **Step 1: Extend the API client**

In `frontend/src/api.ts`, add to the `Survey` interface after `ocr_status`:

```ts
  ocr_attempts: number;
  ocr_error: string | null;
```

Widen the status union to match the backend:

```ts
  ocr_status: "pending" | "processing" | "done" | "failed";
```

And add the two calls beside the others:

```ts
export interface DoctorFields {
  doctor_name: string | null;
  doctor_degrees: string | null;
  doctor_specializations: string | null;
}

export const correctDoctor = (id: string, fields: DoctorFields) =>
  request<Survey>(`/api/admin/surveys/${id}/doctor`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });

export const rereadNameplate = (id: string) =>
  request<void>(`/api/admin/surveys/${id}/reread`, { method: "POST" });
```

- [ ] **Step 2: Add an OCR status badge and an edit dialog to `AdminPage.tsx`**

Add to the imports:

```tsx
import { correctDoctor, rereadNameplate, type DoctorFields } from "@/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
```

Generate the one missing primitive first:

```bash
cd frontend && npx shadcn@latest add textarea --yes
```

Add state beside the existing `useState` calls:

```tsx
  const [editingDoctor, setEditingDoctor] = useState<Survey | null>(null);
  const [doctorDraft, setDoctorDraft] = useState<DoctorFields>({
    doctor_name: "",
    doctor_degrees: "",
    doctor_specializations: "",
  });
```

Add this helper above the `return`, so both the table and the card render the
same thing:

```tsx
  function ocrLabel(s: Survey) {
    if (s.doctor_name) return s.doctor_name;
    if (s.ocr_status === "failed") return "Could not read nameplate";
    if (s.ocr_status === "processing") return "Reading nameplate…";
    return "— nameplate pending";
  }

  function openDoctorEditor(s: Survey) {
    setDoctorDraft({
      doctor_name: s.doctor_name ?? "",
      doctor_degrees: s.doctor_degrees ?? "",
      doctor_specializations: s.doctor_specializations ?? "",
    });
    setEditingDoctor(s);
  }

  async function saveDoctor() {
    if (!editingDoctor) return;
    try {
      // Blank means "the nameplate does not show this", which is null, not "".
      await correctDoctor(editingDoctor.id, {
        doctor_name: doctorDraft.doctor_name?.trim() || null,
        doctor_degrees: doctorDraft.doctor_degrees?.trim() || null,
        doctor_specializations: doctorDraft.doctor_specializations?.trim() || null,
      });
      toast.success("Doctor details updated.");
      setEditingDoctor(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function reread(s: Survey) {
    try {
      await rereadNameplate(s.id);
      toast.success("Queued for another read.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }
```

In the desktop table's Doctor cell, replace the existing content with:

```tsx
                      <TableCell>
                        <button
                          className="text-left underline-offset-4 hover:underline"
                          onClick={() => openDoctorEditor(s)}
                        >
                          {s.doctor_name ? (
                            ocrLabel(s)
                          ) : (
                            <span className="text-muted-foreground">{ocrLabel(s)}</span>
                          )}
                        </button>
                        {s.ocr_status === "failed" && s.ocr_error && (
                          <p className="mt-1 text-xs text-destructive">{s.ocr_error}</p>
                        )}
                        {s.ocr_status !== "done" && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() => void reread(s)}
                          >
                            Re-read
                          </Button>
                        )}
                      </TableCell>
```

In the mobile card, replace the doctor `<span>` with:

```tsx
                        <button
                          className="text-left font-medium underline-offset-4 hover:underline"
                          onClick={() => openDoctorEditor(s)}
                        >
                          {ocrLabel(s)}
                        </button>
```

And add the dialog beside the existing ones, before the closing `</main>`:

```tsx
      <Dialog
        open={editingDoctor !== null}
        onOpenChange={(open) => !open && setEditingDoctor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Doctor details</DialogTitle>
          </DialogHeader>
          {editingDoctor?.nameplate_url && (
            <a href={editingDoctor.nameplate_url} target="_blank" rel="noreferrer">
              <img
                src={editingDoctor.nameplate_url}
                alt="Nameplate"
                className="max-h-48 w-full rounded-md border object-contain"
              />
            </a>
          )}
          <div className="space-y-3">
            <div>
              <Label htmlFor="doctor-name">Name</Label>
              <Input
                id="doctor-name"
                value={doctorDraft.doctor_name ?? ""}
                onChange={(e) =>
                  setDoctorDraft({ ...doctorDraft, doctor_name: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="doctor-degrees">Degrees</Label>
              <Textarea
                id="doctor-degrees"
                rows={2}
                value={doctorDraft.doctor_degrees ?? ""}
                onChange={(e) =>
                  setDoctorDraft({ ...doctorDraft, doctor_degrees: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="doctor-spec">Specializations</Label>
              <Textarea
                id="doctor-spec"
                rows={2}
                value={doctorDraft.doctor_specializations ?? ""}
                onChange={(e) =>
                  setDoctorDraft({
                    ...doctorDraft,
                    doctor_specializations: e.target.value,
                  })
                }
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void saveDoctor()}>Save</Button>
              <Button
                variant="outline"
                onClick={() => editingDoctor && void reread(editingDoctor)}
              >
                Re-read nameplate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
```

Add `Label` to the imports if it is not already there:

```tsx
import { Label } from "@/components/ui/label";
```

- [ ] **Step 3: Verify**

```bash
cd frontend && npm test && npm run build
```

Expected: 22 vitest tests still pass; build clean.

Manual, as the admin:

1. A survey with no doctor name shows "— nameplate pending" in muted text.
2. Click it. Expected: a dialog with the nameplate image and three fields.
3. Type a name, save. Expected: success toast, the row now shows the name, and
   the Re-read link disappears (status is `done`).
4. Click Re-read on another row. Expected: "Queued for another read." and the
   row returns to pending.
5. At 375px the mobile card's doctor line opens the same dialog.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(ocr): admin can correct doctor details and re-read a nameplate"
```

---

## Task 8: Configuration, the detached-worker recipe, and docs

**Files:**
- Modify: `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`, `README.md`
- Test: a full stack run

- [ ] **Step 1: Add the settings to `.env.example`**

After the authentication block:

```bash
# ---- Nameplate OCR ----
# Where extraction runs: worker (background poll), inline (during submit),
# or off. Changing this is how the work moves - no code change.
OCR_MODE=worker

# Empty disables extraction without preventing boot: OCR enriches data, it
# does not gate the system. Get a key at https://openrouter.ai/keys
OPENROUTER_API_KEY=

# Swappable without a deploy. gemma-4-26b-a4b-it is the cheaper MoE variant;
# which reads a Bangla-English nameplate better is an empirical question.
OCR_MODEL=google/gemma-4-31b-it

OCR_POLL_SECONDS=10
OCR_BATCH_SIZE=5
OCR_MAX_ATTEMPTS=3
OCR_TIMEOUT_SECONDS=60
OCR_STALE_MINUTES=15
```

- [ ] **Step 2: Pass them through in both compose files**

In `docker-compose.yml`, in the backend service's `environment:` block:

```yaml
      OCR_MODE: ${OCR_MODE:-worker}
      OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
      OCR_MODEL: ${OCR_MODEL:-google/gemma-4-31b-it}
```

In `docker-compose.prod.yml`, the same three lines.

- [ ] **Step 3: Add the detached-worker recipe as a comment**

At the end of `docker-compose.prod.yml`, above `volumes:`:

```yaml
  # Detached OCR worker. To use it, set OCR_MODE=off on the backend above and
  # uncomment this service: extraction then runs in its own container, scaled
  # and restarted independently of the API. No code changes - app/workers/ocr.py
  # already has no HTTP dependency.
  #
  # ocr-worker:
  #   build:
  #     context: ./backend
  #   restart: unless-stopped
  #   environment:
  #     DATABASE_URL: ${DATABASE_URL}
  #     S3_ENDPOINT_URL: ${S3_ENDPOINT_URL}
  #     S3_ACCESS_KEY: ${RUSTFS_ACCESS_KEY}
  #     S3_SECRET_KEY: ${SERVICE_PASSWORD_RUSTFS}
  #     S3_BUCKET: ${S3_BUCKET:-uploads}
  #     JWT_SECRET: ${JWT_SECRET}
  #     ADMIN_PASSWORD: ${ADMIN_PASSWORD}
  #     OPENROUTER_API_KEY: ${OPENROUTER_API_KEY}
  #     OCR_MODEL: ${OCR_MODEL:-google/gemma-4-31b-it}
  #   command: ["python", "-m", "app.workers.ocr"]
  #   depends_on:
  #     - postgres
```

- [ ] **Step 4: Document it in the README**

Add a section after "## Roles":

```markdown
## Nameplate OCR

The nameplate photograph is the only source of doctor identity — agents type
nothing about the doctor. A vision model on OpenRouter reads it into
`doctor_name`, `doctor_degrees` and `doctor_specializations`.

`OCR_MODE` decides where that happens:

| Mode | Behaviour |
| --- | --- |
| `worker` (default) | A poll loop in the API claims `pending` rows and extracts |
| `inline` | Extraction runs during `POST /api/surveys`, before it returns |
| `off` | Nothing runs; rows stay `pending` |

Moving to a **detached worker** needs no code change: set `OCR_MODE=off` on the
API and run a second container with `python -m app.workers.ocr`. There is a
commented service in `docker-compose.prod.yml` for it. This works because
`app/services/ocr.py` knows only OpenRouter — no database, no FastAPI — and
`app/workers/ocr.py` knows only the database and the clock.

**Failures are data, not exceptions.** A failed read increments `ocr_attempts`,
records `ocr_error`, and backs off (1, 2, 4 minutes) until `OCR_MAX_ATTEMPTS`,
then the row is `failed`. In `inline` mode the survey is committed *before*
extraction runs, so an OpenRouter outage can never cost an agent a filed
survey.

A claimed row is marked `processing`; if that process dies, a reaper returns it
to `pending` after `OCR_STALE_MINUTES`. Claims use `SKIP LOCKED`, so running
several backend instances gives several safe workers.

**The model misreads, confidently.** An admin can correct all three fields from
the dashboard and re-queue any survey with the **Re-read** button. The
nameplate image sits beside the fields as the thing to check against.

Without `OPENROUTER_API_KEY` the worker logs once and stays idle. Unlike
`JWT_SECRET`, a missing key is not a startup failure — surveys still get
collected.
```

Add to the Configuration table:

```markdown
| `OCR_MODE`               | `worker`                         | `worker` \| `inline` \| `off`    |
| `OPENROUTER_API_KEY`     | *(empty — OCR idle)*             | OpenRouter credential            |
| `OCR_MODEL`              | `google/gemma-4-31b-it`          | Vision model for nameplates      |
```

Replace the OCR bullet under "## Known gaps":

```markdown
- **No cost cap or rate limiting against OpenRouter.** Extraction is roughly
  1,000 input tokens per nameplate, so ten thousand surveys costs on the order
  of ten cents — but nothing stops a runaway loop.
- **A re-read overwrites.** There is no history of what the model previously
  said, so a correction cannot be compared against the earlier attempt.
- **`doctor_specializations` is still free text.** Structuring it was deferred
  until real extracted values existed; they now will, so the decision is
  finally answerable.
```

- [ ] **Step 5: Verify the whole system**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
cd frontend && npm test && npm run build && cd ..
docker compose up -d --build -V
sleep 25
curl -fsS http://localhost:8000/api/readyz
# With no key configured, the worker must log once and not crash the app.
docker compose logs backend 2>&1 | grep -i "OPENROUTER_API_KEY is empty"
```

Expected: all suites green, `readyz` ready, and exactly the "will not run"
warning rather than a traceback.

- [ ] **Step 6: If you have a key, verify one real extraction**

This is the only step that touches the network, and it is deliberately manual.

```bash
echo "OPENROUTER_API_KEY=sk-or-..." >> .env
docker compose up -d backend
# File a survey with a real nameplate photograph through the UI, then:
docker compose exec -T postgres psql -U app -d app -c \
  "SELECT ocr_status, ocr_attempts, doctor_name, doctor_degrees FROM chamber_surveys ORDER BY created_at DESC LIMIT 1;"
```

Expected: within `OCR_POLL_SECONDS`, `ocr_status='done'` and a plausible name.
If the degrees look wrong, try `OCR_MODEL=google/gemma-4-26b-a4b-it` and file
the same photograph again — that comparison is exactly why the model is an
environment variable.

- [ ] **Step 7: Commit**

```bash
git add .env.example docker-compose.yml docker-compose.prod.yml README.md
git commit -m "docs: nameplate OCR, the three modes, and the detached worker recipe"
```

---

## Self-Review Notes

Checked against the spec:

- Every spec section maps to a task: settings and the storage helper → 1;
  the OpenRouter call, prompt, and tolerant parsing → 2; columns and migration
  → 3; claim-then-work, backoff, and the reaper → 4; the three modes and the
  inline-never-fails rule → 5; admin correction and re-read → 6; dashboard →
  7; configuration, the detached recipe, and docs → 8.
- Each spec test bullet appears as a named test, including the two added during
  the spec's own review: `test_inline_failure_never_loses_the_survey` and
  `test_a_very_long_error_is_truncated`.
- **Deviation, deliberate:** the spec's schema has no column for backoff, but
  it requires exponential backoff. Task 3 adds `ocr_next_attempt_at` and says
  why; without it a failed row is re-claimed on the very next poll pass.
- **Deviation, cosmetic:** the spec sketched `app/workers/ocr_runner.py`; the
  plan uses `app/workers/ocr.py` so `python -m app.workers.ocr` is the entry
  point without a second file that only imports the first.
- **Caught during review:** `httpx` is a dev-only dependency today. The worker
  needs it in the production image, where dev groups are not installed —
  Task 1 Step 1 promotes it.
- **Caught during review:** SQLite has no `FOR UPDATE SKIP LOCKED`, and the
  test suite runs on SQLite. `claim_pending` branches on the existing
  `_is_sqlite` flag; the constraint is noted before Task 1 because two tasks
  depend on it.
- **Caught during review:** Alembic does not diff named CHECK constraints, so
  autogenerate will silently miss `'processing'`. Task 3 Step 4 adds the drop
  and recreate by hand.
- Names are consistent across tasks: `extract_doctor_fields`/`OcrError`/
  `DoctorFields` (Task 2, used 4 and 5), `download_object` (1, used 4),
  `process_survey`/`claim_pending`/`reap_stale`/`run_once` (4, used 5),
  `DoctorFieldsUpdate` (6), `correctDoctor`/`rereadNameplate` (7).
