# Authentication: phone + password with JWT

**Date:** 2026-08-26
**Status:** approved design, pending implementation plan
**Supersedes the identity stub in:** `2026-08-26-agent-admin-roles-design.md`

## Problem

The system has roles but no security. Identity is *selected*: the client sends
`X-User-Id` and the server believes it, so anyone can act as the admin by
editing one `localStorage` key. That was deliberate, and the earlier design put
the seam where real authentication would go. This project closes it.

Nothing about roles, scoping, or the survey model changes. `get_current_user`
keeps its signature and stays the only place identity is established.

## Decisions

### Phone + password, not SMS OTP

Login is the E.164 phone already stored as the unique key, plus a password
hashed with argon2id. OTP was rejected because it needs an SMS gateway, costs
per message, and fails exactly where these users work — agents survey hospital
chambers, often in basements with no signal. A password works offline.

### JWT, not server-side sessions

A stateless HS256 token, `Authorization: Bearer`, no sessions table.

The usual objection to JWTs is that they cannot be revoked. That objection is
weak *here*, because `get_current_user` already loads the user row on every
request — it needs `role` and `is_active`. So:

- **Deactivation still takes effect immediately.** `is_active` is checked on
  every request, exactly as it is today. `PATCH /api/users/{id}` keeps working.
- **Password changes invalidate existing tokens** through a `token_version`
  integer on the user, carried as a claim and compared against the row already
  loaded. No extra query, no denylist, no sessions table.

What remains genuinely unrevokable: nothing that matters operationally. A
stolen token stops working the moment the user is deactivated or their password
is changed.

### Thirty-day tokens, no refresh token

One long-lived token. A refresh-token pair exists to shrink the window in which
a leaked access token is useful — but here that window is already closed by the
two checks above, so the machinery (a refresh endpoint, rotation, reuse
detection, a client-side retry queue) would buy very little for a lot of code.

### Admin sets the first password

`POST /api/users` requires a password. The admin hands it over out of band and
the user changes it from their own page. `POST /api/users/{id}/reset-password`
covers a forgotten one.

Self-service claiming was rejected outright: it lets anyone who knows a
colleague's registered phone number seize that account first — including an
admin account.

A forced change on first login was rejected as disproportionate. It needs a
`must_change_password` flag, a route guard that blocks every endpoint except
one, and a blocking interstitial screen, to defend against an admin who already
has full access to all the data anyway.

### Existing users are not grandfathered in

`password_hash` is nullable and the four existing rows get NULL. A user with no
hash cannot log in; an admin must set their password first. Nothing is silently
migrated into a logged-in state.

## Data model

```
users  (existing table, three columns added)
  + password_hash    VARCHAR(255) NULL   argon2id; NULL = cannot log in yet
  + password_set_at  TIMESTAMPTZ  NULL
  + token_version    INTEGER NOT NULL DEFAULT 1
```

Alembic revision `0002`. No new tables.

`token_version` is bumped by exactly two operations — self change-password and
admin reset-password — and by nothing else.

## Tokens

HS256. Payload:

| Claim | Meaning |
|---|---|
| `sub` | user id, as a string UUID |
| `ver` | the user's `token_version` at issue time |
| `iat` | issued at |
| `exp` | `iat + access_token_ttl_days` (default 30) |

`app/core/security.py` holds every cryptographic primitive, so nothing else in
the codebase touches hashing or signing:

```python
def hash_password(raw: str) -> str
def verify_password(raw: str, hashed: str) -> bool
def create_access_token(user_id: UUID, token_version: int) -> str
def decode_access_token(token: str) -> dict   # raises ValueError when invalid
```

Dependencies: `argon2-cffi` for hashing, `pyjwt` for tokens.

### The secret must not have a working default

A shipped default signing secret means anyone can forge an admin token. The
application **refuses to start** when `debug` is false and `jwt_secret` is still
the development value — a loud failure at deploy time rather than a silent hole.

## Authentication flow

`get_current_user` keeps its signature and its role as the only seam:

```python
async def get_current_user(session, authorization: Annotated[str | None, Header()]) -> User:
    # 401 when: header missing or not "Bearer <token>"
    #           signature invalid, malformed, or expired
    #           sub is not a known user
    #           user.is_active is False
    #           user.token_version != payload["ver"]
```

All five failures return 401 with a generic message. `require_admin` is
unchanged.

## API

| Method | Route | Gate | Behaviour |
|---|---|---|---|
| POST | `/api/auth/login` | public | `{phone, password}` → `{access_token, token_type: "bearer", user}`, where `user` is `UserPublic` |
| GET | `/api/auth/me` | user | The authenticated user, as `UserPublic` |
| POST | `/api/auth/change-password` | user | `{current_password, new_password}`; bumps `token_version` and returns a **fresh token**, so the caller is not logged out by their own change |
| POST | `/api/users/{id}/reset-password` | admin | `{password}`; bumps that user's `token_version`, logging them out everywhere |
| POST | `/api/users` | admin | now requires `password` |
| GET | `/api/users` | **admin** | **was public** |
| PATCH | `/api/users/{id}` | admin | unchanged |

Everything under `/api/surveys` and `/api/admin` is unchanged apart from
carrying a Bearer token instead of `X-User-Id`.

### `GET /api/users` stops being public

It existed to feed the identity picker. With a login form there is no picker,
and a public roster of every registered person is a list of valid login names
for an attacker. It becomes admin-only.

### Login does not reveal which phones are registered

An unknown phone and a wrong password return the **same** 401 with the same
message. Differing responses turn the login form into an account-enumeration
oracle. Login also runs the argon2 verification against a dummy hash when the
phone is unknown, so the two paths take comparable time.

### Password rules

Minimum 8 characters, maximum 128 (argon2 handles long input, but an unbounded
password is a denial-of-service vector). No composition rules — length is what
matters, and complexity requirements push people toward predictable patterns.

`UserPublic` is unchanged — `id`, `name`, `company`, `role`, `is_active`. It
gains no credential fields, so `password_hash`, `password_set_at`, and
`token_version` are never serialised anywhere.

## Seeding

| Setting | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Password for the seeded first admin. |
| `DEMO_PASSWORD` | Password given to the demo agents. Only read when `SEED_DEMO_DATA` is true. |

**`ADMIN_PASSWORD` gets the same startup guard as `jwt_secret`.** If the seeded
admin were created with a NULL hash, nobody could log in and nobody could create
a user who could — an unrecoverable deadlock needing direct database access to
escape. So it has a development default, and the application refuses to start
when `debug` is false and the value is still that default.

`SEED_DEMO_DATA` stays pinned off in production, so `DEMO_PASSWORD` never
applies there.

## Frontend

| File | Change |
|---|---|
| `src/auth.tsx` | `IdentityProvider` → `AuthProvider`; the picker is replaced by `LoginPage`. Stores a token under `doctor-form.token`, not a user id. Exposes `{ user, loading, login, logout }`. |
| `src/api.ts` | `X-User-Id` → `Authorization: Bearer`. **Any 401 clears the token and sends the user to `/login`** — one place that covers expiry, deactivation, and password change alike. |
| `src/routes/LoginPage.tsx` | New. Phone + password form. |
| `src/routes/AgentPage.tsx` | Gains an "Account" section for changing your own password. |
| `src/routes/AdminPage.tsx` | Password field in "Add an agent"; a reset control per user. |
| `src/App.tsx` | New `/login` route; unauthenticated users are sent there. |

`RequireAdmin` stays, and its comment changes: it is no longer merely a UX
guard, because the role now comes from a signed token rather than a value the
client chose. The server's 403 remains the real enforcement.

## Errors

| Condition | Status | Client |
|---|---|---|
| Bad phone or bad password | 401 | "Phone or password is incorrect" |
| No `Authorization` header, or malformed | 401 | clear token → `/login` |
| Expired or invalid signature | 401 | clear token → `/login` |
| User deactivated | 401 | clear token → `/login` |
| `token_version` mismatch (password changed) | 401 | clear token → `/login` |
| Agent calling an admin route | 403 | redirect to `/` |
| `current_password` wrong on change | 401 | inline form error |
| New password shorter than 8 | 422 | inline form error |

## Testing

- **login** — correct credentials return a usable token; wrong password and
  unknown phone return byte-identical 401 bodies; a user with `password_hash`
  NULL cannot log in
- **token validity** — a valid token authenticates; a token signed with the
  wrong secret is rejected; an expired token is rejected; a malformed
  `Authorization` header is rejected
- **revocation** — deactivating a user rejects their existing token on the next
  request; changing a password rejects tokens issued before the change; the
  fresh token returned by change-password works immediately
- **admin reset** — an admin resetting a user's password invalidates that
  user's existing token, and the admin's own token keeps working
- **authorization** — `GET /api/users` returns 403 for an agent; every
  `/api/admin/*` route still returns 403 for an agent
- **passwords** — under 8 characters rejected; over 128 rejected; the stored
  hash is argon2id and is never returned in any response body
- **seeding** — the seeded admin can log in with `ADMIN_PASSWORD`; demo agents
  can log in with `DEMO_PASSWORD`
- **startup guard** — `debug=False` with the default `jwt_secret` raises rather
  than booting, and likewise for the default `ADMIN_PASSWORD`

## Explicitly out of scope

- **Rate limiting on `/api/auth/login`.** There is nothing stopping an attacker
  guessing passwords as fast as the network allows. Argon2 makes each attempt
  expensive, which helps but does not substitute for a limiter. This belongs
  with rate limiting across the whole API, not bolted onto one endpoint.
- Password reset by the user themselves (no email or SMS channel exists).
- Refresh tokens, token rotation, "log out everywhere" as an explicit action
  (an admin password reset already achieves it).
- Multi-factor authentication.
- Audit logging of login attempts.
