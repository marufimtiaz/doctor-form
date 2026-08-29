# Multi-Segment Time Range Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a multi-segment visual time range slider with 30-minute tick marks and 12-hour selectors, allowing users to define multiple day groups and multiple time ranges (e.g., Morning + Evening shifts) while flattening data into backend integer slot entries upon submission.

**Architecture:** Frontend form schema defines slot groups containing `days: DayName[]` and `ranges: Array<{ start_time: string, end_time: string }>`. `toBackendSlots` flattens all `(days × ranges)` combinations into individual `{ day_of_week, start_time, end_time }` entries expected by the backend API.

**Tech Stack:** React, React Hook Form, Zod, Vitest, Lucide React, Tailwind CSS / Shadcn UI components.

## Global Constraints

- Day names: `Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`
- Integer mapping: `Sat` -> 5, `Sun` -> 6, `Mon` -> 0, `Tue` -> 1, `Wed` -> 2, `Thu` -> 3, `Fri` -> 4
- Time granularity: 30-minute intervals (e.g. `09:00`, `09:30`, `10:00`)
- API slot shape: `{ day_of_week: number, start_time: string, end_time: string }`
- Zero backend API or DB schema changes.

---

### Task 1: Update Survey Schema & `toBackendSlots` Helper with Unit Tests

**Files:**
- Modify: `frontend/src/schemas/survey.ts`
- Modify: `frontend/src/schemas/survey.test.ts`

**Interfaces:**
- Consumes: Form input values with `slots: Array<{ days: DayName[], ranges: Array<{ start_time: string, end_time: string }> }>`.
- Produces: `toBackendSlots(parsed.slots)` returning `Array<{ day_of_week: number, start_time: string, end_time: string }>`.

- [ ] **Step 1: Write the failing test in `survey.test.ts`**

Update `frontend/src/schemas/survey.test.ts` slots test block to test `days` and `ranges` array:

```typescript
describe("slots", () => {
  const withCity = { city: "Dhaka", district: "Dhanmondi" };

  it("requires at least one slot group", () => {
    expect(parse({ ...withCity, slots: [] }).success).toBe(false);
  });

  it("requires at least one day and one range per slot group", () => {
    const slots = [{ days: [], ranges: [] }];
    expect(parse({ ...withCity, slots }).success).toBe(false);
  });

  it("flattens multi-day and multi-range slot groups into backend integer slot items", () => {
    const slots = [
      {
        days: ["Sat", "Sun"],
        ranges: [
          { start_time: "09:00", end_time: "12:00" },
          { start_time: "17:00", end_time: "20:00" },
        ],
      },
    ];
    const result = parse({ ...withCity, slots });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(toBackendSlots(result.data.slots)).toEqual([
        { day_of_week: 5, start_time: "09:00", end_time: "12:00" },
        { day_of_week: 5, start_time: "17:00", end_time: "20:00" },
        { day_of_week: 6, start_time: "09:00", end_time: "12:00" },
        { day_of_week: 6, start_time: "17:00", end_time: "20:00" },
      ]);
    }
  });

  it("rejects an end time at or before the start time in any range", () => {
    const slots = [
      {
        days: ["Sat"],
        ranges: [{ start_time: "20:00", end_time: "17:00" }],
      },
    ];
    expect(messages(parse({ ...withCity, slots }))).toContain(
      "End must be after start.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` inside `frontend/` directory.
Expected: FAIL due to schema mismatch on `ranges` vs old `start_time`/`end_time`.

- [ ] **Step 3: Update `survey.ts` schema and `toBackendSlots` helper**

In `frontend/src/schemas/survey.ts`:

```typescript
export const timeRangeSchema = z
  .object({
    start_time: z.string().min(1, "Start time is required."),
    end_time: z.string().min(1, "End time is required."),
  })
  .refine((range) => range.end_time > range.start_time, {
    message: "End must be after start.",
    path: ["end_time"],
  });

export const slotSchema = z.object({
  days: z.array(z.enum(DAY_NAMES)).min(1, "Select at least one day."),
  ranges: z.array(timeRangeSchema).min(1, "Add at least one time range."),
});

// Update toBackendSlots to iterate days x ranges:
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
  ranges: [{ start_time: "17:00", end_time: "20:00" }],
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test` inside `frontend/` directory.
Expected: PASS all tests in `survey.test.ts`.

- [ ] **Step 5: Commit changes**

```bash
git add frontend/src/schemas/survey.ts frontend/src/schemas/survey.test.ts
git commit -m "feat(schema): update survey schema for multi-segment time ranges"
```

---

### Task 2: Create Visual Timeline & Multi-Segment Time Range Editor UI (`SlotEditor.tsx`)

**Files:**
- Modify: `frontend/src/components/SlotEditor.tsx`

**Interfaces:**
- Renders:
  - Day toggle chips (`Sat`..`Fri`) and presets (`Weekend`, `Weekdays`, `All Days`, `Clear`).
  - Visual 24-hour timeline bar (8:00 AM to 11:00 PM) with 30-minute tick marks and visual highlight segments.
  - 12-hour 30-minute dropdown selectors (`09:00 AM`, `09:30 AM`, ...).
  - Live duration calculation pill (e.g. `⏱️ 3 hrs 30 mins`).
  - Quick shift preset buttons (`Evening 5-8 PM`, `Night 7-10 PM`, `Morning 9 AM-1 PM`).
  - Range management (`+ Add Time Range`, delete range).
  - Slot card management (`+ Add Slot Group`, delete group).

- [ ] **Step 1: Implement `SlotEditor.tsx` with Visual Timeline and 12h Selectors**

Modify `frontend/src/components/SlotEditor.tsx`:

```tsx
import { Plus, Trash2, X } from "lucide-react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormSetValue,
} from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DAY_NAMES,
  emptySlot,
  type DayName,
  type SurveyForm,
} from "@/schemas/survey";

const PRESETS: { label: string; days: DayName[] }[] = [
  { label: "Weekend", days: ["Sat", "Sun"] },
  { label: "Weekdays", days: ["Mon", "Tue", "Wed", "Thu"] },
  { label: "All Days", days: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"] },
];

const SHIFT_PRESETS = [
  { label: "Morning (9 AM – 1 PM)", start: "09:00", end: "13:00" },
  { label: "Afternoon (3 PM – 6 PM)", start: "15:00", end: "18:00" },
  { label: "Evening (5 PM – 8 PM)", start: "17:00", end: "20:00" },
  { label: "Night (7 PM – 10 PM)", start: "19:00", end: "22:00" },
];

// Generate 30-minute interval options from 06:00 to 23:00
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let hour = 6; hour <= 23; hour++) {
  for (let min of [0, 30]) {
    const hh = String(hour).padStart(2, "0");
    const mm = String(min).padStart(2, "0");
    const value = `${hh}:${mm}`;
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    const label = `${String(displayHour).padStart(2, "0")}:${mm} ${period}`;
    TIME_OPTIONS.push({ value, label });
  }
}

function formatDuration(startStr: string, endStr: string): string {
  if (!startStr || !endStr || endStr <= startStr) return "";
  const [sh, sm] = startStr.split(":").map(Number);
  const [eh, em] = endStr.split(":").map(Number);
  const totalMins = eh * 60 + em - (sh * 60 + sm);
  if (totalMins <= 0) return "";
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0 && mins > 0) return `${hours} hr ${mins} min`;
  if (hours > 0) return `${hours} hr${hours > 1 ? "s" : ""}`;
  return `${mins} min`;
}

// Convert "HH:MM" to percentage position on timeline (8 AM = 0%, 11 PM = 100%)
function timeToPercent(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  const mins = h * 60 + m;
  const startMins = 8 * 60; // 8 AM
  const endMins = 23 * 60; // 11 PM
  const clamped = Math.max(startMins, Math.min(endMins, mins));
  return ((clamped - startMins) / (endMins - startMins)) * 100;
}

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
    setValue(`slots.${slotIndex}.days`, nextDays, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const applyPreset = (slotIndex: number, days: DayName[]) => {
    setValue(`slots.${slotIndex}.days`, days, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const addRange = (slotIndex: number, start = "17:00", end = "20:00") => {
    const currentRanges = slotsValue?.[slotIndex]?.ranges || [];
    setValue(
      `slots.${slotIndex}.ranges`,
      [...currentRanges, { start_time: start, end_time: end }],
      { shouldValidate: true, shouldDirty: true },
    );
  };

  const removeRange = (slotIndex: number, rangeIndex: number) => {
    const currentRanges = slotsValue?.[slotIndex]?.ranges || [];
    if (currentRanges.length <= 1) return;
    setValue(
      `slots.${slotIndex}.ranges`,
      currentRanges.filter((_, i) => i !== rangeIndex),
      { shouldValidate: true, shouldDirty: true },
    );
  };

  return (
    <fieldset className="space-y-6 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <Label className="text-base font-semibold">Availability Schedule</Label>
      </div>

      {fields.map((field, index) => {
        const currentDays = slotsValue?.[index]?.days || [];
        const currentRanges = slotsValue?.[index]?.ranges || [];

        return (
          <div
            key={field.id}
            className="space-y-4 rounded-lg border bg-card p-4 shadow-sm"
          >
            {/* Slot Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Group {index + 1}
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
                    aria-label="Remove slot group"
                  >
                    <X className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            </div>

            {/* Day Chips */}
            <FormField
              control={control}
              name={`slots.${index}.days`}
              render={() => (
                <FormItem className="space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Select Days:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {DAY_NAMES.map((day) => {
                      const isSelected = currentDays.includes(day);
                      return (
                        <Button
                          key={day}
                          type="button"
                          variant={isSelected ? "default" : "outline"}
                          size="sm"
                          className="h-8 px-3 text-xs font-medium"
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

            {/* Visual Timeline Bar */}
            <div className="space-y-1.5 rounded-md bg-muted/40 p-3">
              <div className="flex justify-between text-[10px] font-medium text-muted-foreground">
                <span>8 AM</span>
                <span>10 AM</span>
                <span>12 PM</span>
                <span>2 PM</span>
                <span>4 PM</span>
                <span>6 PM</span>
                <span>8 PM</span>
                <span>10 PM</span>
              </div>
              <div className="relative h-4 w-full rounded-full bg-muted border overflow-hidden">
                {/* 30-min tick marks */}
                {Array.from({ length: 31 }).map((_, i) => (
                  <div
                    key={i}
                    className={`absolute top-0 bottom-0 w-px ${
                      i % 2 === 0 ? "bg-muted-foreground/30" : "bg-muted-foreground/15"
                    }`}
                    style={{ left: `${(i / 30) * 100}%` }}
                  />
                ))}
                {/* Visual Segments for Active Ranges */}
                {currentRanges.map((range, rIdx) => {
                  const left = timeToPercent(range.start_time);
                  const right = timeToPercent(range.end_time);
                  const width = Math.max(0, right - left);
                  return (
                    <div
                      key={rIdx}
                      className="absolute top-0 bottom-0 bg-primary/80 transition-all rounded-sm"
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${range.start_time} - ${range.end_time}`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Time Ranges List */}
            <div className="space-y-3">
              <span className="text-xs font-medium text-muted-foreground">
                Time Shift Ranges:
              </span>
              {currentRanges.map((range, rangeIndex) => {
                const duration = formatDuration(
                  range.start_time,
                  range.end_time,
                );

                return (
                  <div
                    key={rangeIndex}
                    className="flex flex-wrap items-center gap-2 rounded-md border p-2 bg-background"
                  >
                    <span className="text-xs font-medium min-w-16">
                      Shift {rangeIndex + 1}:
                    </span>

                    {/* Start Time Select */}
                    <FormField
                      control={control}
                      name={`slots.${index}.ranges.${rangeIndex}.start_time`}
                      render={({ field: start }) => (
                        <FormItem className="flex-1 min-w-32">
                          <Select
                            value={start.value}
                            onValueChange={start.onChange}
                          >
                            <FormControl>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Start Time" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-h-56">
                              {TIME_OPTIONS.map((t) => (
                                <SelectItem
                                  key={t.value}
                                  value={t.value}
                                  className="text-xs"
                                >
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />

                    <span className="text-xs text-muted-foreground">to</span>

                    {/* End Time Select */}
                    <FormField
                      control={control}
                      name={`slots.${index}.ranges.${rangeIndex}.end_time`}
                      render={({ field: end }) => (
                        <FormItem className="flex-1 min-w-32">
                          <Select
                            value={end.value}
                            onValueChange={end.onChange}
                          >
                            <FormControl>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="End Time" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="max-h-56">
                              {TIME_OPTIONS.map((t) => (
                                <SelectItem
                                  key={t.value}
                                  value={t.value}
                                  className="text-xs"
                                >
                                  {t.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />

                    {/* Duration Badge */}
                    {duration && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        ⏱️ {duration}
                      </span>
                    )}

                    {/* Delete Range Button */}
                    {currentRanges.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={() => removeRange(index, rangeIndex)}
                        aria-label="Remove shift range"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    )}
                  </div>
                );
              })}

              {/* Shift Presets & Add Range */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-1">
                  {SHIFT_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => addRange(index, preset.start, preset.end)}
                    >
                      + {preset.label}
                    </Button>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 px-3 text-xs"
                  onClick={() => addRange(index)}
                >
                  <Plus className="mr-1 size-3.5" aria-hidden /> Add Shift Range
                </Button>
              </div>
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
        <Plus className="mr-1 size-4" aria-hidden /> Add Slot Group
      </Button>
    </fieldset>
  );
}
```

- [ ] **Step 2: TypeScript & Vitest Verification**

Run: `npx tsc --noEmit && npm test` inside `frontend/`.
Expected: Clean pass with zero errors.

- [ ] **Step 3: Commit changes**

```bash
git add frontend/src/components/SlotEditor.tsx
git commit -m "feat(ui): implement multi-segment timeline slider with 30-min ticks"
```
