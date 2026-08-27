# shadcn/ui Visual Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written stylesheet with Tailwind v4 and shadcn/ui, move form state onto react-hook-form with tested zod schemas, and give the frontend a considered clinical identity.

**Architecture:** Foundation lands first — Tailwind without preflight, theme tokens, the `@/` alias, shadcn primitives, and zod schemas with a vitest suite. Screens then migrate one commit at a time on top of it. The final commit enables real preflight and deletes `index.css`, so every intermediate commit is a working application.

**Tech Stack:** Tailwind v4 (`@tailwindcss/vite`), shadcn/ui (new-york, slate base), react-hook-form, zod 3, `@hookform/resolvers`, sonner, lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-08-27-shadcn-visual-overhaul-design.md`

## Global Constraints

- **No feature, route, or backend changes.** The backend's 116 tests must stay green throughout; a failure there means something leaked across the boundary.
- Every commit passes `npm run build` (`tsc --noEmit` then `vite build`) **and** `npm test` (vitest).
- **No webfont.** System font stack only. Character comes from colour, density and hierarchy.
- **Preflight stays off** until the final task. The compatibility layer in Task 1 supplies only what shadcn needs; nothing else from the reset.
- Primary `#0f766e` (teal), neutrals slate, destructive `#b91c1c`, radius `0.5rem`.
- **zod pinned to `^3`.** zod 4 moved `ctx.addIssue` and the issue-code constants; every schema here uses the v3 API.
- Dark mode follows `prefers-color-scheme` via shadcn's `.dark` convention. No manual toggle.
- Client validation is a UX affordance, never a security boundary — the server rejects everything independently.
- Each screen is checked at a **375px viewport**; the agent form is used one-handed on a phone.

### Docker note, needed by every task that installs a package

`docker-compose.yml` mounts `./frontend:/app` **and an anonymous volume over `/app/node_modules`**, so a host-side `npm install` is invisible to the running container. After adding any dependency:

```bash
docker compose up --build -d frontend
```

Skipping this produces `Failed to resolve import` errors in the browser while the host build succeeds — a confusing split-brain worth avoiding.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/index.css` | Theme tokens, layer imports, compatibility layer, and (temporarily) the legacy stylesheet |
| `src/lib/utils.ts` | `cn()` — the one helper every shadcn component imports |
| `src/components/ui/*` | shadcn primitives, generated; not hand-edited |
| `src/schemas/survey.ts` | The survey form's shape and rules |
| `src/schemas/auth.ts` | Login |
| `src/schemas/password.ts` | Change and reset |
| `src/schemas/user.ts` | Admin creating an agent |
| `src/schemas/*.test.ts` | vitest, mirroring `backend/tests/test_survey_schemas.py` |
| `components.json`, `vitest.config.ts` | Tooling config |

Application components keep their current file boundaries and prop names. Only
their internals change.

---

## Task 1: Foundation — Tailwind, alias, theme, primitives

**Files:**
- Create: `frontend/components.json`, `frontend/src/lib/utils.ts`, `frontend/src/components/ui/*`
- Modify: `frontend/vite.config.ts`, `frontend/tsconfig.json`, `frontend/src/index.css`, `frontend/package.json`
- Test: `npm run build` + a visual smoke check

**Interfaces:**
- Consumes: nothing.
- Produces: `cn()` from `@/lib/utils`; the shadcn primitives listed below, importable from `@/components/ui/<name>`; CSS custom properties `--primary`, `--background`, `--foreground`, `--muted-foreground`, `--border`, `--card`, `--destructive`, `--ring`, `--radius`.

- [ ] **Step 1: Install the styling dependencies**

```bash
cd frontend
npm install tailwindcss @tailwindcss/vite clsx tailwind-merge class-variance-authority lucide-react
```

- [ ] **Step 2: Add the alias to `tsconfig.json`**

Inside `compilerOptions`, after `"types"`:

```json
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
```

- [ ] **Step 3: Add the Tailwind plugin and alias to `vite.config.ts`**

Replace the imports and the `plugins` line:

```ts
import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The shadcn CLI and every generated component import from "@/...".
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
```

Leave `server`, `proxy` and `build` exactly as they are.

- [ ] **Step 4: Create `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges class names and resolves Tailwind conflicts, so a caller's
 *  `className` can override a component's own utilities. Every shadcn
 *  primitive imports this. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 5: Put the theme at the top of `src/index.css`**

Insert this **above** the existing `:root` block. Do not delete anything yet —
the legacy stylesheet stays until Task 7.

```css
/* Tailwind, imported by layer with preflight deliberately omitted.
   The full `@import "tailwindcss"` also pulls in preflight.css, whose reset
   would strip the base element styles the legacy stylesheet below still
   relies on. Task 7 swaps this for the real import. */
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);

:root {
  --radius: 0.5rem;

  --background: #f8fafc;
  --foreground: #0f172a;
  --card: #ffffff;
  --card-foreground: #0f172a;
  --popover: #ffffff;
  --popover-foreground: #0f172a;

  /* Teal, not the stock blue: clinical without being sterile, and it holds
     up on a dim phone screen in a hospital corridor. */
  --primary: #0f766e;
  --primary-foreground: #f0fdfa;

  --secondary: #f1f5f9;
  --secondary-foreground: #0f172a;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --accent: #ccfbf1;
  --accent-foreground: #134e4a;

  --destructive: #b91c1c;
  --destructive-foreground: #fef2f2;

  --border: #e2e8f0;
  --input: #e2e8f0;
  --ring: #0f766e;
}

.dark {
  --background: #0b1120;
  --foreground: #e2e8f0;
  --card: #111827;
  --card-foreground: #e2e8f0;
  --popover: #111827;
  --popover-foreground: #e2e8f0;

  --primary: #2dd4bf;
  --primary-foreground: #042f2e;

  --secondary: #1e293b;
  --secondary-foreground: #e2e8f0;
  --muted: #1e293b;
  --muted-foreground: #94a3b8;
  --accent: #134e4a;
  --accent-foreground: #ccfbf1;

  --destructive: #f87171;
  --destructive-foreground: #450a0a;

  --border: #1e293b;
  --input: #1e293b;
  --ring: #2dd4bf;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-lg: var(--radius);
  --radius-md: calc(var(--radius) - 2px);
  --radius-sm: calc(var(--radius) - 4px);
  /* No webfont: agents work on poor connections, and a font that blocks
     first paint is paid for by exactly the people who can least afford it. */
  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
}

/* The three properties shadcn actually depends on from preflight, and nothing
   else. Tailwind's `border` utility sets border-width but relies on preflight
   for `border-style: solid`; without this every Card, Input and Separator
   would render with no visible border. Deleted in Task 7. */
@layer base {
  *,
  ::before,
  ::after {
    box-sizing: border-box;
    border-width: 0;
    border-style: solid;
    border-color: var(--color-border);
  }
}
```

- [ ] **Step 6: Follow the system colour scheme**

shadcn keys dark mode off a `.dark` class, and this app has no toggle. Add to
`src/main.tsx`, immediately after the `root` null check:

```tsx
// No manual toggle by design; mirror the OS preference onto the class shadcn
// expects, and keep following it if the user changes it mid-session.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = (matches: boolean) =>
  document.documentElement.classList.toggle("dark", matches);
applyTheme(dark.matches);
dark.addEventListener("change", (e) => applyTheme(e.matches));
```

- [ ] **Step 7: Create `components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 8: Generate the primitives**

```bash
cd frontend
npx shadcn@latest add button input label card form select table badge \
  separator alert dialog alert-dialog dropdown-menu skeleton sonner --yes
```

This also installs the Radix packages, react-hook-form, zod and
`@hookform/resolvers` as transitive requirements of `form`. Pin zod to v3
afterwards, because the schemas in Task 2 use the v3 issue API:

```bash
npm install zod@^3
```

- [ ] **Step 9: Verify the build and the container**

```bash
cd frontend && npm run build
cd .. && docker compose up --build -d frontend
```

Expected: build succeeds. Open `http://localhost:5173` — the app still looks
exactly as it did, because no screen uses a primitive yet. That is the point:
the foundation is in and nothing regressed.

- [ ] **Step 10: Commit**

```bash
git add frontend/
git commit -m "feat(ui): Tailwind v4 foundation, theme tokens, shadcn primitives

Preflight is deliberately omitted so the existing stylesheet keeps working
while screens migrate; a minimal compatibility layer supplies the border and
box-sizing rules shadcn depends on."
```

---

## Task 2: Schemas and the first frontend tests

**Files:**
- Create: `frontend/vitest.config.ts`, `frontend/src/schemas/{survey,auth,password,user}.ts`, `frontend/src/schemas/{survey,password}.test.ts`
- Modify: `frontend/package.json`
- Test: `npm test`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `surveySchema`, `type SurveyForm`, `emptySlot()`, `emptySurveyValues()` from `@/schemas/survey`
  - `loginSchema`, `type LoginForm` from `@/schemas/auth`
  - `changePasswordSchema`, `setPasswordSchema`, `type ChangePasswordForm`, `type SetPasswordForm` from `@/schemas/password`
  - `createUserSchema`, `type CreateUserForm` from `@/schemas/user`

**Shape note that every later task depends on:** `useFieldArray` requires arrays
of **objects**, so the form's phones are `{ value: string }[]`, not `string[]`.
They are flattened back to `string[]` at submit time in Task 5.

- [ ] **Step 1: Add the test scripts**

In `frontend/package.json`, in `scripts`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

Then install the runner:

```bash
cd frontend && npm install -D vitest
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    // Schemas are pure functions. No jsdom, no component rendering - the
    // markup is what this project churns, so DOM tests written now would be
    // rewritten twice.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Write the failing tests**

Create `frontend/src/schemas/survey.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { emptySlot, surveySchema } from "./survey";

/** A valid form, minus location - each test supplies its own. */
const base = {
  hospital_name: "Square Hospital",
  latitude: "",
  longitude: "",
  city: "",
  district: "",
  daily_patients: "30",
  avg_duration_min: "10",
  consultation_fee_bdt: "1200",
  slots: [emptySlot()],
  phones: [{ value: "01712345678" }],
};

const parse = (overrides: Record<string, unknown> = {}) =>
  surveySchema.safeParse({ ...base, ...overrides });

const messages = (result: ReturnType<typeof parse>) =>
  result.success ? [] : result.error.issues.map((i) => i.message);

describe("location", () => {
  it("accepts coordinates alone", () => {
    expect(parse({ latitude: "23.75", longitude: "90.39" }).success).toBe(true);
  });

  it("accepts city and district alone", () => {
    expect(parse({ city: "Dhaka", district: "Dhanmondi" }).success).toBe(true);
  });

  it("accepts both pairs together", () => {
    const result = parse({
      latitude: "23.75",
      longitude: "90.39",
      city: "Dhaka",
      district: "Dhanmondi",
    });
    expect(result.success).toBe(true);
  });

  it("rejects neither pair", () => {
    expect(messages(parse())).toContain("Provide coordinates or city and district.");
  });

  it("rejects half a coordinate pair", () => {
    expect(messages(parse({ latitude: "23.75" }))).toContain(
      "Give both latitude and longitude, or neither.",
    );
  });

  it("rejects half a place pair", () => {
    expect(messages(parse({ city: "Dhaka" }))).toContain(
      "Give both city and district, or neither.",
    );
  });

  it("does not let whitespace satisfy the requirement", () => {
    expect(parse({ city: "   ", district: "   " }).success).toBe(false);
  });

  it("rejects an out-of-range latitude", () => {
    expect(parse({ latitude: "120", longitude: "90.39" }).success).toBe(false);
  });
});

describe("slots", () => {
  const withCity = { city: "Dhaka", district: "Dhanmondi" };

  it("requires at least one", () => {
    expect(parse({ ...withCity, slots: [] }).success).toBe(false);
  });

  it("rejects an end at or before the start", () => {
    const slots = [{ day_of_week: 5, start_time: "20:00", end_time: "17:00" }];
    expect(messages(parse({ ...withCity, slots }))).toContain(
      "End must be after start.",
    );
  });

  it("rejects a day outside 0-6", () => {
    const slots = [{ day_of_week: 7, start_time: "17:00", end_time: "20:00" }];
    expect(parse({ ...withCity, slots }).success).toBe(false);
  });
});

describe("phones and numbers", () => {
  const withCity = { city: "Dhaka", district: "Dhanmondi" };

  it("requires at least one phone", () => {
    expect(parse({ ...withCity, phones: [] }).success).toBe(false);
  });

  it("rejects a blank phone", () => {
    expect(parse({ ...withCity, phones: [{ value: "  " }] }).success).toBe(false);
  });

  it("rejects zero patients per day", () => {
    expect(parse({ ...withCity, daily_patients: "0" }).success).toBe(false);
  });

  it("rejects a negative fee", () => {
    expect(parse({ ...withCity, consultation_fee_bdt: "-1" }).success).toBe(false);
  });

  it("allows a free consultation", () => {
    expect(parse({ ...withCity, consultation_fee_bdt: "0" }).success).toBe(true);
  });

  it("coerces numeric strings from the inputs", () => {
    const result = parse(withCity);
    expect(result.success && result.data.daily_patients).toBe(30);
  });
});
```

Create `frontend/src/schemas/password.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { changePasswordSchema, setPasswordSchema } from "./password";

describe("changePasswordSchema", () => {
  const valid = {
    current_password: "the-old-one",
    new_password: "a-long-enough-one",
    confirm_password: "a-long-enough-one",
  };

  it("accepts a matching pair", () => {
    expect(changePasswordSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a mismatch, on the confirm field", () => {
    const result = changePasswordSchema.safeParse({
      ...valid,
      confirm_password: "something-else",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["confirm_password"]);
    }
  });

  it("rejects a password under 8 characters", () => {
    const short = { ...valid, new_password: "short", confirm_password: "short" };
    expect(changePasswordSchema.safeParse(short).success).toBe(false);
  });

  it("rejects a password over 128 characters", () => {
    const long = "x".repeat(129);
    const result = changePasswordSchema.safeParse({
      ...valid,
      new_password: long,
      confirm_password: long,
    });
    expect(result.success).toBe(false);
  });
});

describe("setPasswordSchema", () => {
  it("needs no current password", () => {
    const result = setPasswordSchema.safeParse({
      new_password: "a-long-enough-one",
      confirm_password: "a-long-enough-one",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd frontend && npm test`
Expected: FAIL — `Cannot find module './survey'`

- [ ] **Step 5: Create `src/schemas/survey.ts`**

```ts
import { z } from "zod";

/** Text inputs give strings; the API wants numbers. Coercing here keeps the
 *  form fields plain and the parsed output correctly typed. */
const numeric = (message: string) =>
  z.coerce.number({ invalid_type_error: message });

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const slotSchema = z
  .object({
    // 0=Monday .. 6=Sunday, matching the backend and datetime.weekday().
    day_of_week: z.coerce.number().int().min(0).max(6),
    start_time: z.string().min(1, "Start time is required."),
    end_time: z.string().min(1, "End time is required."),
  })
  .refine((slot) => slot.end_time > slot.start_time, {
    message: "End must be after start.",
    path: ["end_time"],
  });

export const surveySchema = z
  .object({
    hospital_name: z.string().trim().min(1, "Hospital name is required.").max(200),

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

    daily_patients: numeric("Enter a number.")
      .int()
      .positive("Must be more than zero."),
    avg_duration_min: numeric("Enter a number.")
      .int()
      .positive("Must be more than zero."),
    consultation_fee_bdt: numeric("Enter a number.")
      .int()
      .min(0, "Cannot be negative."),

    slots: z.array(slotSchema).min(1, "Add at least one availability slot."),
    // useFieldArray needs objects, not bare strings.
    phones: z
      .array(z.object({ value: z.string().trim().min(1, "Enter a number.") }))
      .min(1, "Add at least one phone number."),
  })
  .superRefine((v, ctx) => {
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
  });

export type SurveyForm = z.input<typeof surveySchema>;

export const emptySlot = () => ({
  day_of_week: 5, // Saturday - the usual first working day here.
  start_time: "17:00",
  end_time: "20:00",
});

export const emptySurveyValues = (): SurveyForm => ({
  hospital_name: "",
  city: "",
  district: "",
  latitude: "",
  longitude: "",
  daily_patients: "",
  avg_duration_min: "",
  consultation_fee_bdt: "",
  slots: [emptySlot()],
  phones: [{ value: "" }],
});

// Referenced so the helper is not flagged unused; blank strings are handled
// by the trims above rather than a preprocessor.
void blankToUndefined;
```

- [ ] **Step 6: Create `src/schemas/auth.ts`**

```ts
import { z } from "zod";

export const loginSchema = z.object({
  phone: z.string().trim().min(1, "Enter your phone number."),
  // Deliberately no length rule. Rejecting a short password here would tell
  // an attacker their guess was not even the right shape.
  password: z.string().min(1, "Enter your password."),
});

export type LoginForm = z.infer<typeof loginSchema>;
```

- [ ] **Step 7: Create `src/schemas/password.ts`**

```ts
import { z } from "zod";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const password = z
  .string()
  .min(PASSWORD_MIN, `Must be at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Must be at most ${PASSWORD_MAX} characters.`);

const matching = <T extends { new_password: string; confirm_password: string }>(
  values: T,
  ctx: z.RefinementCtx,
) => {
  if (values.new_password !== values.confirm_password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirm_password"],
      message: "The two passwords do not match.",
    });
  }
};

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Enter your current password."),
    new_password: password,
    confirm_password: z.string(),
  })
  .superRefine(matching);

/** An admin setting somebody else's password: no current password needed. */
export const setPasswordSchema = z
  .object({
    new_password: password,
    confirm_password: z.string(),
  })
  .superRefine(matching);

export type ChangePasswordForm = z.infer<typeof changePasswordSchema>;
export type SetPasswordForm = z.infer<typeof setPasswordSchema>;
```

- [ ] **Step 8: Create `src/schemas/user.ts`**

```ts
import { z } from "zod";

import { PASSWORD_MAX, PASSWORD_MIN } from "./password";

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  phone: z.string().trim().min(1, "Phone is required.").max(32),
  company: z.string().trim().min(1, "Company is required.").max(200),
  role: z.enum(["agent", "admin"]).default("agent"),
  password: z
    .string()
    .min(PASSWORD_MIN, `Must be at least ${PASSWORD_MIN} characters.`)
    .max(PASSWORD_MAX, `Must be at most ${PASSWORD_MAX} characters.`),
});

export type CreateUserForm = z.infer<typeof createUserSchema>;
```

- [ ] **Step 9: Run the tests**

Run: `cd frontend && npm test`
Expected: PASS — 20 tests across the two files.

- [ ] **Step 10: Verify against the backend's rules**

The point of these schemas is that they say the same thing the server says. Run
the backend suite and confirm the equivalent cases still pass there:

```bash
cd backend && uv run pytest tests/test_survey_schemas.py -q
```

Expected: 15 passed. If a rule differs between the two lists, the frontend is
wrong — the server is the authority.

- [ ] **Step 11: Commit**

```bash
git add frontend/
git commit -m "feat(ui): zod schemas and the first frontend test suite

Mirrors backend/tests/test_survey_schemas.py so the duplicated rules fail a
test if they ever drift apart."
```

---

## Task 3: App shell and sign-in

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/routes/LoginPage.tsx`, `frontend/src/main.tsx`
- Test: `npm run build`, `npm test`, manual

**Interfaces:**
- Consumes: `cn()`, the primitives, `loginSchema`/`LoginForm` (Task 2).
- Produces: the `<Toaster />` mount that Tasks 5 and 6 rely on for `toast()` calls.

- [ ] **Step 1: Replace `src/routes/LoginPage.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { useAuth } from "@/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
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
import { loginSchema, type LoginForm } from "@/schemas/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "" },
  });

  async function onSubmit(values: LoginForm) {
    try {
      await login(values.phone, values.password);
      setError(null);
    } catch {
      // The server deliberately does not say which half was wrong, and neither
      // does this: it would reveal which phone numbers are registered.
      setError("Phone or password is incorrect.");
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Sign in</CardTitle>
          <CardDescription>Doctor chamber surveys</CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        autoFocus
                        inputMode="tel"
                        autoComplete="username"
                        placeholder="01712345678"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="current-password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </Form>
          <p className="mt-4 text-sm text-muted-foreground">
            No account? An administrator creates it and gives you a password.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Replace `src/App.tsx`**

```tsx
import { LogOut, Stethoscope } from "lucide-react";
import { Link, Navigate, Route, Routes } from "react-router-dom";

import { RequireAdmin, useAuth } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import AdminPage from "@/routes/AdminPage";
import AgentPage from "@/routes/AgentPage";
import LoginPage from "@/routes/LoginPage";

function Header() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3">
        <Stethoscope className="size-5 shrink-0 text-primary" aria-hidden />
        <nav className="flex items-center gap-1">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">Survey</Link>
          </Button>
          {user.role === "admin" && (
            <Button asChild variant="ghost" size="sm">
              <Link to="/admin">Admin</Link>
            </Button>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user.name}
          </span>
          <Badge variant="secondary">{user.role}</Badge>
          <Button variant="ghost" size="sm" onClick={logout}>
            <LogOut className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only sm:ml-1">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
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
      <Toaster richColors position="top-center" />
    </>
  );
}
```

- [ ] **Step 3: Point the remaining imports at the alias**

In `src/main.tsx` and `src/auth.tsx`, change relative imports to `@/`:
`./App` → `@/App`, `./auth` → `@/auth`, `./api` → `@/api`, `./index.css` stays
as `"./index.css"`.

- [ ] **Step 4: Verify**

```bash
cd frontend && npm test && npm run build
```

Manual, at `http://localhost:5173` after `docker compose up -d frontend`:

1. Signed out, the sign-in card is centred and styled; the old CSS no longer
   affects it.
2. Submit with an empty phone. Expected: "Enter your phone number." beside the
   field, not at the top of the page.
3. Sign in as the seeded admin. Expected: the new header, a `admin` badge, and
   Survey plus Admin links.
4. At a 375px viewport the header wraps and the name hides, leaving the badge
   and sign-out visible.

- [ ] **Step 5: Commit**

```bash
git add frontend/src
git commit -m "feat(ui): shadcn app shell and sign-in screen"
```

---

## Task 4: The survey form's field components

**Files:**
- Modify: `frontend/src/components/{SlotEditor,PhoneEditor,LocationInput,NameplateInput}.tsx`
- Test: `npm run build`, `npm test`

**Interfaces:**
- Consumes: `SurveyForm` (Task 2), the primitives (Task 1).
- Produces: four components that each take `control: Control<SurveyForm>` and render themselves; `NameplateInput` additionally takes `{ file, onChange, error }` because a `File` does not live in the zod schema.

**Why the nameplate is different:** it is a `File`, which zod cannot usefully
validate and react-hook-form does not need to own. It stays as local state on
`AgentPage`, exactly as it is today, and its required-ness is checked at submit.

- [ ] **Step 1: Replace `src/components/SlotEditor.tsx`**

```tsx
import { Plus, X } from "lucide-react";
import { useFieldArray, type Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { emptySlot, type SurveyForm } from "@/schemas/survey";

// Rendered Saturday-first for Bangladesh; the values stay 0=Monday so the
// database never learns about display order.
const DAYS = [
  { value: "5", label: "Sat" },
  { value: "6", label: "Sun" },
  { value: "0", label: "Mon" },
  { value: "1", label: "Tue" },
  { value: "2", label: "Wed" },
  { value: "3", label: "Thu" },
  { value: "4", label: "Fri" },
];

export default function SlotEditor({
  control,
}: {
  control: Control<SurveyForm>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "slots" });

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <Label className="text-sm font-medium">Availability</Label>
      {fields.map((field, index) => (
        <div key={field.id} className="flex flex-wrap items-start gap-2">
          <FormField
            control={control}
            name={`slots.${index}.day_of_week`}
            render={({ field: day }) => (
              <FormItem className="w-24">
                <Select
                  value={String(day.value)}
                  onValueChange={(v) => day.onChange(Number(v))}
                >
                  <FormControl>
                    <SelectTrigger aria-label="Day">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`slots.${index}.start_time`}
            render={({ field: start }) => (
              <FormItem className="flex-1 min-w-28">
                <FormControl>
                  <Input type="time" aria-label="Start time" {...start} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={control}
            name={`slots.${index}.end_time`}
            render={({ field: end }) => (
              <FormItem className="flex-1 min-w-28">
                <FormControl>
                  <Input type="time" aria-label="End time" {...end} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {fields.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(index)}
              aria-label="Remove slot"
            >
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append(emptySlot())}
      >
        <Plus className="size-4" aria-hidden /> Add slot
      </Button>
    </fieldset>
  );
}
```

- [ ] **Step 2: Replace `src/components/PhoneEditor.tsx`**

```tsx
import { Plus, X } from "lucide-react";
import { useFieldArray, type Control } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SurveyForm } from "@/schemas/survey";

export default function PhoneEditor({
  control,
}: {
  control: Control<SurveyForm>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "phones" });

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <Label className="text-sm font-medium">Chamber phone numbers</Label>
      {fields.map((field, index) => (
        <div key={field.id} className="flex items-start gap-2">
          <FormField
            control={control}
            name={`phones.${index}.value`}
            render={({ field: phone }) => (
              <FormItem className="flex-1">
                <FormControl>
                  <Input
                    inputMode="tel"
                    placeholder="01712345678"
                    aria-label={`Phone ${index + 1}`}
                    {...phone}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {fields.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(index)}
              aria-label="Remove number"
            >
              <X className="size-4" aria-hidden />
            </Button>
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ value: "" })}
      >
        <Plus className="size-4" aria-hidden /> Add number
      </Button>
    </fieldset>
  );
}
```

- [ ] **Step 3: Replace `src/components/LocationInput.tsx`**

```tsx
import { LocateFixed } from "lucide-react";
import { useEffect, useState } from "react";
import type { Control, UseFormSetValue } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SurveyForm } from "@/schemas/survey";

export default function LocationInput({
  control,
  setValue,
}: {
  control: Control<SurveyForm>;
  setValue: UseFormSetValue<SurveyForm>;
}) {
  const [geoState, setGeoState] = useState<"idle" | "asking" | "ok" | "denied">(
    "idle",
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState("ok");
        // setValue rather than a controlled object: the agent may already be
        // typing when this resolves, and only these two fields should move.
        setValue("latitude", pos.coords.latitude.toFixed(6));
        setValue("longitude", pos.coords.longitude.toFixed(6));
      },
      // Denial is expected and must not block the form - city and district
      // satisfy the requirement on their own.
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [setValue]);

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">Location</Label>
        {geoState === "asking" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LocateFixed className="size-3 animate-pulse" aria-hidden />
            Finding your position…
          </span>
        )}
      </div>
      {geoState === "denied" && (
        <p className="text-xs text-muted-foreground">
          No GPS fix. Type coordinates by hand, or just fill in city and
          district.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={control}
          name="latitude"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="Latitude" inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="longitude"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="Longitude" inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="City" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="district"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="District" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </fieldset>
  );
}
```

- [ ] **Step 4: Replace `src/components/NameplateInput.tsx`**

```tsx
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_BYTES = 10 * 1024 * 1024;

/** Stays outside react-hook-form: a File is not something zod can usefully
 *  validate, and the submit handler checks it directly. */
export default function NameplateInput({
  file,
  onChange,
  error,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string | null;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [sizeError, setSizeError] = useState<string | null>(null);

  const message = sizeError ?? error ?? null;

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <Label className="text-sm font-medium">Doctor nameplate photo</Label>
      <p className="text-xs text-muted-foreground">
        Required. The doctor&apos;s name, degrees and specializations are read
        from this image later.
      </p>
      <Input
        type="file"
        accept="image/*"
        aria-label="Nameplate photo"
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          // Checked here so a 10MB upload does not travel before being refused.
          if (picked && picked.size > MAX_BYTES) {
            setSizeError("Image is larger than 10MB.");
            setPreview(null);
            onChange(null);
            return;
          }
          setSizeError(null);
          setPreview(picked ? URL.createObjectURL(picked) : null);
          onChange(picked);
        }}
      />
      {message && <p className="text-sm text-destructive">{message}</p>}
      {preview && (
        <img
          src={preview}
          alt="Nameplate preview"
          className="max-h-56 rounded-md border object-contain"
        />
      )}
      {file && !message && (
        <p className="text-xs text-muted-foreground">{file.name}</p>
      )}
    </fieldset>
  );
}
```

- [ ] **Step 5: Verify it compiles**

```bash
cd frontend && npm test && npx tsc --noEmit
```

`AgentPage` still passes the old props and will not compile yet — that is
expected and is fixed in Task 5. Confirm the only errors reported are in
`src/routes/AgentPage.tsx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components
git commit -m "feat(ui): survey field components on react-hook-form"
```

---

## Task 5: The agent page

**Files:**
- Modify: `frontend/src/routes/AgentPage.tsx`, `frontend/src/components/PasswordForm.tsx`
- Test: `npm run build`, `npm test`, manual

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: `describeSlot(slot)` and `describePlace(survey)`, still exported for `AdminPage` in Task 6.

- [ ] **Step 1: Replace `src/components/PasswordForm.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  changePasswordSchema,
  setPasswordSchema,
  type ChangePasswordForm,
  type SetPasswordForm,
} from "@/schemas/password";

type Values = ChangePasswordForm | SetPasswordForm;

/** Used both for changing your own password and for an admin resetting
 *  someone else's, which differ only in whether a current password is asked
 *  for - and therefore in which schema applies. */
export default function PasswordForm({
  requireCurrent,
  submitLabel,
  onSubmit,
}: {
  requireCurrent: boolean;
  submitLabel: string;
  onSubmit: (next: string, current: string) => Promise<void>;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(requireCurrent ? changePasswordSchema : setPasswordSchema),
    defaultValues: requireCurrent
      ? { current_password: "", new_password: "", confirm_password: "" }
      : { new_password: "", confirm_password: "" },
  });

  async function submit(values: Values) {
    const current = "current_password" in values ? values.current_password : "";
    try {
      await onSubmit(values.new_password, current);
      form.reset();
    } catch (err) {
      form.setError("root", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        {form.formState.errors.root && (
          <p className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        {form.formState.isSubmitSuccessful && !form.formState.errors.root && (
          <p className="text-sm text-muted-foreground">Password updated.</p>
        )}
        {requireCurrent && (
          <FormField
            control={form.control}
            name={"current_password" as never}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
        <FormField
          control={form.control}
          name="new_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
```

- [ ] **Step 2: Replace `src/routes/AgentPage.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  changePassword,
  createSurvey,
  listMySurveys,
  myStats,
  TOKEN_KEY,
  type Slot,
  type Stats,
  type Survey,
} from "@/api";
import LocationInput from "@/components/LocationInput";
import NameplateInput from "@/components/NameplateInput";
import PasswordForm from "@/components/PasswordForm";
import PhoneEditor from "@/components/PhoneEditor";
import SlotEditor from "@/components/SlotEditor";
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
import {
  emptySurveyValues,
  surveySchema,
  type SurveyForm,
} from "@/schemas/survey";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function describeSlot(slot: Slot): string {
  return `${DAY_LABELS[slot.day_of_week]} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
}

export function describePlace(s: Survey): string {
  const parts: string[] = [];
  if (s.city && s.district) parts.push(`${s.city}, ${s.district}`);
  if (s.latitude !== null && s.longitude !== null) {
    parts.push(`(${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`);
  }
  return parts.join(" ");
}

export default function AgentPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameplate, setNameplate] = useState<File | null>(null);
  const [nameplateError, setNameplateError] = useState<string | null>(null);

  const form = useForm<SurveyForm>({
    resolver: zodResolver(surveySchema),
    defaultValues: emptySurveyValues(),
  });

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([myStats(), listMySurveys()]);
      setStats(s);
      setMine(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(values: SurveyForm) {
    if (!nameplate) {
      setNameplateError("A nameplate photo is required.");
      return;
    }
    setNameplateError(null);

    const parsed = surveySchema.parse(values);
    const body = new FormData();
    body.set("hospital_name", parsed.hospital_name);
    body.set("daily_patients", String(parsed.daily_patients));
    body.set("avg_duration_min", String(parsed.avg_duration_min));
    body.set("consultation_fee_bdt", String(parsed.consultation_fee_bdt));
    // Multipart cannot nest, so these travel as JSON strings. Phones are
    // objects in the form because useFieldArray requires objects; the API
    // wants bare strings.
    body.set("slots", JSON.stringify(parsed.slots));
    body.set("phones", JSON.stringify(parsed.phones.map((p) => p.value)));
    body.set("nameplate", nameplate);
    if (parsed.city.trim()) body.set("city", parsed.city.trim());
    if (parsed.district.trim()) body.set("district", parsed.district.trim());
    if (parsed.latitude.trim()) body.set("latitude", parsed.latitude.trim());
    if (parsed.longitude.trim()) body.set("longitude", parsed.longitude.trim());

    try {
      await createSurvey(body);
      form.reset(emptySurveyValues());
      setNameplate(null);
      toast.success("Survey submitted.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          New chamber survey
        </h1>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {loading || !stats ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : (
            <>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-semibold">{stats.today}</div>
                  <div className="text-xs text-muted-foreground">
                    filed today
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-semibold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">in total</div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </section>

      <Card>
        <CardContent className="pt-6">
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

              <LocationInput control={form.control} setValue={form.setValue} />
              <NameplateInput
                file={nameplate}
                onChange={setNameplate}
                error={nameplateError}
              />
              <SlotEditor control={form.control} />
              <PhoneEditor control={form.control} />

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="daily_patients"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Patients per day</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} />
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
                        <Input type="number" min={1} {...field} />
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
                        <Input type="number" min={0} {...field} />
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
                {form.formState.isSubmitting ? "Submitting…" : "Submit survey"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">My surveys</h2>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing filed yet.</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((s) => (
              <li key={s.id}>
                <Card>
                  <CardContent className="space-y-1 p-4 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{s.hospital_name}</span>
                      <time className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString()}
                      </time>
                    </div>
                    <div className="text-muted-foreground">
                      {describePlace(s)}
                    </div>
                    <div className="text-muted-foreground">
                      {s.slots.map(describeSlot).join(" · ")}
                    </div>
                    <div className="text-muted-foreground">
                      {s.phones.join(" · ")}
                    </div>
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
            <PasswordForm
              requireCurrent
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

- [ ] **Step 3: Verify**

```bash
cd frontend && npm test && npm run build
cd .. && docker compose up -d frontend
```

Manual, signed in as an agent (create one from the admin page, or use a demo
agent with `DEMO_PASSWORD`):

1. Submit an empty form. Expected: errors appear beside each field, including
   "Provide coordinates or city and district." under City.
2. Fill city and district only, leave coordinates blank, attach a nameplate,
   submit. Expected: success toast, form clears, the counter above increments.
3. Add a second slot; set its end time before its start. Expected: "End must be
   after start." under that slot's end field only.
4. Remove a slot; confirm the last one cannot be removed.
5. Submit with no nameplate. Expected: "A nameplate photo is required."
6. Change your own password. Expected: success toast, and the page keeps
   working — you are not signed out by your own change.
7. At 375px: the three number fields stack, and the form is usable one-handed.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(ui): agent survey page on shadcn and react-hook-form"
```

---

## Task 6: The admin page

**Files:**
- Modify: `frontend/src/routes/AdminPage.tsx`
- Test: `npm run build`, `npm test`, manual

**Interfaces:**
- Consumes: `describeSlot`, `describePlace` (Task 5); `createUserSchema` (Task 2); the primitives.
- Produces: nothing.

- [ ] **Step 1: Replace `src/routes/AdminPage.tsx`**

```tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  adminStats,
  createUser,
  deleteSurvey,
  listAllSurveys,
  listUsers,
  resetPassword,
  type AdminStats,
  type Survey,
  type UserPublic,
} from "@/api";
import PasswordForm from "@/components/PasswordForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describePlace, describeSlot } from "@/routes/AgentPage";
import { createUserSchema, type CreateUserForm } from "@/schemas/user";

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [people, setPeople] = useState<UserPublic[]>([]);
  const [district, setDistrict] = useState("");
  const [agentId, setAgentId] = useState("");
  const [resetting, setResetting] = useState<UserPublic | null>(null);
  const [deleting, setDeleting] = useState<Survey | null>(null);

  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      phone: "",
      company: "",
      role: "agent",
      password: "",
    },
  });

  const refresh = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (district.trim()) params.district = district.trim();
      if (agentId) params.user_id = agentId;
      const [s, list, roster] = await Promise.all([
        adminStats(),
        listAllSurveys(params),
        listUsers(),
      ]);
      setStats(s);
      setSurveys(list);
      setPeople(roster);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [district, agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAddAgent(values: CreateUserForm) {
    try {
      await createUser(values);
      form.reset();
      toast.success(`${values.name} can now sign in.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      // Soft on the server: the row and its nameplate survive for audit.
      await deleteSurvey(deleting.id);
      toast.success("Survey removed from the active list.");
      setDeleting(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const filtered = district.trim() !== "" || agentId !== "";

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">All surveys</h1>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: stats.total, label: "total surveys" },
            { value: stats.today, label: "today" },
            { value: stats.agent_count, label: "active users" },
          ].map((tile) => (
            <Card key={tile.label}>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-semibold">{tile.value}</div>
                <div className="text-xs text-muted-foreground">
                  {tile.label}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {stats && stats.per_agent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">By agent</h2>
          <div className="flex flex-wrap gap-2">
            {stats.per_agent.map((a) => (
              <Button
                key={a.user_id}
                variant={agentId === a.user_id ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setAgentId(agentId === a.user_id ? "" : a.user_id)
                }
              >
                {a.name}
                <Badge variant="secondary" className="ml-2">
                  {a.today} / {a.total}
                </Badge>
              </Button>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Filter by district"
          aria-label="Filter by district"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAgentId("");
              setDistrict("");
            }}
          >
            Clear
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Surveys</h2>
        {surveys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing matches.</p>
        ) : (
          <>
            {/* Table at desk width, cards on a phone - the admin is usually
                at a desk, but the roster should not be unusable on mobile. */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Hospital</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {surveys.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {s.doctor_name ?? (
                          <span className="text-muted-foreground">
                            — nameplate pending
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{s.hospital_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {describePlace(s)}
                      </TableCell>
                      <TableCell>{s.agent_name ?? "unknown"}</TableCell>
                      <TableCell className="text-right">
                        ৳{s.consultation_fee_bdt}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(s)}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="space-y-3 md:hidden">
              {surveys.map((s) => (
                <li key={s.id}>
                  <Card>
                    <CardContent className="space-y-1 p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">
                          {s.doctor_name ?? "Dr. — (nameplate pending)"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(s)}
                        >
                          Delete
                        </Button>
                      </div>
                      <div>{s.hospital_name}</div>
                      <div className="text-muted-foreground">
                        filed by {s.agent_name ?? "unknown"} ·{" "}
                        {new Date(s.created_at).toLocaleString()}
                      </div>
                      <div className="text-muted-foreground">
                        {describePlace(s)}
                      </div>
                      <div className="text-muted-foreground">
                        {s.slots.map(describeSlot).join(" · ")}
                      </div>
                      <div className="text-muted-foreground">
                        {s.phones.join(" · ")}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">People</h2>
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {people.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 p-4 text-sm"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.company}</span>
                  <Badge variant="secondary">{p.role}</Badge>
                  {!p.is_active && <Badge variant="outline">deactivated</Badge>}
                  <Button
                    className="ml-auto"
                    variant="outline"
                    size="sm"
                    onClick={() => setResetting(p)}
                  >
                    Reset password
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Add an agent</h2>
        <Card>
          <CardContent className="pt-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onAddAgent)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="01712345678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="max-w-sm">
                      <FormLabel>Initial password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Give this to the agent directly. They can change it from their
                  own page.
                </p>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  Create agent
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </section>

      <Dialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {resetting?.name}</DialogTitle>
            <DialogDescription>
              This signs them out of every device, which is the point of a
              reset.
            </DialogDescription>
          </DialogHeader>
          {resetting && (
            <PasswordForm
              requireCurrent={false}
              submitLabel="Set new password"
              onSubmit={async (next) => {
                await resetPassword(resetting.id, next);
                toast.success(`${resetting.name} has a new password.`);
                setResetting(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this survey?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.hospital_name} leaves the active list. The record and
              its nameplate are kept, so the field data stays auditable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
```

- [ ] **Step 2: Verify**

```bash
cd frontend && npm test && npm run build
```

Manual, signed in as the admin:

1. Stat tiles show real totals.
2. Click an agent chip. Expected: the survey list filters to them and the chip
   becomes solid; click again to clear.
3. Add an agent with a 5-character password. Expected: "Must be at least 8
   characters." beside the field, and no request sent.
4. Add a valid agent. Expected: success toast, roster gains the row.
5. Reset that agent's password from the dialog, then confirm in another browser
   profile that their session is dead.
6. Delete a survey. Expected: an AlertDialog explaining the record is kept, not
   a browser `confirm()`; totals drop after confirming.
7. At 375px: the survey table is replaced by cards.

- [ ] **Step 3: Commit**

```bash
git add frontend/src
git commit -m "feat(ui): admin dashboard on shadcn with table, dialogs and toasts"
```

---

## Task 7: Preflight on, legacy stylesheet out

**Files:**
- Modify: `frontend/src/index.css`, `README.md`
- Test: `npm run build`, `npm test`, full manual pass

- [ ] **Step 1: Swap the layer imports for the real one**

At the top of `src/index.css`, replace:

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
```

with:

```css
@import "tailwindcss";
```

- [ ] **Step 2: Delete the compatibility layer**

Remove the `@layer base { *, ::before, ::after { … } }` block added in Task 1.
Real preflight now supplies `box-sizing`, `border-width: 0` and
`border-style: solid`.

- [ ] **Step 3: Delete the legacy stylesheet**

Remove everything below the `@theme inline { … }` block — the old `:root`
custom properties, the `@media (prefers-color-scheme: dark)` block, and every
`.wrap`, `.card`, `.row`, `.list`, `.muted`, `.sub`, `.error`, `.link`,
`.topbar`, `.stats`, `fieldset`, `legend` and element rule.

Then add the one base rule the app still needs:

```css
@layer base {
  body {
    @apply bg-background text-foreground;
  }
}
```

- [ ] **Step 4: Prove no legacy class survives**

```bash
cd frontend
grep -rnE 'className="[^"]*\b(wrap|card|row|list|muted|sub|error|link|topbar|stats|preview)\b' src/ \
  --include="*.tsx" | grep -v "components/ui/"
```

Expected: no output. Any hit is a screen still relying on a stylesheet that no
longer exists — fix it before continuing rather than discovering it in the
browser.

- [ ] **Step 5: Full verification**

```bash
cd frontend && npm test && npm run build
cd ../backend && uv run pytest -q && uv run ruff check .
cd .. && docker compose up --build -d
```

Expected: vitest green, build clean, backend 116 tests green, stack healthy.

Then walk the whole flow once, at desktop width and at 375px:

1. Sign in as the seeded admin.
2. File a survey with city and district only.
3. Add a slot, remove a slot, submit one with end before start.
4. Submit without a nameplate.
5. Change your own password; confirm the session survives.
6. Create an agent; sign in as them in another profile.
7. Reset that agent's password; confirm they are signed out.
8. Delete a survey; confirm the totals drop.
9. Toggle the OS between light and dark; confirm the app follows without a
   reload.

- [ ] **Step 6: Update the README**

Replace the frontend line under "## Layout":

```
frontend/         Vite + React + TypeScript + Tailwind v4 + shadcn/ui
  src/components/ui/  shadcn primitives (generated; not hand-edited)
  src/schemas/        zod schemas, mirroring backend/app/schemas
  src/routes/         one file per screen
```

In "## Tests & linting", replace the frontend line:

```bash
cd frontend && npm test && npm run build   # vitest schemas, then tsc + vite
```

And under "## Known gaps", replace the frontend testing bullet:

```markdown
- **No component-render tests.** vitest covers the zod schemas only; there is
  no `@testing-library/react`, so wiring bugs (a field not bound, a button not
  submitting) are caught by hand. `npm run lint` is still a scaffold stub —
  ESLint is not installed.
- **Client validation duplicates the backend's rules.** The zod schemas in
  `src/schemas/` restate what `backend/app/schemas/` enforces, so an agent sees
  errors beside the field instead of after a round trip. The server remains the
  authority; the vitest suite mirrors `test_survey_schemas.py` so drift fails a
  test.
```

- [ ] **Step 7: Commit**

```bash
git add frontend README.md
git commit -m "feat(ui): enable preflight and delete the legacy stylesheet

Completes the migration: every screen is on Tailwind, so the reset no longer
has anything to break."
```

---

## Self-Review Notes

Checked against the spec:

- Every spec section maps to a task: identity tokens and the no-webfont
  decision → 1; deferred preflight and the compatibility layer → 1 and 7;
  schemas and vitest → 2; the three behavioural changes (AlertDialog, toasts,
  Skeleton) → 3, 5 and 6; per-screen migration → 3–6; verification and docs → 7.
- Each spec verification bullet appears as a manual step, and the 375px check
  appears in Tasks 3, 5, 6 and 7.
- **Caught during review:** the spec lists `phones` as a string array, but
  `useFieldArray` requires objects. Task 2 defines them as `{ value: string }[]`
  and Task 5 flattens them with `.map((p) => p.value)` before the request. This
  is called out in Task 2's interfaces because Tasks 4 and 5 both depend on it.
- **Caught during review:** `zod` must be pinned to `^3`. `shadcn add form`
  installs whatever is current, and zod 4 moved `ctx.addIssue` and
  `z.ZodIssueCode`, which every `superRefine` here uses. Task 1 Step 8 pins it.
- **Caught during review:** the frontend container keeps `node_modules` in an
  anonymous volume, so a host-side `npm install` is invisible to it. The Docker
  note before Task 1 covers this; Task 1 Step 9 rebuilds.
- Names are consistent across tasks: `emptySlot`/`emptySurveyValues`
  (Task 2, used 4 and 5), `describeSlot`/`describePlace` (Task 5, used 6),
  `PasswordForm`'s `requireCurrent`/`submitLabel`/`onSubmit` props (Task 5,
  used 5 and 6), `cn` (Task 1, used by every generated primitive).
