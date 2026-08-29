# Hospital → Doctors Flow Design Specification

## Overview

Split the single survey form into a two-step flow so an agent enters a hospital
once and then files several doctors under it:

1. **Hospital page** (`/`) — hospital name, emergency service, location, phones.
2. **Doctor page** (`/doctors`) — nameplate, availability, patients/duration/fee.
   Submitting files one survey and immediately presents a blank doctor form for
   the next doctor at the same hospital.
3. **Exit hospital** returns to the hospital page to start a new hospital.

This is a **frontend-only** change. `POST /surveys` and every backend model,
schema and migration stay exactly as they are.

## Decisions and rationale

### No hospital entity in the database

The exported MongoDB shape is **flat doctor documents with hospital fields
repeated** — which is precisely what a `chamber_surveys` row already is, since
`hospital_name`, `city`, `district`, `latitude` and `longitude` are already
denormalized onto every row. A `hospitals` table, or even a grouping id, would
be schema investment in a database that is a staging store on the way to Mongo,
and would buy nothing the export needs.

The hospital therefore lives in **frontend state only** and is resent with each
doctor submission.

### Phones move to the hospital page

Entered once and copied to every doctor filed under that hospital.

**Known consequence, accepted:** existing rows and new rows will mean different
things — `phones` on an old row is that doctor's numbers, on a new row it is the
hospital's numbers repeated across its doctors. Nothing in the data distinguishes
the two, so "this doctor's direct line" is not recoverable after this change.
This was chosen deliberately; it exports cleanly to flat doctor documents.

### Two routes rather than one stepped page

`/` and `/doctors` rather than a `step` flag, so the phone back button returns to
the hospital page instead of leaving the app. Field agents work on phones, where
back is a primary navigation gesture.

### Hospital in progress survives a reload

Persisted to `localStorage`. An agent who loses the tab mid-hospital resumes
instead of retyping the hospital details.

## Non-goals

- No backend, API, schema or migration changes.
- No hospital deduplication, editing of a past hospital, or grouping key.
- No changes to `SlotEditor`, `LocationInput`, `NameplateInput`, `PhoneEditor`
  or the admin pages beyond where they are mounted.
- No DOM/component tests — the project deliberately has none
  (`frontend/vitest.config.ts`).

## Architecture

### Hospital session — `frontend/src/hospital.tsx` (new)

A React context owning the in-progress hospital.

```ts
interface HospitalDraft {
  hospital_name: string;
  has_emergency_service: boolean;
  city: string;
  district: string;
  latitude: string;
  longitude: string;
  phones: { value: string }[];
}

interface HospitalSession {
  hospital: HospitalDraft | null;
  doctorsAdded: number;
  startHospital: (draft: HospitalDraft) => void;
  recordDoctor: () => void;
  exitHospital: () => void;
}
```

- Both `hospital` and `doctorsAdded` are stored together under a single
  `localStorage` key, `doctor-form:hospital-session`, so the count survives a
  reload alongside the hospital.
- Hydrated once on mount inside a `useState` initializer, so the first render
  already has the restored value and no redirect flashes.
- Corrupt or unparseable stored JSON is discarded and treated as "no session";
  a bad entry must never wedge the agent on a broken screen.
- `exitHospital()` clears both the state and the stored key.
- `recordDoctor()` increments `doctorsAdded`, which is display-only.

### `HospitalPage` — `frontend/src/routes/HospitalPage.tsx` (new)

- Fields: `hospital_name`, `has_emergency_service`, `LocationInput`,
  `PhoneEditor`.
- Validated with `hospitalSchema`.
- On submit: `startHospital(values)` then `navigate("/doctors")`.
- Retains the existing stats cards, the "My surveys" list and the change-password
  card — this is the landing screen.
- If a hospital session already exists on mount, the form is **not** prefilled
  from it. Instead a banner offers "Continue with {hospital_name}" (navigates to
  `/doctors`) alongside the empty form for starting a different hospital;
  submitting the form replaces the stored session. Prefilling would make it
  ambiguous whether editing the fields amends the current hospital or begins a
  new one.
- `LocationInput` remounts naturally on each visit to this page, so every new
  hospital gets its own GPS fix - the concern the old `resetKey` existed to
  solve.

### `DoctorPage` — `frontend/src/routes/DoctorPage.tsx` (new)

- Guard: if `hospital === null`, `<Navigate to="/" replace />`.
- Header strip: current hospital name, `doctorsAdded` count, **Exit hospital**
  button (calls `exitHospital()` and navigates to `/`).
- Fields: `NameplateInput`, `SlotEditor`, `daily_patients`, `avg_duration_min`,
  `consultation_fee_bdt`. Validated with `doctorSchema`.
- On submit:
  1. Merge `hospital` + doctor values and parse once with `surveySchema`.
  2. Build the identical `FormData` the current `AgentPage.onSubmit` builds and
     `POST /surveys`.
  3. On success: `form.reset(emptyDoctorValues())`, clear the nameplate file
     state and bump `resetKey` to remount `NameplateInput` (the underlying
     `<input type="file">` retains its own value otherwise), `recordDoctor()`,
     toast, and stay on `/doctors` — this is the blank next-doctor form.
     `resetKey` no longer has anything to do with `LocationInput`, which now
     lives on the hospital page.
  4. On failure: toast the error and leave the entered values in place, so a
     network failure never costs the agent their typing.

### Routing — `frontend/src/App.tsx`

```
/          -> HospitalPage
/doctors   -> DoctorPage   (redirects to / when no hospital session)
/admin     -> AdminPage    (unchanged)
*          -> Navigate to /
```

`AgentPage.tsx` is removed; its contents are split across the two new pages.

## Data flow

```
HospitalPage submit
  └─> startHospital(draft) ──> context + localStorage
                                     │
                          navigate("/doctors")
                                     │
DoctorPage submit ──> surveySchema.parse({...hospital, ...doctor})
                                     │
                          FormData ──> POST /surveys   (unchanged endpoint)
                                     │
                     reset doctor fields, recordDoctor()
                                     │
                          blank form, same hospital
```

## Schema changes — `frontend/src/schemas/survey.ts`

Split the existing object, preserving every current rule:

- **`hospitalSchema`** — `hospital_name`, `has_emergency_service`, `city`,
  `district`, `latitude`, `longitude`, `phones`, and the existing `superRefine`
  location rule (coordinates or city+district, each all-or-nothing).
- **`doctorSchema`** — `slots`, `daily_patients`, `avg_duration_min`,
  `consultation_fee_bdt`.
- **`surveySchema`** — the merge of the two, keeping the location `superRefine`.
  It remains the single source of truth for the final parse before `POST`, so
  the request body stays byte-for-byte what the API accepts today.
- `emptySurveyValues()` splits into `emptyHospitalValues()` and
  `emptyDoctorValues()`.

`toBackendSlots`, `emptySlot`, `DAY_NAMES` and `DAY_NAME_TO_INT` are unchanged.

## Error handling

| Case | Behaviour |
|---|---|
| Corrupt `localStorage` payload | Discard, treat as no session, land on `/` |
| `/doctors` opened with no session | Redirect to `/` |
| Submit fails (network/validation) | Toast; entered values preserved |
| Missing nameplate | Existing inline `nameplateError`, unchanged |
| Reload mid-hospital | Session restored; agent continues |

## Testing

Pure-function tests only, in the project's existing style
(`src/**/*.test.ts`, node environment):

1. `hospitalSchema` + `doctorSchema` compose into a value `surveySchema` accepts.
2. The location rule still rejects latitude without longitude, and city without
   district, from `hospitalSchema`.
3. `hospitalSchema` rejects an empty `phones` array.
4. `doctorSchema` rejects an empty `slots` array and non-positive numerics.
5. Hospital-session serialization round-trips through `JSON.parse(JSON.stringify(draft))`.
6. A corrupt stored payload yields "no session" rather than throwing.

Full verification before completion: `npx tsc --noEmit`, `npx vitest run`,
`npm run lint`, `npx vite build`.
