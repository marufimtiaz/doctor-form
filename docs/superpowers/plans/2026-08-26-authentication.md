# Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `X-User-Id` identity stub with phone + password login issuing HS256 JWTs.

**Architecture:** `get_current_user` keeps its signature and stays the only seam — it now reads a Bearer token instead of a trusted header. Revocation comes free from the user row it already loads: `is_active` is checked per request, and a `token_version` claim invalidates tokens when a password changes. No sessions table, no refresh tokens.

**Tech Stack:** `argon2-cffi` (argon2id hashing), `PyJWT` (HS256), FastAPI, SQLModel, Alembic, React 19 + react-router-dom.

**Spec:** `docs/superpowers/specs/2026-08-26-authentication-design.md`

## Global Constraints

- Ruff `line-length = 100`, `select = ["E", "F", "I", "UP", "B"]`. Run `uv run ruff check .` before every commit.
- `pytest` must pass with **no docker compose stack running** — SQLite plus the local moto server, as today.
- Password rules: **minimum 8 characters, maximum 128**. No composition rules.
- Login returns **one identical 401** for unknown phone, wrong password, and deactivated user. Never reveal which.
- `password_hash`, `password_set_at`, and `token_version` are **never serialised** in any response.
- `token_version` is bumped by exactly two operations: self change-password, and admin reset-password.
- Token claims are exactly `sub` (str UUID), `ver` (int), `iat`, `exp`.
- The app must **refuse to boot** when `debug` is false and `jwt_secret` or `admin_password` is still its development default.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/core/security.py` | **New.** Every cryptographic primitive: hashing and token encode/decode. Nothing else in the codebase touches argon2 or PyJWT. |
| `app/core/config.py` | Modify: five settings plus the insecure-default guard. |
| `app/core/deps.py` | Modify: `get_current_user` reads `Authorization: Bearer`. |
| `app/models/user.py` | Modify: three columns. |
| `app/schemas/auth.py` | **New.** `LoginRequest`, `TokenResponse`, `ChangePasswordRequest`, `SetPasswordRequest`. |
| `app/api/auth.py` | **New.** `/login`, `/me`, `/change-password`. |
| `app/api/users.py` | Modify: password on create, reset endpoint, list becomes admin-only. |
| `app/db/session.py` | Modify: seeds hash their passwords. |
| `alembic/versions/0002_auth.py` | **New.** |
| `frontend/src/api.ts` | Modify: Bearer header, central 401 handling. |
| `frontend/src/auth.tsx` | Modify: `AuthProvider` replaces the picker. |
| `frontend/src/routes/LoginPage.tsx` | **New.** |
| `frontend/src/components/PasswordForm.tsx` | **New.** Shared by the agent's own change and the admin's reset. |

---

## Task 1: Security primitives and settings guards

**Files:**
- Create: `backend/app/core/security.py`
- Modify: `backend/app/core/config.py`, `backend/pyproject.toml`, `backend/tests/conftest.py`
- Test: `backend/tests/test_security.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `hash_password(raw: str) -> str`
  - `verify_password(raw: str, hashed: str) -> bool`
  - `create_access_token(user_id: UUID, token_version: int) -> str`
  - `decode_access_token(token: str) -> dict` — raises `ValueError` when invalid
  - `DUMMY_HASH: str` — verified against when a phone is unknown, to equalise timing
  - Settings: `jwt_secret`, `jwt_algorithm`, `access_token_ttl_days`, `admin_password`, `demo_password`
  - Constants `DEV_JWT_SECRET`, `DEV_ADMIN_PASSWORD` for the guard test

- [ ] **Step 1: Add dependencies**

```bash
cd backend && uv add argon2-cffi pyjwt
```

- [ ] **Step 2: Let the test suite past the startup guard**

The guard refuses insecure defaults whenever `debug` is false, and the test
suite does not set `DEBUG`. Add to `backend/tests/conftest.py`, with the other
`os.environ` lines at the top, **before any app import**:

```python
os.environ.setdefault("JWT_SECRET", "test-secret-not-the-dev-default")
os.environ.setdefault("ADMIN_PASSWORD", "test-admin-password")
```

- [ ] **Step 3: Write the failing tests**

Create `backend/tests/test_security.py`:

```python
import time
from uuid import uuid4

import jwt
import pytest

from app.core.config import DEV_ADMIN_PASSWORD, DEV_JWT_SECRET, Settings, get_settings
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hashing_is_argon2id_and_salted():
    first = hash_password("correct horse battery staple")
    second = hash_password("correct horse battery staple")
    assert first.startswith("$argon2id$")
    # Distinct salts, so the same password never produces the same hash.
    assert first != second


def test_verify_accepts_the_right_password():
    assert verify_password("s3cret-password", hash_password("s3cret-password"))


def test_verify_rejects_the_wrong_password():
    assert not verify_password("wrong-password", hash_password("s3cret-password"))


def test_verify_rejects_a_corrupt_hash_without_raising():
    # A NULL or truncated column must not crash the login route.
    assert not verify_password("anything", "not-a-hash")


def test_dummy_hash_is_usable_for_timing_equalisation():
    assert DUMMY_HASH.startswith("$argon2id$")
    assert not verify_password("anything at all", DUMMY_HASH)


def test_token_round_trips_the_user_and_version():
    user_id = uuid4()
    payload = decode_access_token(create_access_token(user_id, 7))
    assert payload["sub"] == str(user_id)
    assert payload["ver"] == 7
    assert payload["exp"] > payload["iat"]


def test_token_signed_with_another_secret_is_rejected():
    forged = jwt.encode(
        {"sub": str(uuid4()), "ver": 1, "exp": int(time.time()) + 600},
        "an-attackers-secret",
        algorithm="HS256",
    )
    with pytest.raises(ValueError):
        decode_access_token(forged)


def test_expired_token_is_rejected():
    settings = get_settings()
    now = int(time.time())
    expired = jwt.encode(
        {"sub": str(uuid4()), "ver": 1, "iat": now - 7200, "exp": now - 3600},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    with pytest.raises(ValueError):
        decode_access_token(expired)


def test_garbage_token_is_rejected():
    with pytest.raises(ValueError):
        decode_access_token("not.a.token")


def test_production_refuses_the_default_jwt_secret():
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(debug=False, jwt_secret=DEV_JWT_SECRET, admin_password="fine-password")


def test_production_refuses_the_default_admin_password():
    with pytest.raises(ValueError, match="ADMIN_PASSWORD"):
        Settings(debug=False, jwt_secret="a-real-secret", admin_password=DEV_ADMIN_PASSWORD)


def test_development_tolerates_the_defaults():
    # Local work must not require secret management.
    settings = Settings(debug=True, jwt_secret=DEV_JWT_SECRET, admin_password=DEV_ADMIN_PASSWORD)
    assert settings.jwt_secret == DEV_JWT_SECRET
```

- [ ] **Step 4: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_security.py -q`
Expected: FAIL — `ImportError: cannot import name 'DEV_JWT_SECRET'`

- [ ] **Step 5: Add the settings and the guard**

In `backend/app/core/config.py`, add above `class Settings`:

```python
# Sentinel values. The app refuses to boot with these when debug is off, so a
# forgotten secret fails loudly at deploy time instead of silently shipping a
# signing key that anyone reading this repository knows.
DEV_JWT_SECRET = "dev-only-insecure-change-me"
DEV_ADMIN_PASSWORD = "dev-only-admin-password"
```

Inside `class Settings`, after `seed_demo_data`:

```python
    # Signing key for access tokens. A known default would let anyone forge an
    # admin token, so production must override it.
    jwt_secret: str = DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    # One long-lived token; there is no refresh token. Revocation comes from
    # is_active and token_version, both checked on every request.
    access_token_ttl_days: int = 30

    # Password for the seeded first admin. Without it the admin would have no
    # hash, nobody could log in, and nobody could create a user who could.
    admin_password: str = DEV_ADMIN_PASSWORD
    # Only read when seed_demo_data is true, which production pins off.
    demo_password: str = "demo-password"
```

Add the validator as the last method of `Settings`:

```python
    @model_validator(mode="after")
    def _refuse_insecure_defaults(self) -> "Settings":
        if self.debug:
            return self
        if self.jwt_secret == DEV_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET is still the development default. Set it, or anyone "
                "who has read this repository can forge an admin token."
            )
        if self.admin_password == DEV_ADMIN_PASSWORD:
            raise ValueError(
                "ADMIN_PASSWORD is still the development default. Set it before "
                "the first boot seeds the admin account."
            )
        return self
```

Add the import at the top of the file:

```python
from pydantic import model_validator
```

- [ ] **Step 6: Implement `app/core/security.py`**

```python
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import get_settings

settings = get_settings()
_hasher = PasswordHasher()

# Verified against when a phone is not registered, so that a missing account
# and a wrong password take comparable time. Without it, response latency tells
# an attacker which phone numbers exist.
DUMMY_HASH = _hasher.hash("timing-equalisation-only-never-a-real-password")


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    """False rather than raising, so a NULL or corrupt column cannot 500 the
    login route."""
    try:
        _hasher.verify(hashed, raw)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    return True


def create_access_token(user_id: UUID, token_version: int) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        # Compared against the user row on every request; bumping the row's
        # value invalidates every token issued before the bump.
        "ver": token_version,
        "iat": now,
        "exp": now + timedelta(days=settings.access_token_ttl_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises ValueError for every invalid case - bad signature, expiry,
    malformed input - so callers handle one exception type."""
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise ValueError(f"invalid token: {exc}") from exc
```

- [ ] **Step 7: Run to verify passing**

Run: `cd backend && uv run pytest tests/test_security.py -q`
Expected: PASS, 12 tests

- [ ] **Step 8: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app/core backend/tests backend/pyproject.toml backend/uv.lock
git commit -m "feat(security): argon2 hashing, JWT issuing, insecure-default guards"
```

---

## Task 2: User credential columns

**Files:**
- Modify: `backend/app/models/user.py`
- Create: `backend/alembic/versions/0002_auth.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `User.password_hash: str | None`, `User.password_set_at: datetime | None`, `User.token_version: int` (default 1).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_models.py`:

```python
async def test_new_users_have_no_password_and_version_one(session: AsyncSession):
    user = await _agent(session)
    # NULL hash means "cannot log in until an admin sets one" - existing rows
    # are deliberately not grandfathered into a usable state.
    assert user.password_hash is None
    assert user.password_set_at is None
    assert user.token_version == 1
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_models.py -k password -q`
Expected: FAIL — `AttributeError: 'User' object has no attribute 'password_hash'`

- [ ] **Step 3: Add the columns**

In `backend/app/models/user.py`, after `is_active`:

```python
    # NULL means the account cannot log in yet - an admin must set a password.
    password_hash: str | None = Field(default=None, max_length=255)
    password_set_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
    )
    # Carried in every token as "ver". Bumping it invalidates tokens issued
    # earlier, which is how a password change logs other devices out.
    token_version: int = Field(default=1)
```

- [ ] **Step 4: Generate the migration**

```bash
cd backend && DATABASE_URL="sqlite:///./_autogen.db" \
  uv run alembic revision --autogenerate -m "auth columns"
mv alembic/versions/*_auth_columns.py alembic/versions/0002_auth.py
rm -f _autogen.db
```

Open `alembic/versions/0002_auth.py` and set `revision = "0002"` and
`down_revision = "0001"`. Confirm it adds exactly the three columns and creates
no tables.

- [ ] **Step 5: Run the model and migration tests**

Run: `cd backend && uv run pytest tests/test_models.py tests/test_migrations.py -q`
Expected: PASS. `test_migrated_schema_matches_the_models` proves the migration
and the model agree; if it reports a diff, fix the revision rather than the test.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && uv run ruff check . && cd ..
git add backend/app/models/user.py backend/alembic/versions/0002_auth.py backend/tests/test_models.py
git commit -m "feat(models): password hash, set-at, and token version on users"
```

---

## Task 3: The seam moves to Bearer tokens

**Files:**
- Modify: `backend/app/core/deps.py`, `backend/tests/conftest.py`
- Test: `backend/tests/test_deps.py`

**Interfaces:**
- Consumes: `create_access_token`, `decode_access_token` (Task 1); `User.token_version` (Task 2).
- Produces: `get_current_user` reading `Authorization: Bearer`; `tests.conftest.auth(user)` returning `{"Authorization": "Bearer <token>"}`.

**This is the swap.** `auth()` is the only place tests build identity headers,
and it is used by `test_users_api.py`, `test_surveys_api.py`, and
`test_admin_api.py`. Changing it here means those three files keep passing
untouched — which is the evidence that the seam held.

- [ ] **Step 1: Rewrite the tests**

Replace `backend/tests/test_deps.py` entirely:

```python
import time
from uuid import uuid4

import httpx
import jwt
from fastapi import FastAPI

from app.core.config import get_settings
from app.core.deps import AdminUser, CurrentUser
from app.core.security import create_access_token
from app.db.session import SessionLocal
from app.models.user import User
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


def _probe_client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=_probe_app())
    return httpx.AsyncClient(transport=transport, base_url="http://probe")


async def test_missing_header_is_unauthorized():
    async with _probe_client() as c:
        assert (await c.get("/whoami")).status_code == 401


async def test_header_without_the_bearer_scheme_is_unauthorized(make_user):
    user = await make_user()
    token = create_access_token(user.id, user.token_version)
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": token})
    assert resp.status_code == 401


async def test_garbage_token_is_unauthorized():
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": "Bearer nonsense"})
    assert resp.status_code == 401


async def test_token_for_an_unknown_user_is_unauthorized():
    async with _probe_client() as c:
        resp = await c.get(
            "/whoami", headers={"Authorization": f"Bearer {create_access_token(uuid4(), 1)}"}
        )
    assert resp.status_code == 401


async def test_token_signed_with_another_secret_is_unauthorized(make_user):
    user = await make_user()
    forged = jwt.encode(
        {"sub": str(user.id), "ver": 1, "exp": int(time.time()) + 600},
        "an-attackers-secret",
        algorithm="HS256",
    )
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": f"Bearer {forged}"})
    assert resp.status_code == 401


async def test_expired_token_is_unauthorized(make_user):
    user = await make_user()
    settings = get_settings()
    now = int(time.time())
    expired = jwt.encode(
        {"sub": str(user.id), "ver": user.token_version, "iat": now - 7200, "exp": now - 3600},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers={"Authorization": f"Bearer {expired}"})
    assert resp.status_code == 401


async def test_valid_token_resolves_the_user(make_user):
    user = await make_user(name="Karim")
    async with _probe_client() as c:
        resp = await c.get("/whoami", headers=auth(user))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Karim", "role": "agent"}


async def test_deactivation_rejects_an_already_issued_token(make_user):
    """The JWT is unchanged, but the user row is loaded every request anyway."""
    user = await make_user()
    headers = auth(user)
    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 200

    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.is_active = False
        session.add(row)
        await session.commit()

    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 401


async def test_bumping_token_version_rejects_older_tokens(make_user):
    """This is what makes a password change log other devices out."""
    user = await make_user()
    headers = auth(user)
    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 200

    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.token_version += 1
        session.add(row)
        await session.commit()

    async with _probe_client() as c:
        assert (await c.get("/whoami", headers=headers)).status_code == 401


async def test_agent_is_forbidden_from_admin_dependency(make_user):
    user = await make_user(role="agent")
    async with _probe_client() as c:
        resp = await c.get("/admin-only", headers=auth(user))
    assert resp.status_code == 403


async def test_admin_passes_admin_dependency(make_user):
    user = await make_user(role="admin", name="Boss")
    async with _probe_client() as c:
        resp = await c.get("/admin-only", headers=auth(user))
    assert resp.status_code == 200
    assert resp.json() == {"name": "Boss"}
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_deps.py -q`
Expected: FAIL — the old `X-User-Id` implementation ignores `Authorization`, so
every authenticated case returns 401.

- [ ] **Step 3: Rewrite `get_current_user`**

Replace the function in `backend/app/core/deps.py`:

```python
async def get_current_user(
    session: SessionDep,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """Resolve the caller from a signed Bearer token.

    Every rejection is a 401 with the same generic message: distinguishing
    "no such user" from "wrong version" would leak account state.

    Revocation lives here rather than in a sessions table. The user row has to
    be loaded anyway for role and is_active, so both checks are free:
    deactivating a user or bumping their token_version invalidates tokens
    already issued, without any server-side session storage.
    """
    if not authorization:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication required")

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "authentication required")

    try:
        payload = decode_access_token(token.strip())
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token") from None

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    if user.token_version != payload.get("ver"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid or expired token")
    return user
```

Update the imports at the top of `deps.py`:

```python
from app.core.security import decode_access_token
```

- [ ] **Step 4: Update the shared test helper**

In `backend/tests/conftest.py`, replace `auth`:

```python
def auth(user: User) -> dict[str, str]:
    """Headers that authenticate `user`.

    The single place tests build credentials, which is why swapping the whole
    identity mechanism leaves the other test modules untouched.
    """
    token = create_access_token(user.id, user.token_version)
    return {"Authorization": f"Bearer {token}"}
```

Add the import beside the other app imports:

```python
from app.core.security import create_access_token  # noqa: E402
```

- [ ] **Step 5: Run the whole suite**

Run: `cd backend && uv run pytest -q`
Expected: PASS. `test_users_api.py`, `test_surveys_api.py`, and
`test_admin_api.py` must pass **without being edited** — that is the point of
the seam. If any of them needed changing, `auth()` was not the only place
identity was constructed, and that is worth investigating before continuing.

- [ ] **Step 6: Lint and commit**

```bash
cd backend && uv run ruff check . && cd ..
git add backend/app/core/deps.py backend/tests
git commit -m "feat(auth): resolve identity from a signed Bearer token

is_active and token_version are checked against the user row the dependency
already loads, so revocation works without a sessions table."
```

---

## Task 4: The auth router

**Files:**
- Create: `backend/app/schemas/auth.py`, `backend/app/api/auth.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_auth_api.py`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`; schemas `LoginRequest`, `TokenResponse`, `ChangePasswordRequest`, `SetPasswordRequest`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_auth_api.py`:

```python
import pytest

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.user import User
from tests.conftest import auth

PASSWORD = "correct-horse-battery"


@pytest.fixture
async def with_password(make_user):
    """A user who can actually log in."""

    async def _make(role: str = "agent", name: str = "Karim", password: str = PASSWORD) -> User:
        user = await make_user(role=role, name=name)
        async with SessionLocal() as session:
            row = await session.get(User, user.id)
            row.password_hash = hash_password(password)
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return row

    return _make


async def test_login_returns_a_usable_token(client, with_password):
    user = await with_password()
    resp = await client.post(
        "/api/auth/login", json={"phone": user.phone, "password": PASSWORD}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["token_type"] == "bearer"
    assert body["user"]["name"] == "Karim"
    # Credentials never travel in a response body.
    assert "password_hash" not in body["user"]
    assert "token_version" not in body["user"]

    me = await client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    assert me.status_code == 200
    assert me.json()["id"] == str(user.id)


async def test_login_accepts_a_locally_formatted_phone(client, with_password):
    """The stored phone is E.164; agents type the local form."""
    user = await with_password()
    assert user.phone.startswith("+880")
    local = "0" + user.phone[4:]
    resp = await client.post("/api/auth/login", json={"phone": local, "password": PASSWORD})
    assert resp.status_code == 200


async def test_wrong_password_and_unknown_phone_are_indistinguishable(client, with_password):
    await with_password()
    wrong = await client.post(
        "/api/auth/login", json={"phone": "01712345678", "password": "not-the-password"}
    )
    unknown = await client.post(
        "/api/auth/login", json={"phone": "01999999999", "password": "not-the-password"}
    )
    assert wrong.status_code == unknown.status_code == 401
    # Identical bodies: differing ones turn the form into an account oracle.
    assert wrong.json() == unknown.json()


async def test_unparseable_phone_is_also_just_a_401(client):
    resp = await client.post("/api/auth/login", json={"phone": "hello", "password": "whatever"})
    assert resp.status_code == 401


async def test_a_user_without_a_password_cannot_log_in(client, make_user):
    user = await make_user()
    assert user.password_hash is None
    resp = await client.post(
        "/api/auth/login", json={"phone": user.phone, "password": "anything"}
    )
    assert resp.status_code == 401


async def test_a_deactivated_user_cannot_log_in(client, with_password):
    user = await with_password()
    async with SessionLocal() as session:
        row = await session.get(User, user.id)
        row.is_active = False
        session.add(row)
        await session.commit()

    resp = await client.post(
        "/api/auth/login", json={"phone": user.phone, "password": PASSWORD}
    )
    assert resp.status_code == 401


async def test_me_requires_a_token(client):
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_changing_a_password_invalidates_old_tokens_but_returns_a_new_one(
    client, with_password
):
    user = await with_password()
    old = auth(user)

    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "a-brand-new-password"},
        headers=old,
    )
    assert resp.status_code == 200
    fresh = {"Authorization": f"Bearer {resp.json()['access_token']}"}

    # The caller is not logged out by their own change.
    assert (await client.get("/api/auth/me", headers=fresh)).status_code == 200
    # Every other device is.
    assert (await client.get("/api/auth/me", headers=old)).status_code == 401

    # And the new password is the one that works now.
    assert (
        await client.post(
            "/api/auth/login", json={"phone": user.phone, "password": "a-brand-new-password"}
        )
    ).status_code == 200
    assert (
        await client.post("/api/auth/login", json={"phone": user.phone, "password": PASSWORD})
    ).status_code == 401


async def test_changing_with_the_wrong_current_password_is_rejected(client, with_password):
    user = await with_password()
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": "not-it", "new_password": "a-brand-new-password"},
        headers=auth(user),
    )
    assert resp.status_code == 401
    # The old password still works, so nothing was changed.
    assert (
        await client.post("/api/auth/login", json={"phone": user.phone, "password": PASSWORD})
    ).status_code == 200


async def test_a_short_new_password_is_rejected(client, with_password):
    user = await with_password()
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "short"},
        headers=auth(user),
    )
    assert resp.status_code == 422


async def test_an_absurdly_long_password_is_rejected(client, with_password):
    user = await with_password()
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": PASSWORD, "new_password": "x" * 200},
        headers=auth(user),
    )
    assert resp.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_auth_api.py -q`
Expected: FAIL — 404 on every `/api/auth/*` route.

- [ ] **Step 3: Create `app/schemas/auth.py`**

```python
from pydantic import BaseModel, Field

from app.schemas.user import UserPublic

# Length is what makes a password strong. Composition rules mostly push people
# toward predictable substitutions. The upper bound exists because argon2 will
# happily burn CPU on a megabyte of input.
PASSWORD_MIN = 8
PASSWORD_MAX = 128
Password = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class LoginRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    # Deliberately unconstrained: rejecting a short password at login would
    # tell an attacker their guess was not even the right shape.
    password: str = Field(min_length=1, max_length=1024)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Password


class SetPasswordRequest(BaseModel):
    """Admin setting somebody else's password; no current password needed."""

    password: str = Password
```

- [ ] **Step 4: Create `app/api/auth.py`**

```python
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlmodel import select

from app.core.deps import CurrentUser
from app.core.phone import normalize_phone
from app.core.security import (
    DUMMY_HASH,
    create_access_token,
    hash_password,
    verify_password,
)
from app.db.session import SessionDep
from app.models.user import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse
from app.schemas.user import UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])

# One message for every failure. Distinguishing "no such phone" from "wrong
# password" turns the login form into a way to discover who is registered.
INVALID_CREDENTIALS = "Phone or password is incorrect"


def _issue(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id, user.token_version),
        user=UserPublic.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, session: SessionDep) -> TokenResponse:
    try:
        phone = normalize_phone(payload.phone)
    except ValueError:
        # An unparseable phone is just a failed login, not a 422: a different
        # status would reveal which inputs correspond to real accounts.
        verify_password(payload.password, DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS) from None

    result = await session.exec(select(User).where(User.phone == phone))
    user = result.first()

    if user is None or user.password_hash is None or not user.is_active:
        # Hash anyway so a missing account costs the same time as a wrong
        # password; otherwise latency answers the question the status code will not.
        verify_password(payload.password, DUMMY_HASH)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS)

    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, INVALID_CREDENTIALS)

    return _issue(user)


@router.get("/me", response_model=UserPublic)
async def me(user: CurrentUser) -> User:
    return user


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    payload: ChangePasswordRequest, session: SessionDep, user: CurrentUser
) -> TokenResponse:
    """Bumps token_version, which logs out every other device, then returns a
    fresh token so the caller is not logged out by their own change."""
    if user.password_hash is None or not verify_password(
        payload.current_password, user.password_hash
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Current password is incorrect")

    row = await session.get(User, user.id)
    row.password_hash = hash_password(payload.new_password)
    row.password_set_at = datetime.now(UTC)
    row.updated_at = datetime.now(UTC)
    row.token_version += 1
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _issue(row)
```

- [ ] **Step 5: Register the router**

In `backend/app/main.py`:

```python
from app.api import admin, auth, health, surveys, users
```

```python
app.include_router(auth.router, prefix="/api")
```

- [ ] **Step 6: Run the tests**

Run: `cd backend && uv run pytest tests/test_auth_api.py -q`
Expected: PASS, 11 tests

- [ ] **Step 7: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app backend/tests
git commit -m "feat(auth): login, me, and self-service password change"
```

---

## Task 5: Passwords in the users API

**Files:**
- Modify: `backend/app/schemas/user.py`, `backend/app/api/users.py`
- Test: `backend/tests/test_users_api.py`

**Interfaces:**
- Consumes: `hash_password` (Task 1), `SetPasswordRequest` (Task 4).
- Produces: `POST /api/users` requiring `password`; `POST /api/users/{id}/reset-password`; `GET /api/users` gated by `AdminUser`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_users_api.py`:

```python
async def test_listing_users_now_requires_an_admin(client, make_user):
    """It used to be public to feed the identity picker. With a login form
    there is no picker, and a public roster is a list of valid login names."""
    agent = await make_user(role="agent")
    assert (await client.get("/api/users")).status_code == 401
    assert (await client.get("/api/users", headers=auth(agent))).status_code == 403

    admin = await make_user(role="admin", name="Boss")
    assert (await client.get("/api/users", headers=auth(admin))).status_code == 200


async def test_creating_a_user_requires_a_password(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.post(
        "/api/users",
        json={"name": "Karim", "phone": "01712345678", "company": "FieldCo"},
        headers=auth(admin),
    )
    assert resp.status_code == 422


async def test_a_created_user_can_log_in_with_the_password_the_admin_set(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    resp = await client.post(
        "/api/users",
        json={
            "name": "Karim",
            "phone": "01712345678",
            "company": "FieldCo",
            "password": "handed-over-in-person",
        },
        headers=auth(admin),
    )
    assert resp.status_code == 201
    assert "password" not in resp.json()
    assert "password_hash" not in resp.json()

    login = await client.post(
        "/api/auth/login",
        json={"phone": "01712345678", "password": "handed-over-in-person"},
    )
    assert login.status_code == 200


async def test_admin_reset_logs_the_user_out_everywhere(client, make_user):
    from app.core.security import hash_password
    from app.db.session import SessionLocal
    from app.models.user import User

    admin = await make_user(role="admin", name="Boss")
    victim = await make_user(role="agent", name="Karim")
    async with SessionLocal() as session:
        row = await session.get(User, victim.id)
        row.password_hash = hash_password("forgotten-password")
        session.add(row)
        await session.commit()
        await session.refresh(row)

    victim_headers = auth(row)
    assert (await client.get("/api/auth/me", headers=victim_headers)).status_code == 200

    resp = await client.post(
        f"/api/users/{victim.id}/reset-password",
        json={"password": "a-fresh-password"},
        headers=auth(admin),
    )
    assert resp.status_code == 204

    # Their existing token is dead, the new password works, the old one does not.
    assert (await client.get("/api/auth/me", headers=victim_headers)).status_code == 401
    assert (
        await client.post(
            "/api/auth/login", json={"phone": victim.phone, "password": "a-fresh-password"}
        )
    ).status_code == 200
    assert (
        await client.post(
            "/api/auth/login", json={"phone": victim.phone, "password": "forgotten-password"}
        )
    ).status_code == 401
    # And the admin's own session is untouched.
    assert (await client.get("/api/auth/me", headers=auth(admin))).status_code == 200


async def test_an_agent_cannot_reset_anyone(client, make_user):
    agent = await make_user(role="agent")
    victim = await make_user(role="agent", name="Victim")
    resp = await client.post(
        f"/api/users/{victim.id}/reset-password",
        json={"password": "a-fresh-password"},
        headers=auth(agent),
    )
    assert resp.status_code == 403


async def test_resetting_an_unknown_user_is_a_404(client, make_user):
    from uuid import uuid4

    admin = await make_user(role="admin", name="Boss")
    resp = await client.post(
        f"/api/users/{uuid4()}/reset-password",
        json={"password": "a-fresh-password"},
        headers=auth(admin),
    )
    assert resp.status_code == 404
```

Also update the existing tests in this file that create users without a
password — `test_agent_cannot_create_users`,
`test_admin_creates_an_agent_with_a_normalized_phone`,
`test_admin_can_appoint_another_admin`, `test_unparseable_phone_is_rejected`,
`test_unknown_role_is_rejected`, and `test_deactivating_a_user_locks_them_out`
— by adding `"password": "a-valid-password"` to each JSON body. Leave
`test_unparseable_phone_is_rejected` and `test_unknown_role_is_rejected`
otherwise unchanged; they must still return 422 for their own reasons.

`test_user_list_is_public_and_hides_phone` is now wrong by name and by
behaviour. Replace it with:

```python
async def test_user_list_hides_phone(client, make_user):
    admin = await make_user(role="admin", name="Boss")
    await make_user(name="Karim")
    resp = await client.get("/api/users", headers=auth(admin))
    assert resp.status_code == 200
    row = _find(resp.json(), "Karim")
    assert row["company"] == "FieldCo"
    assert row["role"] == "agent"
    assert "phone" not in row
    assert "password_hash" not in row
```

And `test_first_admin_is_seeded_when_the_table_is_empty` must now authenticate.
Replace its body with:

```python
async def test_first_admin_is_seeded_when_the_table_is_empty(client, make_user):
    """Identity used to be chosen from this list; now it only proves the seed ran."""
    from app.db.session import SessionLocal
    from app.models.user import User
    from sqlmodel import select

    async with SessionLocal() as session:
        result = await session.exec(select(User))
        assert [u.role for u in result.all()] == ["admin"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_users_api.py -q`
Expected: FAIL — no `password` field, no reset route, list still public.

- [ ] **Step 3: Add `password` to `UserCreate`**

In `backend/app/schemas/user.py`, add to `class UserCreate` and update the imports:

```python
from app.schemas.auth import Password
```

```python
    password: str = Password
```

**Import direction matters:** `schemas/auth.py` imports `UserPublic` from
`schemas/user.py`, so `user.py` importing `Password` from `auth.py` would be a
cycle. Put `Password`, `PASSWORD_MIN`, and `PASSWORD_MAX` in
`app/schemas/user.py` instead, and have `auth.py` import them from there.
Adjust Task 4's `schemas/auth.py` accordingly:

```python
# app/schemas/user.py
PASSWORD_MIN = 8
PASSWORD_MAX = 128
Password = Field(min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)

# app/schemas/auth.py
from app.schemas.user import Password, UserPublic
```

- [ ] **Step 4: Update the users router**

In `backend/app/api/users.py`, gate the list, hash on create, and add the reset
route. Replace `list_users` and `create_user`, and append the new endpoint:

```python
@router.get("", response_model=list[UserPublic])
async def list_users(session: SessionDep, _: AdminUser) -> list[User]:
    """Admin-only. This fed the identity picker when there was no login; a
    public roster is now just a list of valid login names."""
    result = await session.exec(select(User).order_by(User.name))
    return list(result.all())


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def create_user(payload: UserCreate, session: SessionDep, _: AdminUser) -> User:
    user = User(
        name=payload.name,
        phone=payload.phone,  # already E.164 via the schema validator
        company=payload.company,
        role=payload.role,
        password_hash=hash_password(payload.password),
        password_set_at=_utcnow(),
    )
    session.add(user)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "phone already registered") from None
    await session.refresh(user)
    return user


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: UUID, payload: SetPasswordRequest, session: SessionDep, _: AdminUser
) -> None:
    """Bumping token_version logs the user out of every device, which is the
    point: a reset exists because the account may be in the wrong hands."""
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "user not found")
    user.password_hash = hash_password(payload.password)
    user.password_set_at = _utcnow()
    user.updated_at = _utcnow()
    user.token_version += 1
    session.add(user)
    await session.commit()
```

Update the imports at the top of `users.py`:

```python
from app.core.security import hash_password
from app.schemas.auth import SetPasswordRequest
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_users_api.py -q`
Expected: PASS

- [ ] **Step 6: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app backend/tests
git commit -m "feat(users): admin-set passwords, admin reset, private user list"
```

---

## Task 6: Seeded accounts get passwords

**Files:**
- Modify: `backend/app/db/session.py`
- Test: `backend/tests/test_seed_demo.py`

**Interfaces:**
- Consumes: `hash_password` (Task 1), `settings.admin_password`, `settings.demo_password`.
- Produces: seeded users that can actually log in.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_seed_demo.py`:

```python
async def test_the_seeded_admin_can_log_in(client):
    """Without this the system is unusable on first boot: no login, and no way
    to create a user who could."""
    from app.core.config import get_settings

    settings = get_settings()
    resp = await client.post(
        "/api/auth/login",
        json={"phone": settings.admin_phone, "password": settings.admin_password},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["user"]["role"] == "admin"


async def test_seeded_demo_agents_can_log_in(client, demo_on):
    from app.core.config import get_settings
    from app.db.session import seed_demo_agents

    await seed_demo_agents()
    settings = get_settings()

    resp = await client.post(
        "/api/auth/login",
        json={"phone": "01711000001", "password": settings.demo_password},
    )
    assert resp.status_code == 200
    assert resp.json()["user"]["role"] == "agent"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && uv run pytest tests/test_seed_demo.py -q`
Expected: FAIL with 401 — seeded users have no `password_hash`.

- [ ] **Step 3: Hash the seeded passwords**

In `backend/app/db/session.py`, inside `seed_first_admin`, replace the
`session.add(...)` call:

```python
        from app.core.security import hash_password

        session.add(
            User(
                name=settings.admin_name,
                phone=normalize_phone(settings.admin_phone),
                company=settings.app_name,
                role="admin",
                password_hash=hash_password(settings.admin_password),
                password_set_at=datetime.now(UTC),
            )
        )
```

And inside `seed_demo_agents`, replace its `session.add(...)` call:

```python
        from app.core.security import hash_password

        demo_hash = hash_password(settings.demo_password)
        for name, phone, company in _DEMO_AGENTS:
            session.add(
                User(
                    name=name,
                    phone=normalize_phone(phone),
                    company=company,
                    role="agent",
                    password_hash=demo_hash,
                    password_set_at=datetime.now(UTC),
                )
            )
```

Hashing once and reusing it for all three demo agents is deliberate: argon2 is
intentionally slow, and three hashes of the same string would add close to a
second to every boot.

Add to the imports at the top of `session.py`:

```python
from datetime import UTC, datetime
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_seed_demo.py -q`
Expected: PASS, 6 tests

- [ ] **Step 5: Full suite, lint, commit**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
git add backend/app/db/session.py backend/tests/test_seed_demo.py
git commit -m "feat(seed): seeded admin and demo agents get working passwords"
```

---

## Task 7: Frontend login

**Files:**
- Modify: `frontend/src/api.ts`, `frontend/src/auth.tsx`, `frontend/src/App.tsx`
- Create: `frontend/src/routes/LoginPage.tsx`
- Test: `npm run build` + manual check

**Interfaces:**
- Consumes: `/api/auth/login`, `/api/auth/me` (Task 4).
- Produces: `useAuth()` returning `{ user, loading, login, logout }`; `TOKEN_KEY`; `login`, `me`, `changePassword`, `resetPassword` API functions.

- [ ] **Step 1: Rework the API client**

In `frontend/src/api.ts`, replace the identity constant, the `request` wrapper,
and `listUsers`, and add the new calls:

```ts
export const TOKEN_KEY = "doctor-form.token";

/** Called whenever the server rejects our credentials. Set by AuthProvider so
 *  expiry, deactivation and password changes all land in one place. */
let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const resp = await fetch(`${BASE}${path}`, { ...init, headers });

  if (resp.status === 401) {
    // One place covers an expired token, a deactivated account, and a password
    // changed on another device - all of which arrive as a 401.
    localStorage.removeItem(TOKEN_KEY);
    onUnauthorized();
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => resp.statusText);
    throw new ApiError(resp.status, `${resp.status}: ${detail}`);
  }
  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: UserPublic;
}

export const login = (phone: string, password: string) =>
  request<TokenResponse>("/api/auth/login", json({ phone, password }));

export const me = () => request<UserPublic>("/api/auth/me");

export const changePassword = (current_password: string, new_password: string) =>
  request<TokenResponse>(
    "/api/auth/change-password",
    json({ current_password, new_password }),
  );

export const resetPassword = (userId: string, password: string) =>
  request<void>(`/api/users/${userId}/reset-password`, json({ password }));
```

Update `createUser` to carry a password:

```ts
export const createUser = (body: {
  name: string;
  phone: string;
  company: string;
  role: "agent" | "admin";
  password: string;
}) => request<UserPublic>("/api/users", json(body));
```

Delete the `USER_ID_KEY` export — nothing sends `X-User-Id` any more.

- [ ] **Step 2: Replace `auth.tsx`**

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

import {
  login as loginRequest,
  me,
  setUnauthorizedHandler,
  TOKEN_KEY,
  type UserPublic,
} from "./api";

interface Auth {
  user: UserPublic | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  useEffect(() => {
    // Any 401 from anywhere drops us back to the login screen.
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  useEffect(() => {
    // A stored token may be expired or revoked; /auth/me is what settles it.
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false);
      return;
    }
    me()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const resp = await loginRequest(phone, password);
    localStorage.setItem(TOKEN_KEY, resp.access_token);
    setUser(resp.user);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout }),
    [user, loading, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** The role now comes from a signed token rather than a value the client chose,
 *  so this is a real check - but the server's 403 is still the enforcement. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user || user.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 3: Create `frontend/src/routes/LoginPage.tsx`**

```tsx
import { useState } from "react";

import { useAuth } from "../auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await login(phone, password);
      setError(null);
    } catch {
      // The server deliberately does not say which half was wrong, and neither
      // does this: it would tell an attacker which phones are registered.
      setError("Phone or password is incorrect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <header>
        <h1>Sign in</h1>
        <p className="sub">Doctor chamber surveys</p>
      </header>

      {error && <div className="error">{error}</div>}

      <form className="card" onSubmit={onSubmit}>
        <label>
          Phone
          <input
            required
            autoFocus
            inputMode="tel"
            autoComplete="username"
            placeholder="01712345678"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="muted">
        No account? An administrator creates it and gives you a password.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Rewire `App.tsx` and `main.tsx`**

In `frontend/src/App.tsx`, replace the `IdentityPicker` import and usage:

```tsx
import { Link, Navigate, Route, Routes } from "react-router-dom";

import { RequireAdmin, useAuth } from "./auth";
import AdminPage from "./routes/AdminPage";
import AgentPage from "./routes/AgentPage";
import LoginPage from "./routes/LoginPage";

function Header() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <nav className="topbar">
      <span className="muted">
        {user.name} · {user.role}
      </span>
      <span className="topbar-links">
        <Link to="/">Survey</Link>
        {user.role === "admin" && <Link to="/admin">Admin</Link>}
        <button className="link" onClick={logout}>
          Sign out
        </button>
      </span>
    </nav>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <LoginPage />;

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

In `frontend/src/main.tsx`, swap the provider:

```tsx
import { AuthProvider } from "./auth";
```

```tsx
      <AuthProvider>
        <App />
      </AuthProvider>
```

- [ ] **Step 5: Verify**

```bash
cd frontend && npm run build
```

Expected: build succeeds with no TypeScript errors.

Manual check with `docker compose up -d`:
1. Open `http://localhost:5173`. Expected: the sign-in form, no user list.
2. Sign in as the seeded admin (`ADMIN_PHONE` / `ADMIN_PASSWORD`). Expected: the header shows `Admin · admin`.
3. In devtools, corrupt `localStorage["doctor-form.token"]` and reload. Expected: back at sign-in rather than a broken page.
4. Sign in, then run in the console: `localStorage.removeItem("doctor-form.token")` and click Survey. Expected: the next API call 401s and returns you to sign-in.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): sign-in form replacing the identity picker"
```

---

## Task 8: Password management in the UI

**Files:**
- Create: `frontend/src/components/PasswordForm.tsx`
- Modify: `frontend/src/routes/AgentPage.tsx`, `frontend/src/routes/AdminPage.tsx`
- Test: `npm run build` + manual check

**Interfaces:**
- Consumes: `changePassword`, `resetPassword`, `createUser`, `listUsers` (Task 7).
- Produces: nothing later tasks import.

- [ ] **Step 1: Create the shared form**

```tsx
import { useState } from "react";

export const PASSWORD_MIN = 8;

/** Used both for changing your own password and for an admin resetting
 *  someone else's, which differ only in whether a current password is asked
 *  for. */
export default function PasswordForm({
  requireCurrent,
  submitLabel,
  onSubmit,
}: {
  requireCurrent: boolean;
  submitLabel: string;
  onSubmit: (next: string, current: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next.length < PASSWORD_MIN) {
      setError(`Password must be at least ${PASSWORD_MIN} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(next, current);
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDone(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      {error && <div className="error">{error}</div>}
      {done && <p className="muted">Password updated.</p>}
      {requireCurrent && (
        <label>
          Current password
          <input
            required
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </label>
      )}
      <label>
        New password
        <input
          required
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          required
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </label>
      <button type="submit" disabled={busy}>
        {busy ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Add an Account section to the agent page**

In `frontend/src/routes/AgentPage.tsx`, add the imports:

```tsx
import { changePassword, TOKEN_KEY } from "../api";
import PasswordForm from "../components/PasswordForm";
```

and add this section immediately before the closing `</main>`:

```tsx
      <section>
        <h2>Account</h2>
        <PasswordForm
          requireCurrent
          submitLabel="Change password"
          onSubmit={async (next, current) => {
            const resp = await changePassword(current, next);
            // The change bumps token_version, so the token we hold is now dead.
            // Storing the replacement keeps this session alive while every
            // other device is signed out.
            localStorage.setItem(TOKEN_KEY, resp.access_token);
          }}
        />
      </section>
```

- [ ] **Step 3: Add password fields and reset controls to the admin page**

In `frontend/src/routes/AdminPage.tsx`, add to the imports:

```tsx
import { listUsers, resetPassword, type UserPublic } from "../api";
import PasswordForm from "../components/PasswordForm";
```

Add state beside the existing `useState` calls:

```tsx
  const [newPassword, setNewPassword] = useState("");
  const [people, setPeople] = useState<UserPublic[]>([]);
  const [resetting, setResetting] = useState<UserPublic | null>(null);
```

Inside `refresh`, fetch the roster alongside the rest — replace the
`Promise.all` line:

```tsx
      const [s, list, roster] = await Promise.all([
        adminStats(),
        listAllSurveys(params),
        listUsers(),
      ]);
      setStats(s);
      setSurveys(list);
      setPeople(roster);
```

In `onAddAgent`, pass the password and clear it:

```tsx
      await createUser({
        name: newName,
        phone: newPhone,
        company: newCompany,
        role: "agent",
        password: newPassword,
      });
      setNewName("");
      setNewPhone("");
      setNewCompany("");
      setNewPassword("");
```

Add the password field to that form, after the Company label:

```tsx
        <label>
          Initial password
          <input
            required
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </label>
        <p className="muted">
          Give this to the agent directly. They can change it from their own
          page.
        </p>
```

Add a People section before the Surveys section:

```tsx
      <section>
        <h2>People</h2>
        <ul className="list">
          {people.map((p) => (
            <li key={p.id} className="card">
              <div className="row">
                <span>
                  <strong>{p.name}</strong> · {p.company} · {p.role}
                  {!p.is_active && <span className="muted"> · deactivated</span>}
                </span>
                <button
                  className="link"
                  onClick={() => setResetting(resetting?.id === p.id ? null : p)}
                >
                  {resetting?.id === p.id ? "Cancel" : "Reset password"}
                </button>
              </div>
              {resetting?.id === p.id && (
                <PasswordForm
                  requireCurrent={false}
                  submitLabel={`Set a new password for ${p.name}`}
                  onSubmit={async (next) => {
                    // Signs them out of every device, which is the point.
                    await resetPassword(p.id, next);
                    setResetting(null);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
```

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run build
```

Manual check:
1. Sign in as the admin, add an agent with a password of your choosing.
2. Sign out, sign in as that agent with that password. Expected: success.
3. On the agent page, change the password. Expected: "Password updated." and the page keeps working — you are not signed out by your own change.
4. Sign out and back in with the **new** password. Expected: success; the old one fails.
5. Sign in as the admin in a second browser profile, reset that agent's password. Back in the first profile, click Survey. Expected: bounced to sign-in, because the reset bumped `token_version`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): change your own password, admin resets others"
```

---

## Task 9: Documentation and environment

**Files:**
- Modify: `README.md`, `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`
- Test: manual read-through and a clean-volume boot

- [ ] **Step 1: Add the settings to `.env.example`**

After the `SEED_DEMO_DATA` block:

```bash
# ---- Authentication ----
# REQUIRED IN PRODUCTION. The app refuses to boot with the development default
# when DEBUG is false: a known signing key lets anyone forge an admin token.
# Generate one with:  python -c "import secrets; print(secrets.token_urlsafe(48))"
JWT_SECRET=dev-only-insecure-change-me

# Days before a signed-in user must sign in again.
ACCESS_TOKEN_TTL_DAYS=30

# REQUIRED IN PRODUCTION, for the same reason: the first admin is seeded with
# this password, and without a working one nobody can log in to create anybody.
ADMIN_PASSWORD=dev-only-admin-password

# Password given to the demo agents. Only read when SEED_DEMO_DATA is true.
DEMO_PASSWORD=demo-password
```

- [ ] **Step 2: Pass them through in dev compose**

In `docker-compose.yml`, in the backend service's `environment:` block, after
`SEED_DEMO_DATA`:

```yaml
      JWT_SECRET: ${JWT_SECRET:-dev-only-insecure-change-me}
      ACCESS_TOKEN_TTL_DAYS: ${ACCESS_TOKEN_TTL_DAYS:-30}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-dev-only-admin-password}
      DEMO_PASSWORD: ${DEMO_PASSWORD:-demo-password}
```

- [ ] **Step 3: Require them in prod compose**

In `docker-compose.prod.yml`, after the `SEED_DEMO_DATA: "false"` line:

```yaml
      # No defaults on purpose. An unset value here leaves the development
      # default in place, and the app then refuses to boot - which is the
      # intended outcome, loudly, rather than a forgeable signing key.
      JWT_SECRET: ${JWT_SECRET}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      ACCESS_TOKEN_TTL_DAYS: ${ACCESS_TOKEN_TTL_DAYS:-30}
```

- [ ] **Step 4: Rewrite the README's Roles section**

Replace the opening paragraph of `## Roles`:

```markdown
Two roles, behind phone + password authentication. Sign in at `/login` with the
phone an administrator registered; the server returns a 30-day HS256 JWT, which
the browser stores and sends as `Authorization: Bearer`.

There are no self-service registrations and no password resets by email or SMS:
an administrator creates each account with an initial password and hands it over
directly, and the user changes it from their own page.
```

Replace the "Migrating to real login" paragraph with:

```markdown
**Revocation without a sessions table.** `get_current_user` loads the user row
on every request anyway, for `role` and `is_active`, so two checks come free:

- deactivating a user (`PATCH /api/users/{id}`) rejects their existing token on
  the next request;
- changing or resetting a password bumps `token_version`, which is carried in
  every token and compared against the row — so it signs out every other device.

A self change-password returns a fresh token, so you are not signed out by your
own change. An admin reset does not, which is the point of a reset.
```

- [ ] **Step 5: Update the README API table**

Replace the sentence above it and add the auth rows:

```markdown
Everything except `/api/healthz`, `/api/readyz`, and `POST /api/auth/login`
requires an `Authorization: Bearer <token>` header.

| Method   | Path                        | Gate    | Notes                                     |
| -------- | --------------------------- | ------- | ----------------------------------------- |
| `POST`   | `/api/auth/login`           | public  | `{phone, password}` → token + user         |
| `GET`    | `/api/auth/me`              | user    | The authenticated user                     |
| `POST`   | `/api/auth/change-password` | user    | Bumps `token_version`, returns a new token |
| `POST`   | `/api/users/{id}/reset-password` | admin | Signs that user out everywhere         |
```

Then change the `GET /api/users` row's gate from `public` to `admin`, and note
that `POST /api/users` now requires a password.

- [ ] **Step 6: Update the Configuration table and Known gaps**

Add to the configuration table:

```markdown
| `JWT_SECRET`             | *(dev default; boot fails in prod)* | Token signing key            |
| `ACCESS_TOKEN_TTL_DAYS`  | `30`                             | Token lifetime                   |
| `ADMIN_PASSWORD`         | *(dev default; boot fails in prod)* | Seeded admin's password      |
| `DEMO_PASSWORD`          | `demo-password`                  | Demo agents' password (dev only) |
```

Replace the "No authentication" bullet under Known gaps with:

```markdown
- **No rate limiting on `/api/auth/login`.** Nothing stops an attacker guessing
  passwords as fast as the network allows. Argon2 makes each attempt expensive,
  which helps but is not a substitute. This belongs with rate limiting across
  the whole API rather than bolted onto one endpoint.
- **No self-service password reset.** There is no email or SMS channel, so a
  forgotten password needs an administrator.
- **No audit log of sign-in attempts.**
```

- [ ] **Step 7: Verify the whole system from a clean volume**

```bash
cd backend && uv run pytest -q && uv run ruff check . && cd ..
cd frontend && npm run build && cd ..
docker compose down -v && docker compose up --build -d
sleep 25
curl -fsS http://localhost:8000/api/readyz
# The roster is private now: no token, no list.
curl -s -o /dev/null -w "GET /api/users unauthenticated -> %{http_code}\n" \
  http://localhost:8000/api/users
# And the seeded admin can actually get in.
curl -fsS -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+8801700000000","password":"dev-only-admin-password"}' \
  | python3 -m json.tool | head -5
```

Expected: `readyz` ready; `/api/users` returns **401**; login returns a token
and the admin user.

- [ ] **Step 8: Verify the production guard actually fires**

```bash
cd backend && DEBUG=false JWT_SECRET=dev-only-insecure-change-me \
  uv run python -c "
from app.core.config import Settings
try:
    Settings(_env_file=None, debug=False)
    print('FAIL: booted with the default secret')
except Exception as exc:
    print('OK, refused:', str(exc)[:80])
"
```

Expected: `OK, refused: JWT_SECRET is still the development default…`

- [ ] **Step 9: Commit**

```bash
git add README.md .env.example docker-compose.yml docker-compose.prod.yml
git commit -m "docs: authentication, token revocation, and required secrets"
```

---

## Self-Review Notes

Checked against the spec:

- Every spec section maps to a task: security primitives and guards → 1;
  columns and migration → 2; the Bearer seam → 3; login/me/change-password → 4;
  admin-set passwords, reset, private user list → 5; seeding → 6; login UI → 7;
  password UI → 8; docs and env → 9.
- Each spec test bullet appears as a named test: login, indistinguishable
  failures, NULL-hash users, token validity, expiry, forged signature,
  deactivation, `token_version`, admin reset, password length bounds, seeding,
  and both startup guards.
- **Fixed during review:** Task 4 originally put `Password` in
  `app/schemas/auth.py` while `auth.py` imports `UserPublic` from
  `app/schemas/user.py` — and Task 5 then imports `Password` back into
  `user.py`, which is a circular import. `Password`, `PASSWORD_MIN`, and
  `PASSWORD_MAX` live in `app/schemas/user.py`; Task 5 Step 3 states this
  explicitly and corrects Task 4.
- Names are consistent across tasks: `create_access_token`/`decode_access_token`
  (Task 1, used 3/4), `DUMMY_HASH` (1, used 4), `auth()` (3, used 4/5),
  `TOKEN_KEY`/`setUnauthorizedHandler` (7, used 8), `PasswordForm` (8).
- Deviation from the spec worth flagging: the spec lists
  `frontend/src/components/PasswordForm.tsx` as shared between the agent's own
  change and the admin's reset; this plan keeps that, with `requireCurrent`
  as the only difference between the two uses.
