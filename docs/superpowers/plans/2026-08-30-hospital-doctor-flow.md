# Hospital → Doctors Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the survey form into a hospital step and a repeating doctor step, so an agent enters a hospital once and then files several doctors under it.

**Architecture:** Frontend-only. The hospital lives in a React context backed by `localStorage` and is resent with every doctor submission; `POST /surveys` and the entire backend are untouched. Two routes (`/` hospital, `/doctors` doctor) so the phone back button returns to the hospital page.

**Tech Stack:** React 19, react-hook-form 7.86, zod 3.25, react-router-dom 7, Tailwind 4, vitest 4 (node environment, no DOM tests).

**Spec:** `docs/superpowers/specs/2026-08-30-hospital-doctor-flow-design.md`

## Global Constraints

- No backend, API, schema or migration changes. `POST /surveys` accepts exactly what it accepts today.
- No DOM or component tests. `frontend/vitest.config.ts` sets `environment: "node"` and `include: ["src/**/*.test.ts"]` deliberately. Only `.test.ts` files with pure functions.
- All work happens in `frontend/`. Run commands from `frontend/`.
- Verification for every task: `npx tsc --noEmit` (exit 0), `npx vitest run` (all pass), `npm run lint` (exit 0), `npx vite build` (exit 0).
- The existing 23 tests in `src/schemas/survey.test.ts` must keep passing untouched — they are the regression guard for the schema split.
- Import order convention: external packages first, blank line, then `@/` imports.
- Commit messages: conventional commits, and end with the two trailer lines used in this repo's history.

## File Structure

| File | Responsibility |
|---|---|
| `src/schemas/survey.ts` (modify) | Adds `hospitalSchema`, `doctorSchema` and their types/defaults beside the existing `surveySchema` |
| `src/lib/hospitalSession.ts` (create) | Pure serialize/parse of the stored session — the testable half |
| `src/lib/hospitalSession.test.ts` (create) | Tests for the above |
| `src/hospital.tsx` (create) | React context + `localStorage` side effects |
| `src/routes/HospitalPage.tsx` (create) | Hospital step, stats, survey list, account card |
| `src/routes/DoctorPage.tsx` (create) | Doctor step, submit loop |
| `src/components/LocationInput.tsx` (modify) | Retyped to `HospitalForm` |
| `src/components/PhoneEditor.tsx` (modify) | Retyped to `HospitalForm` |
| `src/components/SlotEditor.tsx` (modify) | Retyped to `DoctorForm` |
| `src/App.tsx` (modify) | Routes |
| `src/main.tsx` (modify) | Mounts `HospitalProvider` |
| `src/routes/AgentPage.tsx` (delete) | Split across the two new pages |

---

### Task 1: Split the survey schema

**Files:**
- Modify: `frontend/src/schemas/survey.ts`
- Test: `frontend/src/schemas/survey.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `hospitalSchema`, `doctorSchema`, `surveySchema` (unchanged behaviour), types `HospitalForm`, `DoctorForm`, `SurveyForm`, `SurveyOutput`, and factories `emptyHospitalValues(): HospitalForm`, `emptyDoctorValues(): DoctorForm`, `emptySurveyValues(): SurveyForm`.

**Critical gotcha:** `z.object(...).superRefine(...)` returns a `ZodEffects`, which has no `.merge()`. The two schemas must therefore be built from shared **shape objects**, not by merging finished schemas.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/schemas/survey.test.ts`:

```ts
describe("schema split", () => {
  const hospital = {
    hospital_name: "Square Hospital",
    has_emergency_service: false,
    city: "Dhaka",
    district: "Dhaka",
    latitude: "",
    longitude: "",
    phones: [{ value: "01712345678" }],
  };
  const doctor = {
    daily_patients: "30",
    avg_duration_min: "10",
    consultation_fee_bdt: "800",
    slots: [emptySlot()],
  };

  it("composes into a value surveySchema accepts", () => {
    expect(surveySchema.safeParse({ ...hospital, ...doctor }).success).toBe(true);
  });

  it("accepts the hospital half on its own", () => {
    expect(hospitalSchema.safeParse(hospital).success).toBe(true);
  });

  it("accepts the doctor half on its own", () => {
    expect(doctorSchema.safeParse(doctor).success).toBe(true);
  });

  it("still rejects half a coordinate pair from hospitalSchema", () => {
    const bad = { ...hospital, city: "", district: "", latitude: "23.8" };
    expect(hospitalSchema.safeParse(bad).success).toBe(false);
  });

  it("still rejects city without district from hospitalSchema", () => {
    const bad = { ...hospital, district: "" };
    expect(hospitalSchema.safeParse(bad).success).toBe(false);
  });

  it("requires at least one phone on the hospital half", () => {
    expect(hospitalSchema.safeParse({ ...hospital, phones: [] }).success).toBe(false);
  });

  it("requires at least one slot group on the doctor half", () => {
    expect(doctorSchema.safeParse({ ...doctor, slots: [] }).success).toBe(false);
  });

  it("rejects zero patients per day on the doctor half", () => {
    expect(doctorSchema.safeParse({ ...doctor, daily_patients: "0" }).success).toBe(false);
  });

  it("builds empty values that compose back into surveySchema shape", () => {
    const composed = { ...emptyHospitalValues(), ...emptyDoctorValues() };
    expect(composed).toEqual(emptySurveyValues());
  });
});
```

Update the import at the top of the file to:

```ts
import {
  doctorSchema,
  emptyDoctorValues,
  emptyHospitalValues,
  emptySlot,
  emptySurveyValues,
  hospitalSchema,
  surveySchema,
  toBackendSlots,
} from "./survey";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/schemas/survey.test.ts`
Expected: FAIL — `doctorSchema`, `hospitalSchema`, `emptyHospitalValues`, `emptyDoctorValues` are not exported.

- [ ] **Step 3: Split the schema**

In `frontend/src/schemas/survey.ts`, replace the `surveySchema` declaration and everything from it down to `emptySurveyValues` with:

```ts
const locationRule = (
  v: { latitude: string; district: string; city: string; longitude: string },
  ctx: z.RefinementCtx,
) => {
  // Mirrors ck_surveys_location and the backend's SurveyCreate validator:
  // either precise coordinates or a named place, each all-or-nothing.
  const hasLat = v.latitude.trim() !== "";
  const hasLng = v.longitude.trim() !== "";
  const hasCity = v.city.trim() !== "";
  const hasDistrict = v.district.trim() !== "";

  if (hasLat !== hasLng) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["longitude"],
      message: "Give both latitude and longitude, or neither.",
    });
  }
  if (hasCity !== hasDistrict) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["district"],
      message: "Give both city and district, or neither.",
    });
  }
  if (!hasLat && !hasCity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["city"],
      message: "Provide coordinates or city and district.",
    });
  }
};

// Shapes rather than finished schemas: z.object().superRefine() returns a
// ZodEffects, which cannot be merged, so the combined schema has to be built
// from the raw shapes.
const hospitalShape = {
  hospital_name: z.string().trim().min(1, "Hospital name is required.").max(200),
  has_emergency_service: z.boolean().default(false),

  city: z.string().max(100).default(""),
  district: z.string().max(100).default(""),
  latitude: z
    .string()
    .default("")
    .refine(
      (v) => v.trim() === "" || (Number(v) >= -90 && Number(v) <= 90),
      "Latitude must be between -90 and 90.",
    ),
  longitude: z
    .string()
    .default("")
    .refine(
      (v) => v.trim() === "" || (Number(v) >= -180 && Number(v) <= 180),
      "Longitude must be between -180 and 180.",
    ),

  // useFieldArray needs objects, not bare strings.
  phones: z
    .array(z.object({ value: z.string().trim().min(1, "Enter a number.") }))
    .min(1, "Add at least one phone number."),
};

const doctorShape = {
  daily_patients: numeric("Enter a number.", (n) =>
    n.int().positive("Must be more than zero."),
  ),
  avg_duration_min: numeric("Enter a number.", (n) =>
    n.int().positive("Must be more than zero."),
  ),
  consultation_fee_bdt: numeric("Enter a number.", (n) =>
    n.int().min(0, "Cannot be negative."),
  ),

  slots: z.array(slotSchema).min(1, "Add at least one availability slot."),
};

export const hospitalSchema = z.object(hospitalShape).superRefine(locationRule);
export const doctorSchema = z.object(doctorShape);
export const surveySchema = z
  .object({ ...hospitalShape, ...doctorShape })
  .superRefine(locationRule);

export type HospitalForm = z.input<typeof hospitalSchema>;
export type DoctorForm = z.input<typeof doctorSchema>;
export type SurveyForm = z.input<typeof surveySchema>;
export type SurveyOutput = z.output<typeof surveySchema>;

export function toBackendSlots(
  slots: z.infer<typeof slotSchema>[],
): { day_of_week: number; start_time: string; end_time: string }[] {
  return slots.flatMap((slot) =>
    slot.days.flatMap((day) =>
      slot.ranges.map((range) => ({
        day_of_week: DAY_NAME_TO_INT[day],
        start_time: range.start_time,
        end_time: range.end_time,
      })),
    ),
  );
}

export const emptySlot = () => ({
  days: ["Sat"] as DayName[],
  ranges: [{ ...EVENING_CHAMBER }],
});

export const emptyHospitalValues = (): HospitalForm => ({
  hospital_name: "",
  has_emergency_service: false,
  city: "",
  district: "",
  latitude: "",
  longitude: "",
  phones: [{ value: "" }],
});

export const emptyDoctorValues = (): DoctorForm => ({
  daily_patients: "",
  avg_duration_min: "",
  consultation_fee_bdt: "",
  slots: [emptySlot()],
});

export const emptySurveyValues = (): SurveyForm => ({
  ...emptyHospitalValues(),
  ...emptyDoctorValues(),
});
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS — the 9 new tests plus all 23 pre-existing `surveySchema` tests, which are unchanged and prove the split preserved behaviour.

- [ ] **Step 5: Verify types and build**

Run: `npx tsc --noEmit && npm run lint && npx vite build`
Expected: all exit 0. `AgentPage.tsx` still compiles because `SurveyForm` and `emptySurveyValues` kept their names and shapes.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/survey.ts src/schemas/survey.test.ts
git commit -m "refactor(schemas): split survey schema into hospital and doctor halves

Built from shared shape objects rather than merged schemas, because
z.object().superRefine() returns a ZodEffects with no .merge(). surveySchema
keeps its exact previous behaviour and remains the single source of truth for
the final parse before POST.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 2: Hospital session storage

**Files:**
- Create: `frontend/src/lib/hospitalSession.ts`
- Test: `frontend/src/lib/hospitalSession.test.ts`

**Interfaces:**
- Consumes: `HospitalForm` from Task 1.
- Produces: `HOSPITAL_SESSION_KEY: string`, `interface StoredSession { hospital: HospitalForm; doctorsAdded: number }`, `serializeSession(session: StoredSession): string`, `parseStoredSession(raw: string | null): StoredSession | null`.

This file holds no `localStorage` calls. Keeping the serialization pure is what makes it testable in the node environment; the browser side lives in Task 3.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/hospitalSession.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  parseStoredSession,
  serializeSession,
  type StoredSession,
} from "@/lib/hospitalSession";

const session: StoredSession = {
  hospital: {
    hospital_name: "Square Hospital",
    has_emergency_service: true,
    city: "Dhaka",
    district: "Dhaka",
    latitude: "",
    longitude: "",
    phones: [{ value: "01712345678" }],
  },
  doctorsAdded: 2,
};

describe("parseStoredSession", () => {
  it("round-trips a session through serialize", () => {
    expect(parseStoredSession(serializeSession(session))).toEqual(session);
  });

  it("returns null for a missing key", () => {
    expect(parseStoredSession(null)).toBeNull();
  });

  it("returns null for text that is not JSON", () => {
    expect(parseStoredSession("not json at all")).toBeNull();
  });

  it("returns null for JSON that is not an object", () => {
    expect(parseStoredSession("42")).toBeNull();
  });

  it("returns null when the hospital is missing", () => {
    expect(parseStoredSession(JSON.stringify({ doctorsAdded: 1 }))).toBeNull();
  });

  it("returns null when the hospital has no name", () => {
    const bad = { ...session, hospital: { ...session.hospital, hospital_name: "" } };
    expect(parseStoredSession(JSON.stringify(bad))).toBeNull();
  });

  it("falls back to a zero count when doctorsAdded is not a number", () => {
    const odd = { ...session, doctorsAdded: "many" };
    expect(parseStoredSession(JSON.stringify(odd))?.doctorsAdded).toBe(0);
  });

  it("falls back to a zero count when doctorsAdded is negative", () => {
    const odd = { ...session, doctorsAdded: -3 };
    expect(parseStoredSession(JSON.stringify(odd))?.doctorsAdded).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/hospitalSession.test.ts`
Expected: FAIL — cannot resolve `@/lib/hospitalSession`.

- [ ] **Step 3: Write the implementation**

Create `frontend/src/lib/hospitalSession.ts`:

```ts
import type { HospitalForm } from "@/schemas/survey";

/** One key holds the whole session, so the doctor count cannot drift away
 *  from the hospital it belongs to. */
export const HOSPITAL_SESSION_KEY = "doctor-form:hospital-session";

export interface StoredSession {
  hospital: HospitalForm;
  doctorsAdded: number;
}

export function serializeSession(session: StoredSession): string {
  return JSON.stringify(session);
}

/** Anything unrecognisable is treated as "no session" rather than throwing.
 *  A bad entry written by an older build must never wedge an agent on a
 *  screen they cannot get past. */
export function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const { hospital, doctorsAdded } = parsed as Partial<StoredSession>;

  if (!hospital || typeof hospital !== "object") return null;
  if (typeof hospital.hospital_name !== "string" || hospital.hospital_name === "") {
    return null;
  }

  return {
    hospital,
    doctorsAdded:
      typeof doctorsAdded === "number" && Number.isFinite(doctorsAdded) && doctorsAdded >= 0
        ? doctorsAdded
        : 0,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: PASS, all files.

- [ ] **Step 5: Verify types, lint and build**

Run: `npx tsc --noEmit && npm run lint && npx vite build`
Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hospitalSession.ts src/lib/hospitalSession.test.ts
git commit -m "feat(hospital): add pure serialization for the hospital session

Kept free of localStorage so it is testable in the node environment the
project uses. A corrupt or unrecognisable payload parses to null rather than
throwing, so a bad entry cannot wedge an agent on a broken screen.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 3: Hospital session context

**Files:**
- Create: `frontend/src/hospital.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `HOSPITAL_SESSION_KEY`, `parseStoredSession`, `serializeSession`, `StoredSession` from Task 2; `HospitalForm` from Task 1.
- Produces: `HospitalProvider({ children }: { children: ReactNode })` and `useHospital(): HospitalSession` where

```ts
interface HospitalSession {
  hospital: HospitalForm | null;
  doctorsAdded: number;
  startHospital: (draft: HospitalForm) => void;
  recordDoctor: () => void;
  exitHospital: () => void;
}
```

This mirrors `src/auth.tsx`, which is the established pattern for a context in this codebase. There is no test step: this file is React glue, and the project has no DOM tests. Its testable half was Task 2.

- [ ] **Step 1: Write the provider**

Create `frontend/src/hospital.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  HOSPITAL_SESSION_KEY,
  parseStoredSession,
  serializeSession,
  type StoredSession,
} from "@/lib/hospitalSession";
import type { HospitalForm } from "@/schemas/survey";

interface HospitalSession {
  hospital: HospitalForm | null;
  doctorsAdded: number;
  startHospital: (draft: HospitalForm) => void;
  recordDoctor: () => void;
  exitHospital: () => void;
}

const HospitalContext = createContext<HospitalSession | null>(null);

// Storage access is wrapped: a browser in private mode, or with site data
// blocked, throws on access rather than returning null. The session then lives
// in memory for the tab, which still gets the agent through one hospital.
function readSession(): StoredSession | null {
  try {
    return parseStoredSession(localStorage.getItem(HOSPITAL_SESSION_KEY));
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null): void {
  try {
    if (session) {
      localStorage.setItem(HOSPITAL_SESSION_KEY, serializeSession(session));
    } else {
      localStorage.removeItem(HOSPITAL_SESSION_KEY);
    }
  } catch {
    // Storage unavailable; in-memory state is still correct.
  }
}

export function HospitalProvider({ children }: { children: ReactNode }) {
  // Lazy initializer, so the very first render already has the restored
  // session and the /doctors guard never flashes a redirect.
  const [session, setSession] = useState<StoredSession | null>(readSession);

  const startHospital = useCallback((draft: HospitalForm) => {
    const next: StoredSession = { hospital: draft, doctorsAdded: 0 };
    setSession(next);
    writeSession(next);
  }, []);

  const recordDoctor = useCallback(() => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, doctorsAdded: prev.doctorsAdded + 1 };
      writeSession(next);
      return next;
    });
  }, []);

  const exitHospital = useCallback(() => {
    setSession(null);
    writeSession(null);
  }, []);

  const value = useMemo(
    () => ({
      hospital: session?.hospital ?? null,
      doctorsAdded: session?.doctorsAdded ?? 0,
      startHospital,
      recordDoctor,
      exitHospital,
    }),
    [session, startHospital, recordDoctor, exitHospital],
  );

  return (
    <HospitalContext.Provider value={value}>{children}</HospitalContext.Provider>
  );
}

export function useHospital(): HospitalSession {
  const ctx = useContext(HospitalContext);
  if (!ctx) throw new Error("useHospital must be used inside HospitalProvider");
  return ctx;
}
```

- [ ] **Step 2: Mount the provider**

In `frontend/src/main.tsx`, add the import beside the existing `@/auth` import:

```tsx
import { HospitalProvider } from "@/hospital";
```

and wrap `<App />` inside `<AuthProvider>`:

```tsx
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <HospitalProvider>
          <App />
        </HospitalProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run lint && npx vite build`
Expected: all exit 0, all tests pass. `npm run lint` will report one **warning** for `react-refresh/only-export-components` on `hospital.tsx`, because it exports a hook beside a component — exactly as `src/auth.tsx` already does. Warnings do not fail the build; do not "fix" this by splitting the file.

- [ ] **Step 4: Commit**

```bash
git add src/hospital.tsx src/main.tsx
git commit -m "feat(hospital): add hospital session context

Holds the in-progress hospital and its doctor count, restored from
localStorage in a lazy useState initializer so the first render already has
it and the /doctors guard never flashes. Follows the shape of src/auth.tsx.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

### Task 4: Switch the flow

**Files:**
- Create: `frontend/src/routes/HospitalPage.tsx`
- Create: `frontend/src/routes/DoctorPage.tsx`
- Modify: `frontend/src/components/LocationInput.tsx` (2 lines)
- Modify: `frontend/src/components/PhoneEditor.tsx` (2 lines)
- Modify: `frontend/src/components/SlotEditor.tsx` (2 lines)
- Modify: `frontend/src/App.tsx`
- Delete: `frontend/src/routes/AgentPage.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `HospitalPage` and `DoctorPage` default exports.

**Why this is one task:** the three shared inputs are typed `Control<SurveyForm>` today. Retyping them to `HospitalForm`/`DoctorForm` breaks `AgentPage`, and `AgentPage` cannot be deleted before the pages that replace it exist. A reviewer could not accept half of this without leaving the app with two homes or a red build.

- [ ] **Step 1: Retype the hospital-side inputs**

In `frontend/src/components/LocationInput.tsx`, change the type import and both prop annotations from `SurveyForm` to `HospitalForm`:

```ts
import type { HospitalForm } from "@/schemas/survey";
```

```ts
export default function LocationInput({
  control,
  setValue,
  getValues,
}: {
  control: Control<HospitalForm>;
  setValue: UseFormSetValue<HospitalForm>;
  getValues: UseFormGetValues<HospitalForm>;
}) {
```

In `frontend/src/components/PhoneEditor.tsx`:

```ts
import type { HospitalForm } from "@/schemas/survey";
```

```ts
export default function PhoneEditor({
  control,
}: {
  control: Control<HospitalForm>;
}) {
```

- [ ] **Step 2: Retype the doctor-side input**

In `frontend/src/components/SlotEditor.tsx`, change the `SurveyForm` type import to `DoctorForm` and update the three prop annotations:

```ts
import {
  DAY_NAMES,
  emptySlot,
  type DayName,
  type DoctorForm,
} from "@/schemas/survey";
```

```ts
export default function SlotEditor({
  control,
  setValue,
  getValues,
}: {
  control: Control<DoctorForm>;
  setValue: UseFormSetValue<DoctorForm>;
  getValues: UseFormGetValues<DoctorForm>;
}) {
```

Everything else in the file is unchanged: `slots` exists on `DoctorForm`, so `` getValues(`slots.${slotIndex}.ranges`) `` and the `` `slots.${index}.days` `` field paths still resolve.

At this point `npx tsc --noEmit` **will fail** on `AgentPage.tsx`. That is expected and is fixed by Step 5.

- [ ] **Step 3: Create HospitalPage**

Create `frontend/src/routes/HospitalPage.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  changePassword,
  listMySurveys,
  myStats,
  TOKEN_KEY,
  type Stats,
  type Survey,
} from "@/api";
import LocationInput from "@/components/LocationInput";
import ChangePasswordForm from "@/components/PasswordForm";
import PhoneEditor from "@/components/PhoneEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useHospital } from "@/hospital";
import { describePlace, describeSlot } from "@/lib/formatters";
import {
  emptyHospitalValues,
  hospitalSchema,
  type HospitalForm,
} from "@/schemas/survey";

export default function HospitalPage() {
  const navigate = useNavigate();
  const { hospital, doctorsAdded, startHospital } = useHospital();

  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load must not read as an empty list: an agent with 40 surveys
  // being told they have none is worse than an error message.
  const [loadError, setLoadError] = useState<string | null>(null);

  const form = useForm<HospitalForm>({
    resolver: zodResolver(hospitalSchema),
    defaultValues: emptyHospitalValues(),
  });

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([myStats(), listMySurveys()]);
      setStats(s);
      setMine(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function onSubmit(values: HospitalForm) {
    startHospital(values);
    navigate("/doctors");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">New hospital</h1>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : !stats ? (
            <Alert variant="destructive" className="col-span-2">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>Could not load your counts.</span>
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Card className="py-4">
                <CardContent className="text-center">
                  <div className="text-2xl font-semibold">{stats.today}</div>
                  <div className="text-xs text-muted-foreground">filed today</div>
                </CardContent>
              </Card>
              <Card className="py-4">
                <CardContent className="text-center">
                  <div className="text-2xl font-semibold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">in total</div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </section>

      {hospital && (
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {hospital.hospital_name} is still open
              {doctorsAdded > 0
                ? ` with ${doctorsAdded} doctor${doctorsAdded > 1 ? "s" : ""} filed`
                : ""}
              .
            </span>
            <Button size="sm" onClick={() => navigate("/doctors")}>
              Continue with {hospital.hospital_name}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="hospital_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Hospital name</FormLabel>
                    <FormControl>
                      <Input maxLength={200} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="has_emergency_service"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-sm font-medium">
                      Emergency Service (12am afterwards)
                    </FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-2 pt-0.5">
                        <Button
                          type="button"
                          variant={field.value ? "default" : "outline"}
                          size="sm"
                          className="h-8 px-4 text-xs font-semibold"
                          onClick={() => field.onChange(true)}
                        >
                          Yes
                        </Button>
                        <Button
                          type="button"
                          variant={!field.value ? "default" : "outline"}
                          size="sm"
                          className="h-8 px-4 text-xs font-semibold"
                          onClick={() => field.onChange(false)}
                        >
                          No
                        </Button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <LocationInput
                control={form.control}
                setValue={form.setValue}
                getValues={form.getValues}
              />
              <PhoneEditor control={form.control} />

              <Button type="submit" className="w-full sm:w-auto">
                Start adding doctors
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">My surveys</h2>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>Could not load your surveys: {loadError}</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing filed yet.</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((s) => (
              <li key={s.id}>
                <Card>
                  <CardContent className="space-y-1 p-4 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.hospital_name}</span>
                        {s.has_emergency_service && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                            🚨 Emergency Service
                          </span>
                        )}
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString()}
                      </time>
                    </div>
                    <div className="text-muted-foreground">{describePlace(s)}</div>
                    <div className="text-muted-foreground">
                      {s.slots.map(describeSlot).join(" · ")}
                    </div>
                    <div className="text-muted-foreground">{s.phones.join(" · ")}</div>
                    <div className="text-muted-foreground">
                      {s.daily_patients}/day · {s.avg_duration_min} min · ৳
                      {s.consultation_fee_bdt}
                    </div>
                    {s.nameplate_url && (
                      <a
                        className="text-primary underline underline-offset-4"
                        href={s.nameplate_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View nameplate
                      </a>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Account</h2>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm
              submitLabel="Change password"
              onSubmit={async (next, current) => {
                const resp = await changePassword(current, next);
                // The change bumps token_version, so the token we hold is now
                // dead. Storing the replacement keeps this session alive while
                // every other device is signed out.
                localStorage.setItem(TOKEN_KEY, resp.access_token);
                toast.success("Password changed.");
              }}
            />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Create DoctorPage**

Create `frontend/src/routes/DoctorPage.tsx`:

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { createSurvey } from "@/api";
import NameplateInput from "@/components/NameplateInput";
import SlotEditor from "@/components/SlotEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useHospital } from "@/hospital";
import {
  doctorSchema,
  emptyDoctorValues,
  surveySchema,
  toBackendSlots,
  type DoctorForm,
} from "@/schemas/survey";

export default function DoctorPage() {
  const navigate = useNavigate();
  const { hospital, doctorsAdded, recordDoctor, exitHospital } = useHospital();

  const [nameplate, setNameplate] = useState<File | null>(null);
  const [nameplateError, setNameplateError] = useState<string | null>(null);
  // Remounts NameplateInput after each submit: an <input type="file"> keeps
  // its own value, so clearing the File state alone leaves the old filename
  // showing under the next doctor's form.
  const [resetKey, setResetKey] = useState(0);

  const form = useForm<DoctorForm>({
    resolver: zodResolver(doctorSchema),
    defaultValues: emptyDoctorValues(),
  });

  if (!hospital) return <Navigate to="/" replace />;

  async function onSubmit(values: DoctorForm) {
    if (!hospital) return;
    if (!nameplate) {
      setNameplateError("A nameplate photo is required.");
      return;
    }
    setNameplateError(null);

    // The hospital half and the doctor half are disjoint, so this reassembles
    // exactly the object surveySchema has always validated.
    const parsed = surveySchema.parse({ ...hospital, ...values });

    const body = new FormData();
    body.set("hospital_name", parsed.hospital_name);
    body.set("has_emergency_service", String(parsed.has_emergency_service));
    body.set("daily_patients", String(parsed.daily_patients));
    body.set("avg_duration_min", String(parsed.avg_duration_min));
    body.set("consultation_fee_bdt", String(parsed.consultation_fee_bdt));
    // Multipart cannot nest, so these travel as JSON strings. Phones are
    // objects in the form because useFieldArray requires objects; the API
    // wants bare strings.
    body.set("slots", JSON.stringify(toBackendSlots(parsed.slots)));
    body.set("phones", JSON.stringify(parsed.phones.map((p) => p.value)));
    body.set("nameplate", nameplate);
    if (parsed.city.trim()) body.set("city", parsed.city.trim());
    if (parsed.district.trim()) body.set("district", parsed.district.trim());
    if (parsed.latitude.trim()) body.set("latitude", parsed.latitude.trim());
    if (parsed.longitude.trim()) body.set("longitude", parsed.longitude.trim());

    try {
      await createSurvey(body);
      form.reset(emptyDoctorValues());
      setNameplate(null);
      setResetKey((n) => n + 1);
      recordDoctor();
      toast.success("Doctor filed. Next doctor?");
    } catch (err) {
      // Values stay put: a network failure must not cost the agent their typing.
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {hospital.hospital_name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {doctorsAdded === 0
              ? "No doctors filed yet"
              : `${doctorsAdded} doctor${doctorsAdded > 1 ? "s" : ""} filed here`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            exitHospital();
            navigate("/");
          }}
        >
          Exit hospital
        </Button>
      </section>

      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <NameplateInput
                key={resetKey}
                file={nameplate}
                onChange={(f) => {
                  setNameplate(f);
                  // Otherwise the destructive "required" text sits under a
                  // perfectly valid image until the next submit attempt.
                  if (f) setNameplateError(null);
                }}
                error={nameplateError}
              />

              <SlotEditor
                control={form.control}
                setValue={form.setValue}
                getValues={form.getValues}
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="daily_patients"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Patients per day</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          {...field}
                          value={(field.value as string | number) ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="avg_duration_min"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minutes per patient</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          {...field}
                          value={(field.value as string | number) ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="consultation_fee_bdt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Fee (BDT)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          value={(field.value as string | number) ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Filing…" : "File doctor and add another"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 5: Point the routes at the new pages and delete AgentPage**

In `frontend/src/App.tsx`, replace the `AgentPage` import with the two new pages:

```tsx
import AdminPage from "@/routes/AdminPage";
import DoctorPage from "@/routes/DoctorPage";
import HospitalPage from "@/routes/HospitalPage";
import LoginPage from "@/routes/LoginPage";
```

and replace the `/` route with:

```tsx
      <Routes>
        <Route path="/" element={<HospitalPage />} />
        <Route path="/doctors" element={<DoctorPage />} />
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
```

In the `Header`, change the first nav link's label so it matches where it goes:

```tsx
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Hospital</Link>
          </Button>
```

Then delete the old page:

```bash
git rm frontend/src/routes/AgentPage.tsx
```

- [ ] **Step 6: Verify the whole tree**

Run: `npx tsc --noEmit && npx vitest run && npm run lint && npx vite build`
Expected: all exit 0, 44 tests pass (23 pre-existing + 9 from Task 1 + 8 from Task 2, plus the 12 in `shifts.test.ts` and 4 in `password.test.ts` — confirm the reported total against the run rather than this arithmetic). Lint reports only the pre-existing warnings plus the one on `hospital.tsx`.

Confirm nothing still references the deleted page:

```bash
grep -rn "AgentPage\|emptySurveyValues" frontend/src || echo "no stale references"
```

Expected: `emptySurveyValues` may still appear in `src/schemas/survey.ts` (its definition) and its test. No `AgentPage` hits.

- [ ] **Step 7: Smoke-test the real flow**

```bash
npx vite build && npx vite preview --port 4173
```

Log in as `01711000001` / `demo-password` and confirm:
1. `/` shows the hospital form; submitting it lands on `/doctors`.
2. Filing a doctor clears the form, keeps the hospital header, and increments the count.
3. Reloading `/doctors` keeps the hospital.
4. "Exit hospital" returns to `/` and a reload no longer offers to continue.
5. Visiting `/doctors` with no hospital redirects to `/`.

- [ ] **Step 8: Commit**

```bash
git add src/routes/HospitalPage.tsx src/routes/DoctorPage.tsx \
        src/components/LocationInput.tsx src/components/PhoneEditor.tsx \
        src/components/SlotEditor.tsx src/App.tsx
git commit -m "feat(survey): split the form into a hospital step and a doctor loop

An agent enters a hospital once, then files doctors under it one after
another; submitting keeps the hospital and presents a blank doctor form.
Exit hospital clears the session and returns to the hospital step.

The hospital and doctor halves are disjoint, so DoctorPage reassembles them
and parses with surveySchema before POST - the request body is exactly what
POST /surveys already accepted, and the backend is untouched.

The three shared inputs are retyped to the half they belong to, which is why
this lands as one commit: retyping them breaks AgentPage, and AgentPage
cannot go until the pages replacing it exist.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01D5Yv8PhL7nFwU4yHhppLCe"
```

---

## Self-Review

**Spec coverage:** hospital session with `startHospital`/`recordDoctor`/`exitHospital` and single-key storage → Tasks 2–3. `HospitalPage` fields, continue banner without prefill, retained stats/list/account → Task 4 Step 3. `DoctorPage` guard, header, submit loop, `resetKey` for `NameplateInput` → Task 4 Step 4. Routing and `AgentPage` deletion → Task 4 Step 5. Schema split → Task 1. All six spec test cases are covered: 1–4 in Task 1 Step 1, 5–6 in Task 2 Step 1.

**Known deviation from the spec:** the spec's `HospitalDraft` interface is not introduced; `HospitalForm` from the schema is used directly, since it is structurally identical and a second name for the same shape would be a drift risk.

**Type consistency:** `HospitalForm`/`DoctorForm` as defined in Task 1 are the types consumed in Tasks 2–4. `StoredSession` is defined in Task 2 and consumed in Task 3. `useHospital()` returns the five members used by both pages. `emptyDoctorValues()` is used for both the initial `defaultValues` and the post-submit reset.
