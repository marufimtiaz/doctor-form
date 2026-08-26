# Agent / Admin roles and chamber surveys

**Date:** 2026-08-26
**Status:** approved design, pending implementation plan

## Problem

The repository ships a scaffold: one page showing a placeholder "patient" form
and, to everybody, every submission ever made. The real system is different.

Field **agents** visit hospitals and record where a doctor sits, when, and at
what throughput. An agent files many surveys a day and wants to see their own
running totals. An **admin** oversees all agents and needs every survey plus
overall counts.

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

### The placeholder entity is replaced, not extended

`submissions` (with `patient_name`, `email`, `notes`) was demo scaffolding and
is deleted. `init_db()` uses `SQLModel.metadata.create_all` with no migration
tool, so renaming costs a manual `DROP TABLE submissions` and nothing else.
Keeping the old table would leave three columns whose names actively lie about
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
Postgres `ARRAY`/`JSONB` are additionally unavailable because the test suite
runs on SQLite.

### Location: coordinates or place, at least one

Requiring coordinates would block an agent whose browser denies geolocation or
whose corridor has no GPS lock. Requiring city/district would discard good GPS
data. So either pair satisfies the requirement, and each pair is
all-or-nothing.

### Deletion is admin-only

Field data a surveyor can quietly remove is field data that cannot be audited.

## Data model

```
users                          chamber_surveys                        availability_slots
─────                          ───────────────                        ──────────────────
id         UUID pk             id                     UUID pk         id          UUID pk
name       str(200) idx        user_id                FK users idx    survey_id   FK surveys idx
phone      str(32) uniq        hospital_name          str(200) idx                ON DELETE CASCADE
company    str(200) idx        city                   str(100) NULL   day_of_week int 0..6
role       'agent'|'admin'     district               str(100) NULL   start_time  TIME
is_active  bool = true         latitude               float NULL      end_time    TIME
created_at timestamptz         longitude              float NULL
                               nameplate_key          str NOT NULL
                               daily_patients         int NOT NULL
                               avg_duration_min       int NOT NULL
                               consultation_fee_bdt   int NOT NULL
                               ocr_status  'pending'|'done'|'failed'  NOT NULL
                               doctor_name            str NULL
                               doctor_degrees         text NULL
                               doctor_specializations text NULL
                               created_at             timestamptz idx
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
| `phone` | unique; the natural key now that email is gone, and where an OTP would go |
| `latitude` / `longitude` | −90..90 / −180..180; both or neither |
| `city` / `district` | non-empty; both or neither |
| `daily_patients` | > 0 |
| `avg_duration_min` | > 0, minutes |
| `consultation_fee_bdt` | >= 0, whole taka as an integer — never a float for money |
| `day_of_week` | 0=Monday .. 6=Sunday, matching `datetime.weekday()`; the UI renders Sat→Fri |
| `end_time` | strictly greater than `start_time` |
| slots per survey | at least one; not expressible as a DB constraint, enforced in the schema |

`day_of_week` stores the calendar convention, not the display order. Storing
display order in the database is the mistake this note exists to prevent.

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
| GET | `/api/surveys` | `get_current_user` | the caller's own surveys only |
| POST | `/api/surveys` | `get_current_user` | `user_id` from the header, never the body |
| GET | `/api/surveys/{id}` | `get_current_user` | **404** when it is not the caller's — do not confirm existence |
| GET | `/api/surveys/stats` | `get_current_user` | `{total, today}` for the caller |
| GET | `/api/admin/surveys` | `require_admin` | all surveys + agent name; filter by agent, district, and date range interpreted in `app_timezone`, not UTC; `limit`/`offset` as today |
| GET | `/api/admin/stats` | `require_admin` | `{total, today, agent_count, per_agent: [...]}` |
| DELETE | `/api/admin/surveys/{id}` | `require_admin` | delete row and its S3 object |

**`/api/surveys/stats` must be declared before `/api/surveys/{id}`.** FastAPI
matches routes in declaration order, so the reverse order parses `stats` as a
UUID path parameter and returns 422.

**Admins may file surveys too.** `/api/surveys` is gated by `get_current_user`,
not `require_admin`, so an admin using the agent page sees their own surveys and
their own counts there, and those rows are included in the admin totals like any
other. Only the `/api/admin/*` routes are role-gated.

`POST /api/surveys` is `multipart/form-data`: scalar fields, the nameplate file,
and `slots` as a JSON-encoded string. Multipart cannot nest, and the image must
ride in the same request. The server parses that string and validates it against
a `SlotIn` model.

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
- **nameplate** — missing file rejected; uploaded object lands in the bucket
  under `surveys/<uuid>.<ext>` with its content type
- **stats timezone** — a survey created `2026-08-26T19:00Z` is `01:00` Dhaka on
  the 27th and counts toward the 27th, not the 26th
- **admin stats** — `per_agent` counts sum to `total`

## Files

**New:** `app/core/deps.py`; `app/models/{user,survey,slot}.py`;
`app/schemas/{user,survey}.py`; `app/api/{users,surveys,admin}.py`;
`frontend/src/auth.tsx`; `frontend/src/routes/{AgentPage,AdminPage}.tsx`;
`frontend/src/components/{SlotEditor,LocationInput,NameplateInput}.tsx`

**Deleted:** `app/models/submission.py`; `app/schemas/submission.py`;
`app/api/submissions.py`; the `submissions` table

**Edited:** `app/main.py` (routers); `app/core/config.py` (`app_timezone`,
`admin_name`, `admin_phone`); `app/db/session.py` (seed first admin);
`backend/pyproject.toml` (`moto` dev dependency); `frontend/package.json`
(`react-router-dom`); `frontend/src/{App,api}.tsx|ts`; `README.md`

## Explicitly out of scope

- Authentication of any kind. This system has roles, not security.
- The OCR pipeline. Only its output columns and status field exist.
- Editing a survey after submission.
- Pagination beyond the existing limit/offset.
