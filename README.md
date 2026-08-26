# doctor-form

Full-stack scaffold: **Vite/React frontend**, **FastAPI backend**, **PostgreSQL**, and
**RustFS** (S3-compatible object storage), with two Docker Compose stacks — one for
local development, one for Coolify production behind Caddy.

## Architecture

```
Local (docker-compose.yml)          Production (docker-compose.prod.yml)
──────────────────────────          ────────────────────────────────────
:5173  frontend (Vite dev)          Coolify edge proxy (TLS)
         └─ proxies /api ─┐                    │
:8000  backend (FastAPI) ─┘          frontend  │ Caddy :80  (expose)
:5432  postgres  ◀── GUI             ├─ /api/* ─▶ backend :8000 (expose)
:9000  rustfs (S3 API)               └─ /*     ─▶ built SPA from /srv
:9001  rustfs (console)              rustfs :9000 (S3 domain)
                                     rustfs :9001 (console domain)
                                     postgres :5432 (published) ◀── GUI
```

Postgres runs as its own service with a **published port**, so GUI clients connect
to it directly — the backend does not have to be running.

In both stacks the browser talks to a **same-origin `/api`** — Vite's dev proxy
locally, Caddy in production — so no CORS is needed in prod.

## Roles

Two roles, and **no authentication yet**. A user picks who they are from
`GET /api/users`; the choice is kept in `localStorage` and sent as `X-User-Id`.
Anyone can send any id — this is a role structure, not a security boundary.

| Role  | Sees |
| ----- | ---- |
| agent | `/` — files surveys, sees only their own and their own counts |
| admin | `/admin` — every survey, overall and per-agent counts, soft delete |

The first admin is seeded on boot from `ADMIN_NAME` / `ADMIN_PHONE` when the
users table is empty, because identity is picked from a list that cannot start
empty. That admin then creates the agents.

A survey records a doctor's chamber: hospital, location, availability slots,
chamber phone numbers, throughput, consultation fee, and a **required nameplate
photograph**. The doctor's name, degrees and specializations are left NULL for a
future OCR pass to fill from that photograph; `ocr_status` starts at `pending`.

**Migrating to real login** touches three places: `get_current_user` in
`app/core/deps.py` (read a verified token instead of the header), the `request()`
wrapper in `frontend/src/api.ts` (send `Authorization` instead of `X-User-Id`),
and `IdentityProvider` in `frontend/src/auth.tsx` (a login form instead of a
picker). No route, model, or page changes.

Deletion is soft: `deleted_at` is set and the nameplate stays in storage, so
field data remains auditable.

## Database migrations

Alembic owns the Postgres schema and runs `upgrade head` on boot, from the
application's own connection. The SQLite test database uses
`SQLModel.metadata.create_all` instead, which keeps `pytest` runnable on a bare
checkout with no compose stack up.

```bash
cd backend
uv run alembic revision --autogenerate -m "what changed"
```

`tests/test_migrations.py` asserts the migrations and the models agree, because
autogenerate drift is silent until a column is missing in production.

## Known gaps

- **No authentication.** See Roles above. `<RequireAdmin>` is a UX guard; the
  only enforcement is the server's 403.
- **No frontend test runner**, and `npm run lint` is a scaffold stub — ESLint is
  not installed. The frontend's real gate is `npm run build` (`tsc --noEmit` +
  Vite). Adding vitest and ESLint would be a worthwhile next step.
- **No CI.** The backend suite is deliberately infrastructure-free — SQLite plus
  a local moto S3 server — so a CI job would be `pytest` with no services block.
- **OCR is not implemented.** `ocr_status` is `pending` on every row, and
  `doctor_name` / `doctor_degrees` / `doctor_specializations` are always NULL.
- **`storage.delete_object` is unused** now that deletion is soft. Kept for a
  future retention or purge job.

## Layout

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
frontend/         Vite + React + TypeScript
caddy/Caddyfile   production reverse proxy + static SPA server
```

## Quick start (local)

```bash
cp .env.example .env
docker compose up --build
```

| Service          | URL                            |
| ---------------- | ------------------------------ |
| Frontend (HMR)   | http://localhost:5173          |
| Backend API docs | http://localhost:8000/docs     |
| Postgres         | `postgresql://app:app@localhost:5432/app` |
| RustFS console   | http://localhost:9001/rustfs/console/ |

Default RustFS credentials are `rustfsadmin` / `rustfsadmin`. Note the console
lives under `/rustfs/console/` — the root of port 9001 answers as the S3 API and
returns `AccessDenied` to an unauthenticated browser.

Both app services hot-reload: the frontend via Vite HMR, the backend via
`uvicorn --reload` over a bind-mounted `backend/app`.

### Running without Docker

```bash
cd backend && uv sync && uv run uvicorn app.main:app --reload
cd frontend && npm install && npm run dev
```

## API

Everything except health and `GET /api/users` needs an `X-User-Id` header.

| Method   | Path                        | Gate    | Notes                                     |
| -------- | --------------------------- | ------- | ----------------------------------------- |
| `GET`    | `/api/healthz`              | —       | Liveness; touches no dependencies          |
| `GET`    | `/api/readyz`               | —       | Per-dependency readiness report            |
| `GET`    | `/api/users`                | public  | Identity picker feed; never returns phones |
| `POST`   | `/api/users`                | admin   | Create an agent or another admin           |
| `PATCH`  | `/api/users/{id}`           | admin   | Toggle `is_active`                         |
| `GET`    | `/api/surveys`              | user    | The caller's own surveys only              |
| `POST`   | `/api/surveys`              | user    | `multipart/form-data`, nameplate required, 10MB cap |
| `GET`    | `/api/surveys/stats`        | user    | `{total, today}` for the caller            |
| `GET`    | `/api/surveys/{id}`         | user    | 404 — not 403 — when it is not the caller's |
| `GET`    | `/api/admin/surveys`        | admin   | Filter by `user_id`, `district`, `date_from`/`date_to`, `include_deleted` |
| `GET`    | `/api/admin/stats`          | admin   | Totals plus a per-agent breakdown          |
| `DELETE` | `/api/admin/surveys/{id}`   | admin   | **Soft** — sets `deleted_at`, keeps the object |

`slots` and `phones` are sent as JSON-encoded strings inside the multipart body,
because multipart cannot nest and the nameplate must ride in the same request.

Date filters and daily counts are both computed in `APP_TIMEZONE`, not UTC.

Nameplates are stored in RustFS and returned as **presigned URLs** (1h default).

## Deploying to Coolify

1. Create a **Docker Compose** resource pointing at this repo.
2. Set the compose file to `docker-compose.prod.yml`.
3. Deploy. Coolify generates, and you should not set by hand:
   - `SERVICE_FQDN_FRONTEND_80` — public domain routed to Caddy
   - `SERVICE_FQDN_RUSTFS_9000` / `SERVICE_URL_RUSTFS_9000` — public S3 domain
   - `SERVICE_FQDN_RUSTFS_9001` / `SERVICE_URL_RUSTFS_9001` — RustFS admin console
   - `SERVICE_PASSWORD_RUSTFS` — RustFS secret key, shared with the backend
   - `SERVICE_PASSWORD_POSTGRES` — database password, shared with the backend

Three public domains come out of this: the app (Caddy), the S3 API, and the
RustFS console. Postgres is the one service using a published port instead —
Coolify's proxy is HTTP-only and cannot front raw TCP.

### The RustFS console

Reach it at **`https://<SERVICE_FQDN_RUSTFS_9001>/rustfs/console/`** — note the
trailing path. The domain root answers as the S3 API and returns `AccessDenied`.

The whole domain is routed to port 9001 rather than a `/rustfs/console` subpath,
because the console loads its assets from that absolute prefix; a proxy that
strips the prefix serves the page but breaks every script on it.

Log in with `RUSTFS_ACCESS_KEY` (default `rustfsadmin`) and the generated
`SERVICE_PASSWORD_RUSTFS`. This console has full read/write access to every
bucket, so treat that password as production credentials.

### Why RustFS needs its own domain

Presigned URLs are opened **by the browser**, and SigV4 signs the hostname. The
backend therefore signs with `S3_PUBLIC_ENDPOINT_URL` (the public RustFS origin)
while performing its own uploads over the internal `S3_ENDPOINT_URL`. If you skip
the public domain, attachment links will point at the unreachable `rustfs:9000`.

## Configuration

Backend settings (env vars, see `backend/app/core/config.py`):

| Variable                 | Default                          | Purpose                          |
| ------------------------ | -------------------------------- | -------------------------------- |
| `DATABASE_URL`           | `postgresql+asyncpg://app:app@postgres:5432/app` | Database DSN     |
| `DB_POOL_SIZE`           | `5`                              | SQLAlchemy pool size             |
| `CORS_ORIGINS`           | `http://localhost:5173`          | Comma-separated; empty in prod   |
| `S3_ENDPOINT_URL`        | `http://rustfs:9000`             | Internal, server-side calls      |
| `S3_PUBLIC_ENDPOINT_URL` | *(falls back to the above)*      | Browser-facing, used to presign  |
| `S3_BUCKET`              | `uploads`                        | Auto-created on startup          |
| `S3_BOOTSTRAP`           | `true`                           | Set `false` to skip bucket setup |
| `PRESIGN_EXPIRY_SECONDS` | `3600`                           | Nameplate link lifetime          |
| `APP_TIMEZONE`           | `Asia/Dhaka`                     | Day boundary for all daily counts |
| `ADMIN_NAME`             | `Admin`                          | Seeded first admin's name        |
| `ADMIN_PHONE`            | `+8801700000000`                 | Seeded first admin's phone (E.164) |

### Connecting a GUI

Point TablePlus / DBeaver / DataGrip / psql at the published port:

```bash
psql postgresql://app:app@localhost:5432/app          # local
psql postgresql://app:PASSWORD@your-server:5432/app   # production
```

In production the port is published on the host, so it is reachable from the
internet and the password is the only thing protecting it. Use a strong one, and
restrict source IPs at your firewall or Coolify's server settings if you can.
Coolify generates the password as `SERVICE_PASSWORD_POSTGRES`; read it from the
resource's environment tab.

A Coolify *domain* cannot front Postgres — its proxy speaks HTTP, and Postgres is
raw TCP. Hence the published port rather than an FQDN.

## Tests & linting

```bash
cd backend && uv run pytest && uv run ruff check .   # SQLite + local moto S3; no stack needed
cd frontend && npm run build   # runs tsc --noEmit first
```

The backend suite needs no running services: it drives the app in-process over
`httpx.ASGITransport`, against SQLite, with a local moto server standing in for
RustFS. Moto runs as a real HTTP server rather than its in-process patching,
because that patching only intercepts calls aimed at AWS's own endpoints and
this app always points boto3 at a custom `endpoint_url`.

`npm run lint` is a scaffold stub — ESLint is not installed. See Known gaps.

## Notes on scaling

The backend is stateless, so it scales horizontally behind Caddy; Postgres holds
all shared state. Attachments live in RustFS, not on a container volume.

Schema is created with `SQLModel.metadata.create_all` on startup. That is fine for
a scaffold; add Alembic before you need real migrations.
