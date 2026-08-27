# Nameplate OCR: doctor extraction via a vision model

**Date:** 2026-08-28
**Status:** approved design, pending implementation plan

## Problem

Agents photograph a doctor's nameplate on every survey. The photograph is the
only source of doctor identity — `doctor_name`, `doctor_degrees` and
`doctor_specializations` are deliberately not typed on site, and the earlier
design left them NULL with `ocr_status = 'pending'` for a step that did not
exist yet.

That step is this project. Until it lands, every admin row reads
"— nameplate pending", and every survey filed adds to a backlog that will have
to be processed later anyway.

## Decisions

### A vision model, via OpenRouter

Nameplates are photographed in corridor light, at an angle, mixing Bangla and
English, with dense degree abbreviations (`MBBS, FCPS (Medicine), MD`).
Classical OCR handles clean scans; this is not that. A vision language model
reads the layout and the abbreviations together.

`OCR_MODEL` defaults to `google/gemma-4-31b-it` and is an environment
variable, because neither the accuracy of `gemma-4-31b-it` nor
`gemma-4-26b-a4b-it` on real Bangladeshi nameplates can be known without
trying both, and swapping should not need a deploy.

At roughly $0.09 per million tokens, a nameplate costs on the order of
1,000 input and 100 output tokens: **about ten cents for ten thousand
surveys.** Cost does not constrain any decision here. The `:free` variants are
avoided in production because their rate limits turn a backlog into a stall.

### The image travels inline as base64, not as a URL

The obvious integration passes a presigned RustFS link as `image_url`. It does
not work: that URL is `localhost:9000` in development and an internal address
in production, and OpenRouter fetches images from its own servers. Making it
reachable would mean publishing the object store.

So the runner downloads the object server-side and sends a `data:` URI. This
costs bandwidth per extraction and requires a new `storage.download_object`
helper.

### Extraction is separated from scheduling

The mode may change: inline with submit, a background worker, or a detached
service. So "how to extract" and "when to run it" are different modules, and
the mode is configuration.

```
app/services/ocr.py        PURE. Knows OpenRouter and nothing else.
                           No database, no FastAPI, no survey concept.
app/workers/ocr_runner.py  SCHEDULING. Knows the database and the clock.
```

| `OCR_MODE` | Behaviour |
|---|---|
| `worker` (default) | the lifespan starts a poll loop |
| `inline` | `POST /api/surveys` extracts before returning |
| `off` | nothing runs in the API; rows stay `pending` |

Detaching later is `OCR_MODE=off` on the API plus a container running
`python -m app.workers.ocr` — a compose entry, not a rewrite, because the
runner has no HTTP dependency.

### Claim-then-work, not a long transaction

The tempting implementation holds `SELECT … FOR UPDATE SKIP LOCKED` open for
the whole call. That wraps a database transaction around a 5–60 second network
request, exhausting the connection pool and leaving idle-in-transaction
sessions.

Instead the runner marks a row `processing` and commits, works outside any
transaction, then writes the result. A process that dies mid-call would strand
the row, so a reaper returns `processing` rows older than `OCR_STALE_MINUTES`
to `pending`.

`SKIP LOCKED` on the claim means two API instances are two safe workers rather
than double processing.

### A missing API key is not a startup failure

Unlike `JWT_SECRET`, a missing `OPENROUTER_API_KEY` logs once and leaves the
worker idle. OCR enriches data; the system must keep collecting surveys
without it.

### Wrong answers are correctable

A vision model will misread. Worse, it will misread *confidently* — a degree
list read as `MBBS, FCFS` looks exactly like a success. So an admin can edit
the three fields and re-queue a survey for another attempt, with the nameplate
beside them as the thing to check against.

Self-reported confidence scoring was rejected: VLM confidence is poorly
calibrated, and a confidently wrong read reports high confidence, so the column
would add triage noise rather than signal.

## Data model

Migration `0003`:

```
chamber_surveys
  ocr_status         CHECK extended to
                       ('pending','processing','done','failed')
  + ocr_attempts      INTEGER NOT NULL DEFAULT 0
  + ocr_error         TEXT NULL           last failure, shown to the admin
  + ocr_started_at    TIMESTAMPTZ NULL    how the reaper finds crashed claims
  + ocr_completed_at  TIMESTAMPTZ NULL
```

The existing `ck_surveys_ocr_status` constraint is replaced, not added to.
`ocr_attempts` needs a `server_default` because the column is NOT NULL on a
populated table.

## Settings

| Setting | Default | Purpose |
|---|---|---|
| `OCR_MODE` | `worker` | `worker` \| `inline` \| `off` |
| `OPENROUTER_API_KEY` | `""` | empty disables extraction, loudly but harmlessly |
| `OCR_MODEL` | `google/gemma-4-31b-it` | swappable without a deploy |
| `OCR_POLL_SECONDS` | `10` | idle sleep between claims |
| `OCR_BATCH_SIZE` | `5` | rows claimed per pass |
| `OCR_MAX_ATTEMPTS` | `3` | then `failed` |
| `OCR_TIMEOUT_SECONDS` | `60` | per request |
| `OCR_STALE_MINUTES` | `15` | reaper threshold for `processing` |

## The extraction call

`POST https://openrouter.ai/api/v1/chat/completions`, one user message
combining a text instruction and an `image_url` part carrying the `data:` URI.

```python
class DoctorFields(BaseModel):
    doctor_name: str | None
    doctor_degrees: str | None
    doctor_specializations: str | None

async def extract_doctor_fields(image: bytes, content_type: str) -> DoctorFields
    # raises OcrError on transport, status, or parse failure
```

**The prompt instructs `null` rather than a guess** for anything the nameplate
does not show. A hallucinated degree list is worse than a blank one: nothing
downstream can tell it is wrong, and an admin checking against the photograph
is the only defence.

Parsing is deliberately tolerant, because models return prose and fenced JSON
regardless of instructions: strip code fences, take the first JSON object,
validate with Pydantic. A parse failure is retried once inside the call before
it becomes an `OcrError`.

Degrees and specializations are stored as the model returns them — free text,
matching the existing nullable columns. Structuring specializations was
deferred in the original design precisely until real extracted values existed;
this project produces those values but does not act on them.

## API

| Method | Route | Gate | Behaviour |
|---|---|---|---|
| PATCH | `/api/admin/surveys/{id}/doctor` | admin | Correct the three fields; sets `ocr_status='done'`, clears `ocr_error` |
| POST | `/api/admin/surveys/{id}/reread` | admin | Reset to `pending`, `ocr_attempts=0`; the worker picks it up |

`SurveyRead` gains `ocr_attempts` and `ocr_error` so the dashboard can explain
a failure. Neither is exposed on the agent's own routes — an agent sees the
name appear or not.

## Frontend

Admin dashboard only. The three doctor fields become editable beside the
nameplate thumbnail, with a **Re-read** button and, for `failed` rows, the
`ocr_error` text. `pending` and `processing` render as distinct states rather
than both reading as "pending".

The agent's page is untouched: their survey list already refetches, so the
name appears there within seconds of the worker finishing.

## Testing

The suite must keep running with no stack and no network, so
`extract_doctor_fields` is tested against an `httpx.MockTransport`. **No test
makes a real OpenRouter call.**

- **extraction** — clean JSON; JSON in a code fence; prose with no JSON;
  missing keys; explicit `null` fields preserved as `None`; HTTP 429; HTTP 500;
  a timeout. Each maps to a `DoctorFields` or an `OcrError`.
- **runner** — claims only `pending`; a second runner skips a claimed row;
  `ocr_attempts` increments on failure; the row becomes `failed` at
  `OCR_MAX_ATTEMPTS` with `ocr_error` populated; a success writes all three
  fields, `ocr_status='done'` and `ocr_completed_at`; the reaper returns a
  stale `processing` row to `pending` and leaves a fresh one alone.
- **modes** — `OCR_MODE=off` leaves a new survey `pending` with no call
  attempted; `OCR_MODE=inline` returns a survey with fields already filled.
- **API** — admin can PATCH the doctor fields and re-read; an agent gets 403
  from both; PATCH on an unknown id is 404.
- **key absent** — with `OPENROUTER_API_KEY` empty the worker does not start
  and no row is claimed.

## Explicitly out of scope

- Confidence scoring and "needs review" triage.
- Bulk re-read across many surveys.
- Extraction history — a re-read overwrites the previous values.
- Structuring `doctor_specializations` into a child table. That was deferred
  until real values existed; they will now exist, and the decision belongs to
  whoever looks at them.
- Rate limiting or cost caps against OpenRouter.
- OCR of anything other than the nameplate.
