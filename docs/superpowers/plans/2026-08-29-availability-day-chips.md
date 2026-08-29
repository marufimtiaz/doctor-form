# Availability Multi-Day Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to select multiple availability days per slot using day chips and quick presets in the doctor survey form, while converting day names to standard integers upon submission.

**Architecture:** Frontend form schema uses day name strings (`Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`) in form state and UI. `surveySchema` flattens multi-day slot items into individual `{ day_of_week, start_time, end_time }` entries matching the existing backend API specification.

**Tech Stack:** React, React Hook Form, Zod, Vitest, Lucide React, Tailwind CSS / Shadcn UI components.

## Global Constraints

- Day names: `Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`
- Integer mapping: `Sat` -> 5, `Sun` -> 6, `Mon` -> 0, `Tue` -> 1, `Wed` -> 2, `Thu` -> 3, `Fri` -> 4
- API slot shape: `{ day_of_week: number, start_time: string, end_time: string }`
- Zero backend API or DB schema changes.

---

### Task 1: Update Frontend Survey Schema & Schema Tests

**Files:**
- Modify: `frontend/src/schemas/survey.ts`
- Modify: `frontend/src/schemas/survey.test.ts`

**Interfaces:**
- Consumes: Form input values with `days: string[]`.
- Produces: `surveySchema.parse(values)` output containing `slots: Array<{ day_of_week: number, start_time: string, end_time: string }>`.

- [ ] **Step 1: Write the failing test in `survey.test.ts`**

Update `frontend/src/schemas/survey.test.ts` slots test block to test `days` array of day names:

```typescript
describe("slots", () => {
  const withCity = { city: "Dhaka", district: "Dhanmondi" };

  it("requires at least one slot", () => {
    expect(parse({ ...withCity, slots: [] }).success).toBe(false);
  });

  it("requires at least one day per slot", () => {
    const slots = [{ days: [], start_time: "17:00", end_time: "20:00" }];
    expect(messages(parse({ ...withCity, slots }))).toContain("Select at least one day.");
  });

  it("flattens multiple days into backend integer slot items", () => {
    const slots = [{ days: ["Sat", "Sun"], start_time: "17:00", end_time: "20:00" }];
    const result = parse({ ...withCity, slots });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slots).toEqual([
        { day_of_week: 5, start_time: "17:00", end_time: "20:00" },
        { day_of_week: 6, start_time: "17:00", end_time: "20:00" },
      ]);
    }
  });

  it("rejects an end time at or before the start time", () => {
    const slots = [{ days: ["Sat"], start_time: "20:00", end_time: "17:00" }];
    expect(messages(parse({ ...withCity, slots }))).toContain(
      "End must be after start.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` inside `frontend/` directory.
Expected: FAIL due to schema mismatch on `day_of_week` vs `days`.

- [ ] **Step 3: Update `survey.ts` schema and transformations**

In `frontend/src/schemas/survey.ts`:

```typescript
export const DAY_NAMES = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export type DayName = (typeof DAY_NAMES)[number];

export const DAY_NAME_TO_INT: Record<DayName, number> = {
  Sat: 5,
  Sun: 6,
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
};

export const slotSchema = z
  .object({
    days: z.array(z.enum(DAY_NAMES)).min(1, "Select at least one day."),
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
    phones: z
      .array(z.object({ value: z.string().trim().min(1, "Enter a number.") }))
      .min(1, "Add at least one phone number."),
  })
  .superRefine((v, ctx) => {
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
  })
  .transform((data) => ({
    ...data,
    slots: data.slots.flatMap((s) =>
      s.days.map((day) => ({
        day_of_week: DAY_NAME_TO_INT[day],
        start_time: s.start_time,
        end_time: s.end_time,
      })),
    ),
  }));

export type SurveyForm = z.input<typeof surveySchema>;

export const emptySlot = () => ({
  days: ["Sat"] as DayName[],
  start_time: "17:00",
  end_time: "20:00",
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` inside `frontend/` directory.
Expected: PASS all tests in `survey.test.ts`.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/schemas/survey.ts frontend/src/schemas/survey.test.ts
git commit -m "feat(schema): update survey schema for multi-day availability slot selection"
```

---

### Task 2: Update SlotEditor UI Component with Multi-Day Chips & Presets

**Files:**
- Modify: `frontend/src/components/SlotEditor.tsx`

**Interfaces:**
- Consumes: `control: Control<SurveyForm>` from React Hook Form.
- Renders: Day toggle chips (`Sat`..`Fri`), quick preset buttons (**Weekend**, **Weekdays**, **All Days**, **Clear**), time range inputs, and add/remove slot actions.

- [ ] **Step 1: Update `SlotEditor.tsx`**

Modify `frontend/src/components/SlotEditor.tsx` to render preset shortcut buttons and day toggle chips:

```tsx
import { Plus, X } from "lucide-react";
import { useFieldArray, useWatch, type Control, type UseFormSetValue } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DAY_NAMES, emptySlot, type DayName, type SurveyForm } from "@/schemas/survey";

const PRESETS: { label: string; days: DayName[] } = [
  { label: "Weekend", days: ["Sat", "Sun"] },
  { label: "Weekdays", days: ["Mon", "Tue", "Wed", "Thu"] },
  { label: "All Days", days: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] },
];

export default function SlotEditor({
  control,
  setValue,
}: {
  control: Control<SurveyForm>;
  setValue: UseFormSetValue<SurveyForm>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "slots" });
  const slotsValue = useWatch({ control, name: "slots" });

  const toggleDay = (slotIndex: number, day: DayName) => {
    const currentDays = slotsValue?.[slotIndex]?.days || [];
    const exists = currentDays.includes(day);
    const nextDays = exists
      ? currentDays.filter((d) => d !== day)
      : [...currentDays, day];
    setValue(`slots.${slotIndex}.days`, nextDays, { shouldValidate: true, shouldDirty: true });
  };

  const applyPreset = (slotIndex: number, days: DayName[]) => {
    setValue(`slots.${slotIndex}.days`, days, { shouldValidate: true, shouldDirty: true });
  };

  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <Label className="text-sm font-medium">Availability</Label>
      {fields.map((field, index) => {
        const currentDays = slotsValue?.[index]?.days || [];

        return (
          <div key={field.id} className="space-y-3 rounded-md border p-3 bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted-foreground">
                Slot {index + 1}
              </span>
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => applyPreset(index, preset.days)}
                  >
                    {preset.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground"
                  onClick={() => applyPreset(index, [])}
                >
                  Clear
                </Button>
                {fields.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => remove(index)}
                    aria-label="Remove slot"
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            </div>

            <FormField
              control={control}
              name={`slots.${index}.days`}
              render={() => (
                <FormItem>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_NAMES.map((day) => {
                      const isSelected = currentDays.includes(day);
                      return (
                        <Button
                          key={day}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          size="sm"
                          className="h-8 px-3 text-xs"
                          onClick={() => toggleDay(index, day)}
                        >
                          {day}
                        </Button>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex flex-wrap items-start gap-2 pt-1">
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
            </div>
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append(emptySlot())}
      >
        <Plus className="size-4" aria-hidden /> Add time slot
      </Button>
    </fieldset>
  );
}
```

- [ ] **Step 2: Update `AgentPage.tsx` to pass `setValue` to `SlotEditor`**

In `frontend/src/routes/AgentPage.tsx`:
Update `<SlotEditor control={form.control} />` to `<SlotEditor control={form.control} setValue={form.setValue} />`.

- [ ] **Step 3: Run Vitest tests & TypeScript check**

Run: `npm test` and `npx tsc --noEmit` inside `frontend/`.
Expected: Clean pass with zero type errors.

- [ ] **Step 4: Commit changes**

```bash
git add frontend/src/components/SlotEditor.tsx frontend/src/routes/AgentPage.tsx
git commit -m "feat(ui): implement multi-day availability chips and quick presets"
```
