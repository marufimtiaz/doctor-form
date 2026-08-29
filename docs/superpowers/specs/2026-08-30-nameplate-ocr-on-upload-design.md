# Nameplate OCR on Upload Design Specification

## Overview

Today a nameplate is read *after* the survey is filed. This adds a second
method: read it *when the agent picks the photo*, so the doctor's name, degrees
and specialisations appear on the form while they are still standing in front of
the nameplate — and let them correct the model before anything is stored.

It also gives the agent two ways to supply that photo — pick an existing image,
or open the camera — since an agent standing at the nameplate is taking a
photo, not browsing a gallery.

Both methods stay:

- **Method A — after submit (exists).** `OCR_MODE=worker`: the row is filed
  `pending`, a poll loop claims it with `SKIP LOCKED` and fills the fields
  silently while the agent moves to the next doctor.
- **Method B — on upload (new).** The form posts the image to a preview
  endpoint, shows the three fields as editable inputs, and sends the agent's
  approved values with the survey.

B is tried first; A is the fallback whenever B does not produce anything.

## Decisions and rationale

### The extracted fields are editable

They land in real form fields, not a read-only preview. An agent looking at the
physical nameplate is the best corrector available, and fixing it there stops
bad OCR from ever reaching the database. `PATCH /admin/surveys/{id}/doctor`
already exists for what slips through.

### Submit reuses what was shown

When the form carries doctor fields, the row is stored `ocr_status="done"` and
no second model call is made. What the agent saw and approved is exactly what is
stored, and a nameplate costs one call rather than two.

### `ocr_source` records which path filled the row

A new nullable column taking `upload`, `worker` or `admin`. Without it there is
no way to answer "how often does the preview actually work?" or "did a human
approve this value or did a model guess it?" — and the second question matters
much more once agents are editing the values. Pre-existing rows stay `NULL`.

### `OCR_MODE=inline` is removed

`inline` runs the extraction inside the `POST /api/surveys` handler, after the
commit, blocking the agent's submit for up to `ocr_timeout_seconds` (60). It was
built reaching for what Method B does — reading the nameplate while the agent is
still there — but landed in the wrong place: it blocks the submit and the agent
still never sees the result, so the outcome is identical to `worker` at the cost
of a stalled form.

Method B does what it was aiming at, properly: the read happens on upload, the
agent sees it, and the submit stays instant. That leaves `inline` strictly worse
than both remaining modes, so it goes rather than lingering as a footgun someone
can switch on in production.

Nothing in the repo sets it — `.env.example:53` and both compose files default
to `worker` — so removal changes no running deployment.

`OCR_MODE` becomes `worker | off`.

Removal touches:

| File | Change |
|---|---|
| `core/config.py:126` | Validator accepts `worker`, `off` |
| `api/surveys.py:185-193` | Drop the inline block and its local import |
| `api/admin.py:183-186` | Drop it from `reread`; re-queueing alone is enough — the worker polls every `ocr_poll_seconds` (10s) |
| `tests/test_ocr_modes.py` | Drop the `inline_mode` fixture and its two tests |
| `README.md:209,275` | Drop `inline` from the mode list and table |
| `.env.example:51` | Drop `inline` from the comment |

**Keep the property, not the test.** `test_inline_failure_never_loses_the_survey`
asserts that a failing extraction never costs a filed survey — that still matters
under `worker`, so it is rewritten against the worker path rather than deleted
with the mode.

### Preview first, worker as fallback

A preview failure is not an error the agent has to deal with. The survey files
as `pending` and the existing worker reads it later, with the retry, backoff and
`ocr_error` tracking already on the row. No nameplate goes unread, and the agent
is never blocked waiting for a model.

## Non-goals

- No change to how the image reaches OpenRouter. It stays inline base64
  (`services/ocr.py:82-98`), for the reason recorded there: OpenRouter fetches
  URLs from its own servers and the presigned RustFS link is unreachable in dev.
- No image downscaling. Worth doing — a 10 MB photo becomes a ~13.6 MB request
  body — but it is a separate change that affects both methods equally.
- No rate limiting beyond the existing size cap. See "Cost and abuse".
- Method B is not a fourth `OCR_MODE`. It is a separate endpoint, disabled along
  with everything else by `OCR_MODE=off`.

## Architecture

### New endpoint — `POST /api/surveys/nameplate/preview`

Reads a nameplate and returns fields. Creates nothing.

- **Auth:** any authenticated user (`CurrentUser`), same as filing a survey.
- **Body:** multipart, one `nameplate` file.
- **Size cap:** the existing `MAX_UPLOAD_BYTES` (10 MB), 413 beyond it.
- **Does not touch S3 and does not create a row.** The bytes are read into
  memory, typed with `storage.sniff_image_type`, and passed to
  `extract_doctor_fields`. The image is uploaded once, at submit, as it is now.
- **Declare it above `/{survey_id}`**, next to `/stats`, which carries the
  comment explaining why. Two path segments mean it cannot actually collide with
  a one-segment route, but keeping the literal paths together is what stops the
  next literal route from being parsed as a UUID.

Responses:

| Condition | Status | Body |
|---|---|---|
| Fields read | 200 | `{doctor_name, doctor_degrees, doctor_specializations}`, any may be `null` |
| `OCR_MODE=off` | 204 | empty — the form simply shows nothing |
| Too large | 413 | detail |
| `OcrError` | 502 | short detail |

`extract_doctor_fields` already takes `(image, content_type, *, client)` and
knows nothing about surveys or the database — its docstring anticipates exactly
this caller — so no change is needed in the service layer.

### `SurveyCreate` accepts the approved fields

Three optional multipart form fields, mirroring the column limits:

```python
doctor_name: str | None = Field(default=None, max_length=200)
doctor_degrees: str | None = Field(default=None, max_length=1000)
doctor_specializations: str | None = Field(default=None, max_length=1000)
```

A `field_validator` turns blank or whitespace-only values into `None`, matching
the existing `_blank_is_absent` treatment of `city`/`district`.

In `create_survey`, **after** the row is built:

- If **any** of the three is non-`None`: store them, `ocr_status="done"`,
  `ocr_source="upload"`, `ocr_completed_at=now`.
- Otherwise: unchanged — `pending`, `ocr_source=None`, worker picks it up.

**All three empty is deliberately treated as "no preview".** A nameplate the
model could not read is then retried by the worker rather than being recorded as
a successful empty read. The cost is that a genuinely blank nameplate is read
twice; the benefit is that a failed preview is never mistaken for a finished one.

The alternative — trusting a client-sent "I ran the preview" flag — was rejected:
the client is the one thing here that cannot be trusted to describe what the
server did.

### `ocr_source` column

`ocr_source: str | None`, `max_length=16`, nullable, with a CHECK constraint in
the style of `ck_surveys_ocr_status`:

```
ck_surveys_ocr_source: ocr_source IN ('upload', 'worker', 'admin')
```

Written at exactly four points:

| Path | Value |
|---|---|
| Create with doctor fields | `upload` |
| Worker success (`workers/ocr.py`) | `worker` |
| `PATCH /admin/surveys/{id}/doctor` | `admin` |
| `POST /admin/surveys/{id}/reread` | reset to `NULL` — the row is re-queued |

Exposed on `SurveyRead` so admin can see it.

**Migration `0005_ocr_source.py`:** add the nullable column and the constraint.
No backfill — `NULL` correctly means "filed before this existed".

### `NameplateInput` — two ways to supply the photo

One `<input type="file">` stays the single source of the file. Two buttons drive
it; the hidden input's `capture` attribute is set immediately before `.click()`:

| Button | `capture` | Result |
|---|---|---|
| Upload image | removed | Normal picker: gallery, files, cloud |
| Open camera | `"environment"` | OS camera app, rear lens, returns the shot |

The bare file input is replaced by the two buttons, so the input is visually
hidden but still focusable-by-proxy through them.

**Why one input rather than two:** the existing reset works by clearing
`inputRef.current.value` when `file` becomes `null` (`NameplateInput.tsx:27-29`),
which is what lets an agent re-pick the same filename after a submit. Two inputs
would need two refs both cleared on every reset, and a missed one silently
breaks re-picking the same file.

**Desktop:** `capture` is ignored by desktop browsers, so "Open camera" degrades
to the same picker. Acceptable — the agents are on phones — and it needs no
branching.

**No `getUserMedia`.** A live in-app camera requires a secure context, so it
would not work over `http://` on the LAN dev setup — the same trap the GPS has.
`capture` is a plain file input and has no such requirement.

Both paths land in the existing `onChange`, so the 10 MB check and the OCR
preview trigger are shared and neither can be bypassed by picking one route.

### Frontend

**`api.ts`** — `previewNameplate(file: File): Promise<DoctorFields | null>`.
Posts multipart; `204` resolves to `null`; any non-2xx throws, as `request`
already does.

**`doctorSchema`** gains three optional strings, `.trim()`, defaulting to `""`,
capped at 200/1000/1000. They are part of the doctor half, so they reset with
each doctor and compose into `surveySchema` unchanged.

**`DoctorPage`** gains `ocrState: "idle" | "reading" | "done" | "failed"` and
renders a "Doctor details" block with three inputs plus a status line.

- Picking a nameplate starts a preview; `ocrState` goes `reading`.
- Success: `form.setValue` on the three fields, `ocrState = "done"`.
- Failure: `ocrState = "failed"`, fields left empty and editable, with a quiet
  line — *"Couldn't read the nameplate. It will be read after filing."* This is
  informational, not an error: the worker will handle it.
- Clearing the nameplate resets all three fields and `ocrState` to `idle`.
- Submitting while `reading` is allowed and does not wait. The fields are empty,
  so the row files as `pending` and the worker takes it.

**Race guard (required).** An agent can replace the photo while a call is in
flight, and the slower first response would otherwise overwrite the second
photo's fields. A monotonic request id in a ref is captured per call and
compared on return; a stale response is discarded. Without this the form can
silently show one nameplate's details beside a different nameplate's image —
which then gets stored as approved.

## Data flow

```
pick nameplate  (upload image | open camera)
   └─> POST /api/surveys/nameplate/preview   (no row, no S3 write)
             │
        ┌────┴────┐
     200│         │502 / timeout / 204
        ▼         ▼
  fields shown   quiet note
  editable       fields stay empty
        │         │
        └────┬────┘
             ▼
      submit doctor  ──> POST /api/surveys
             │
    ┌────────┴────────┐
 any field set     all empty
    ▼                 ▼
 status=done      status=pending
 source=upload    source=NULL
 no model call    worker reads it later -> source=worker
```

## Error handling

| Case | Behaviour |
|---|---|
| Preview fails or times out | Quiet note; survey files `pending`; worker reads it |
| Preview still running at submit | Submit proceeds; row files `pending` |
| `OCR_MODE=off` | 204; no doctor block shown at all |
| Photo replaced mid-flight | Stale response discarded by request id |
| Model returns all nulls | Treated as no preview; worker retries |
| Worker then fails 3× | `failed` + `ocr_error`, as today; admin can `reread` |
| Agent edits fields then clears photo | Fields cleared with the photo |
| Camera returns no photo (cancelled) | No change event; form untouched |
| Desktop "Open camera" | Falls back to the normal picker; `capture` ignored |

## Cost and abuse

Every photo selection costs one model call, and an agent flipping between photos
costs one each. Bounding it:

- `NameplateInput` already rejects oversized files client-side before any call.
- The endpoint enforces the same 10 MB cap server-side.
- `OCR_MODE=off` disables the endpoint outright.
- The call fires only when the selected file actually changes.

There is still no per-user rate limit on the endpoint, and a determined client
could call it in a loop. That is worth adding before this is exposed to a large
agent pool; it is out of scope here and recorded as a known gap.

## Testing

**Backend** (pytest + pytest-asyncio, matching `tests/test_ocr_modes.py`, with
`extract_doctor_fields` monkeypatched — no test calls OpenRouter):

1. Preview returns the three fields on success.
2. Preview returns 204 when `OCR_MODE=off`.
3. Preview returns 413 for an oversized upload.
4. Preview returns 502 when `extract_doctor_fields` raises `OcrError`.
5. Preview creates no `ChamberSurvey` row and writes nothing to S3.
6. Create **with** doctor fields → `ocr_status="done"`, `ocr_source="upload"`,
   and the row is never queued for the worker.
7. Create **with all three blank** → `pending`, `ocr_source is None`.
8. Create without them → `pending`, `ocr_source is None`.
9. Worker success sets `ocr_source="worker"`.
10. `PATCH /admin/surveys/{id}/doctor` sets `ocr_source="admin"`.
11. `POST /admin/surveys/{id}/reread` resets `ocr_source` to `None`.
12. Oversized `doctor_name` (>200 chars) is rejected by `SurveyCreate`.
13. Migration test covers the new column and constraint, per
    `tests/test_migrations.py`.
14. `OCR_MODE=inline` is rejected by the settings validator.
15. A failing extraction under `worker` still leaves the survey filed — the
    property rescued from `test_inline_failure_never_loses_the_survey`.

**Frontend** (vitest, node environment, pure functions only — the project has no
DOM tests):

16. `doctorSchema` accepts blank doctor fields and defaults them to `""`.
17. `doctorSchema` rejects a `doctor_name` over 200 characters.
18. `emptyDoctorValues()` still composes with `emptyHospitalValues()` into
    `emptySurveyValues()`.

`NameplateInput` has no pure logic to test — it is a file input and two buttons.
Both routes need the same manual pass: on a phone, confirm "Open camera" opens
the rear lens and "Upload image" opens the gallery, that cancelling either
leaves the form untouched, and that re-picking the same filename after a submit
still registers.

The race guard and the visual states are not covered by either suite and need a
manual pass: pick a photo, replace it before the first call returns, and confirm
the fields match the photo on screen.

**Full verification:** `pytest` in `backend/`, and `npx tsc --noEmit`,
`npx vitest run`, `npm run lint`, `npx vite build` in `frontend/`.
