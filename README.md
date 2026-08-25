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

## Layout

```
backend/          FastAPI app (SQLModel + asyncpg + boto3)
  app/core/       settings (pydantic-settings)
  app/db/         async engine, session dependency, schema bootstrap
  app/models/     SQLModel tables
  app/schemas/    request/response models
  app/services/   S3/RustFS storage helpers
  app/api/        routers: health, submissions
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

| Method   | Path                       | Notes                              |
| -------- | -------------------------- | ---------------------------------- |
| `GET`    | `/api/healthz`             | Liveness; touches no dependencies   |
| `GET`    | `/api/readyz`              | Per-dependency readiness report     |
| `GET`    | `/api/submissions`         | `limit` (≤200) and `offset` params  |
| `POST`   | `/api/submissions`         | `multipart/form-data`, 10MB cap     |
| `GET`    | `/api/submissions/{id}`    |                                     |
| `DELETE` | `/api/submissions/{id}`    | Also removes the stored object      |

Attachments are stored in RustFS and returned as **presigned URLs** (1h default).

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
| `PRESIGN_EXPIRY_SECONDS` | `3600`                           | Attachment link lifetime         |

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
cd backend && uv run pytest && uv run ruff check .   # tests use SQLite, no server needed
cd frontend && npm run build   # runs tsc --noEmit first
```

## Notes on scaling

The backend is stateless, so it scales horizontally behind Caddy; Postgres holds
all shared state. Attachments live in RustFS, not on a container volume.

Schema is created with `SQLModel.metadata.create_all` on startup. That is fine for
a scaffold; add Alembic before you need real migrations.
