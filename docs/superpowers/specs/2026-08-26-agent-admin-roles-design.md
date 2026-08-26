# Agent / Admin roles and chamber surveys

**Date:** 2026-08-26
**Status:** approved design, pending implementation plan

## Problem

The repository ships a scaffold: one page showing a placeholder "patient" form
and, to everybody, every submission ever made. The real system is different.

Field **agents** visit hospitals and record where a doctor sits, when, at what
throughput, and how to reach the chamber. An agent files many surveys a day and
wants to see their own running totals. An **admin** oversees all agents and
needs every survey plus overall counts.

There is no login yet, and none is being built here. What is being built is the
role structure, the identity boundary, and the per-user scoping that real login
will later plug into without redesign.

## Decisions

Each of these was chosen deliberately; the reasoning matters more than the
choice, because it is what tells a future reader whether a change is safe.

### Identity: a real users table, selected rather than proven

A user picks who they are from a list; the choice is stored in `localStorage`
and sent as an `X-User-Id` header. The backend resolves it through
`get_current_user`, exactly where a token would be verified later.

This is **not security**. Anyone can send any user id. It is a role structure
with the authentication step deliberately left as a stub. The alternatives —
an anonymous per-browser id, or grouping submissions by a typed email — were
rejected because neither produces user records that real accounts could later
attach to, so the historical data would be orphaned at migration time.

**Migration path to real login:** `get_current_user` reads a verified token
instead of a header. No route, model, or frontend page changes. The `user_id`
foreign keys already point at the right rows.

### Migrations exist from the first commit

`init_db()` currently calls `SQLModel.metadata.create_all`, which can only
create missing tables — it can never alter one. Introducing Alembic now, while
the database is empty, makes the baseline revision trivially correct. Deferring
it means the first schema change after go-live is hand-written SQL against
production data, plus a stamped baseline that has to be verified by hand.

Alembic runs against Postgres on boot (`alembic upgrade head`). The test suite
keeps using `create_all` against SQLite, preserving the property that `pytest`
works on a bare checkout with no compose stack running.

The initial revision simply does not contain the scaffold's `submissions`
table. Existing development databases are dropped once; the data is disposable.

### The placeholder entity is replaced, not extended

`submissions` (with `patient_name`, `email`, `notes`) was demo scaffolding and
is deleted. Keeping it would leave three columns whose names actively lie about
the domain.

### Doctor identity comes from OCR, not from the agent

The agent uploads a nameplate photograph and types nothing about the doctor.
`doctor_name`, `doctor_degrees`, and `doctor_specializations` stay NULL until
an OCR pipeline — **not part of this project** — fills them. `ocr_status`
records that the work is pending rather than leaving it invisible.

Because the nameplate is the only source of doctor identity, it is **required**.
A survey without one can never be attributed.

`doctor_specializations` is text, not a child table, even though it is the
multi-valued field. Its real shape is unknown until the OCR pipeline emits
values off actual nameplates; structuring it now means migrating twice.
Promoting it to a child table later is a data-preserving migration — columns
copy into rows — so starting flat forfeits nothing.

### Location: coordinates or place, at least one

Requiring coordinates would block an agent whose browser denies geolocation or
whose corridor has no GPS lock. Requiring city/district would discard good GPS
data. So either pair satisfies the requirement, and each pair is
all-or-nothing.

### Deletion is soft

Field data a surveyor can quietly remove is field data that cannot be audited,
so deletion is admin-only. It is also **soft**: `DELETE /api/admin/surveys/{id}`
sets `deleted_at` and leaves the nameplate object in storage.

`storage.delete_object` therefore loses its only caller when
`api/submissions.py` is deleted. Keep the helper — a retention or purge job is
the natural place for it — but it is dead code until then, and should be
labelled as such rather than left looking load-bearing.

This is the one decision here that cannot be revisited later. Every other
column on this page can be added by a future migration; rows destroyed by a
hard delete are gone. Retaining them costs a nullable timestamp and a filter.

### Enumerations are VARCHAR + CHECK, never native Postgres ENUM

`role` and `ocr_status` are `VARCHAR` with a `CHECK` constraint. Native
Postgres enum types are awkward to alter and do not exist in SQLite, which
would make the test suite diverge from production. Adding a `supervisor` role
later should be a one-line constraint change.

### Phone numbers are normalized to E.164 on write

Every phone — the user's and the chamber's — is stored as `+8801712345678`.
A uniqueness constraint spanning `01712345678` and `+8801712345678` is not a
constraint at all, and if phone later becomes the OTP login identity,
deduplicating inconsistent formats means manual work on live accounts.

## Data model

```
users                            chamber_surveys
─────                            ───────────────
id         UUID pk               id                     UUID pk
name       str(200) idx          user_id                FK users idx
phone      str(32) uniq E.164    hospital_name          str(200) idx
company    str(200) idx          city                   str(100) NULL
role       VARCHAR(16) CHECK     district               str(100) NULL
             ('agent','admin')   latitude               float NULL
is_active  bool = true           longitude              float NULL
created_at timestamptz           nameplate_key          str NOT NULL
updated_at timestamptz           daily_patients         int NOT NULL
                                 avg_duration_min       int NOT NULL
availability_slots               consultation_fee_bdt   int NOT NULL
──────────────────               ocr_status             VARCHAR(16) CHECK
id          UUID pk                                       ('pending','done','failed')
survey_id   FK surveys idx       doctor_name            str NULL
            ON DELETE CASCADE    doctor_degrees         text NULL
day_of_week int 0..6             doctor_specializations text NULL
start_time  TIME                 created_at             timestamptz idx
end_time    TIME                 updated_at             timestamptz
                                 deleted_at             timestamptz NULL idx
survey_phones
─────────────
id          UUID pk
survey_id   FK surveys idx ON DELETE CASCADE
phone       str(32) idx, E.164
```

**Table constraint on `chamber_surveys`:**

```sql
CHECK (
  (latitude IS NOT NULL AND longitude IS NOT NULL)
  OR (city IS NOT NULL AND district IS NOT NULL)
)
```

**Field rules**

| Field | Rule |
|---|---|
| `users.phone` | unique, E.164; the natural key now that email is gone, and where an OTP would go |
| `survey_phones.phone` | E.164; **at least one per survey**; not unique — a chamber may share a line |
| `latitude` / `longitude` | −90..90 / −180..180; both or neither |
| `city` / `district` | non-empty; both or neither |
| `daily_patients` | > 0 |
| `avg_duration_min` | > 0, minutes |
| `consultation_fee_bdt` | >= 0, whole taka as an integer — never a float for money |
| `day_of_week` | 0=Monday .. 6=Sunday, matching `datetime.weekday()`; the UI renders Sat→Fri |
| `end_time` | strictly greater than `start_time` |
| slots per survey | at least one |
| `updated_at` | set on every write, including the future OCR pass — without it there is no way to tell which rows the pipeline has touched |

`day_of_week` stores the calendar convention, not the display order. Storing
display order in the database is the mistake this note exists to prevent.

"At least one" for slots and phones is not expressible as a database
constraint; both are enforced in the create schema (`min_length=1`) and
covered by tests.

### "Today" is an Asia/Dhaka day

`created_at` is stored UTC. Daily counts compute their window in a configurable
`app_timezone` (default `Asia/Dhaka`). Without this the agents' day rolls over
mid-morning local time and every daily figure is wrong.

### Seeding the first admin

Identity is chosen from the users list, so the list cannot start empty. On boot,
if `users` is empty, seed one admin from `admin_name` / `admin_phone` settings.
That admin creates the agents.

## API

Two dependencies in `app/core/deps.py` are the entire auth surface:

```python
async def get_current_user(x_user_id: Annotated[UUID | None, Header()], session) -> User:
    """401 when missing, unknown, or is_active is False."""

async def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    """403 when user.role != 'admin'."""
```

| Method | Route | Gate | Behaviour |
|---|---|---|---|
| GET | `/api/users` | public | `id`, `name`, `company`, `role` only — never `phone`. Feeds the identity picker. |
| POST | `/api/users` | `require_admin` | create a user: `name`, `phone`, `company`, `role`; `role` may be `agent` or `admin`, so an admin can appoint another admin |
| PATCH | `/api/users/{id}` | `require_admin` | toggle `is_active`; the only writer of that column |
| GET | `/api/surveys` | `get_current_user` | the caller's own surveys, `deleted_at IS NULL` |
| POST | `/api/surveys` | `get_current_user` | `user_id` from the header, never the body |
| GET | `/api/surveys/{id}` | `get_current_user` | **404** when it is not the caller's, or is soft-deleted |
| GET | `/api/surveys/stats` | `get_current_user` | `{total, today}` for the caller, excluding deleted |
| GET | `/api/admin/surveys` | `require_admin` | all surveys + agent name; filter by agent, district, and date range interpreted in `app_timezone`, not UTC; `limit`/`offset` as today; `include_deleted` defaults false |
| GET | `/api/admin/stats` | `require_admin` | `{total, today, agent_count, per_agent: [...]}`, excluding deleted |
| DELETE | `/api/admin/surveys/{id}` | `require_admin` | **soft** — sets `deleted_at`, keeps the row and the S3 object |

**`/api/surveys/stats` must be declared before `/api/surveys/{id}`.** FastAPI
matches routes in declaration order, so the reverse order parses `stats` as a
UUID path parameter and returns 422.

**Admins may file surveys too.** `/api/surveys` is gated by `get_current_user`,
not `require_admin`, so an admin using the agent page sees their own surveys and
their own counts there, and those rows are included in the admin totals like any
other. Only the `/api/admin/*` routes are role-gated.

`POST /api/surveys` is `multipart/form-data`: scalar fields, the nameplate file,
and `slots` and `phones` as JSON-encoded strings. Multipart cannot nest, and the
image must ride in the same request. The server parses those strings and
validates them against `SlotIn` and `PhoneIn` models.

Presigned nameplate URLs are generated on read, as `storage.presigned_get_url`
already does for attachments.

## Frontend

```
src/
  auth.tsx              IdentityProvider: localStorage "doctor-form.user-id",
                        GET /api/users, picker when unset, { user, switchUser, clear }
  api.ts                one request() wrapper attaching X-User-Id + typed calls
  routes/
    AgentPage.tsx       my stats (total · today) + survey form + my recent surveys
    AdminPage.tsx       stat tiles + per-agent table + all surveys w/ filters + add agent
  components/
    SlotEditor.tsx      repeater → [{ day_of_week, start_time, end_time }], min 1
    PhoneEditor.tsx     repeater → ["+8801…"], min 1
    LocationInput.tsx   geolocation on mount into editable lat/lng, plus city/district;
                        validates "either pair" before enabling submit
    NameplateInput.tsx  required image picker, preview, client-side 10MB check
```

Routes: `/` agent page, `/admin` behind `<RequireAdmin>`, anything else redirects
to `/`.

`<RequireAdmin>` is a UX guard, not a security boundary — the identity is
client-chosen, so anyone can set that `localStorage` key. The only real
enforcement is the server's 403. The guard exists so an agent does not land on a
page that would show them nothing but errors.

Admin rows display `doctor_name` when OCR has run and `— (nameplate pending)`
when it has not, alongside the nameplate thumbnail. Location renders as
`city, district`, coordinates, or both, depending on what the survey carries.

## Errors

| Condition | Server | Client |
|---|---|---|
| missing / unknown / inactive `X-User-Id` | 401 | clear stored id, return to picker |
| agent calls `/api/admin/*` | 403 | redirect to `/` |
| nameplate missing | 422 | field error |
| nameplate > 10MB | 413 | pre-checked before upload |
| no location pair, or a half pair | 422 | inline location error |
| `end_time <= start_time`, day outside 0..6, zero slots | 422 | inline slot error |
| zero phones, or an unparseable phone | 422 | inline phone error |

## Testing

`pytest` against SQLite in-process via `httpx.ASGITransport`, as the repo
already does. Storage is covered by **`moto`**, an in-process S3 mock: tests
stay runnable on a bare checkout with no compose stack, while real `boto3`
calls still execute, so bucket names, keys, content types, and presign wiring
are genuinely exercised. Monkeypatching `storage.upload_fileobj` was rejected
because it would only prove that our code calls a function we stubbed.

There is currently no CI in this repository. Keeping tests infrastructure-free
means that when CI is added, the job is `pytest` with no services block.

- **identity** — missing header 401; unknown uuid 401; `is_active=false` 401
- **deactivation** — an admin PATCHing a user to `is_active=false` causes that
  user's next request to 401, and their existing surveys remain readable by admin
- **role gate** — an agent receives 403 from every `/api/admin/*` route
- **scoping** — `GET /api/surveys` returns only the caller's; agent A fetching
  agent B's survey receives 404, not 403
- **ownership** — `user_id` comes from the header even when the body sets a
  different one
- **location** — coords-only accepted; city+district-only accepted; both
  accepted; lat without lng rejected; city without district rejected; neither
  rejected
- **slots** — round-trip persistence; `end <= start` rejected; day 7 rejected;
  empty slot list rejected
- **phones** — round-trip persistence; empty list rejected; `01712345678`
  normalizes to `+8801712345678`; a user created with either format collides on
  the uniqueness constraint
- **nameplate** — missing file rejected; uploaded object lands in the bucket
  under `surveys/<uuid>.<ext>` with its content type
- **soft delete** — a deleted survey vanishes from agent list, agent detail,
  both stats endpoints, and the default admin list, but appears under
  `include_deleted=true`, and its S3 object still resolves
- **stats timezone** — a survey created `2026-08-26T19:00Z` is `01:00` Dhaka on
  the 27th and counts toward the 27th, not the 26th
- **admin stats** — `per_agent` counts sum to `total`

## Files

**New:** `backend/alembic/` (`env.py`, `versions/0001_initial.py`),
`backend/alembic.ini`; `app/core/deps.py`; `app/models/{user,survey,slot,phone}.py`;
`app/schemas/{user,survey}.py`; `app/api/{users,surveys,admin}.py`;
`frontend/src/auth.tsx`; `frontend/src/routes/{AgentPage,AdminPage}.tsx`;
`frontend/src/components/{SlotEditor,PhoneEditor,LocationInput,NameplateInput}.tsx`

**Deleted:** `app/models/submission.py`; `app/schemas/submission.py`;
`app/api/submissions.py`; the `submissions` table

**Edited:** `app/main.py` (routers); `app/core/config.py` (`app_timezone`,
`admin_name`, `admin_phone`); `app/db/session.py` (Alembic on Postgres,
`create_all` on SQLite, seed first admin); `backend/pyproject.toml` (`alembic`,
`phonenumbers`; `moto` as a dev dependency); `frontend/package.json`
(`react-router-dom`); `frontend/src/{App,api}.tsx|ts`; `README.md`;
`docker-compose*.yml` if migrations run as a startup step

## Explicitly out of scope

- Authentication of any kind. This system has roles, not security.
- The OCR pipeline. Only its output columns and status field exist.
- Editing a survey after submission.
- Restoring a soft-deleted survey through the UI.
- Pagination beyond the existing limit/offset.
