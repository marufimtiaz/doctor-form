# Availability UI/UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement visual color-coded shift segments, real-time weekly schedule summary badges, overlap conflict detection, hover sync, and `-30m` / `+30m` quick adjustment step buttons in the Availability Schedule editor.

**Architecture:** Component-level UI enhancements in `frontend/src/components/SlotEditor.tsx` built on top of the validated `surveySchema` and `toBackendSlots` helper.

**Tech Stack:** React, React Hook Form, Lucide React, Tailwind CSS / Shadcn UI components.

## Global Constraints

- Day names: `Sat`, `Sun`, `Mon`, `Tue`, `Wed`, `Thu`, `Fri`
- Time range: `06:00` to `23:00` in 30-minute intervals
- Zero backend database or API schema changes

---

### Task 1: Update `SlotEditor.tsx` with Header Stats, Color-Coded Shifts, Overlap Alerts & Time Nudge Buttons

**Files:**
- Modify: `frontend/src/components/SlotEditor.tsx`

**Interfaces:**
- Consumes: `control: Control<SurveyForm>` and `setValue: UseFormSetValue<SurveyForm>`.
- Renders:
  - Header Summary Badges (`Total Weekly Hours`, `Active Days`, `Estimated Patient Capacity`).
  - Color-coded shift segments (`Morning`: Amber, `Afternoon`: Sky, `Evening`: Indigo, `Night`: Slate).
  - Overlap Conflict Alert banner + warning striped timeline segments when shifts overlap.
  - Interactive hover sync between Shift cards and Timeline track segments.
  - `-30m` / `+30m` time adjustment buttons.

- [ ] **Step 1: Implement UI/UX Overhaul in `SlotEditor.tsx`**

Modify `frontend/src/components/SlotEditor.tsx`:

```tsx
import { AlertTriangle, Clock, Plus, Trash2, Users, X } from "lucide-react";
import { useState } from "react";
import {
  useFieldArray,
  useWatch,
  type Control,
  type UseFormSetValue,
} from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
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
  { label: "Morning (9 AM–1 PM)", start: "09:00", end: "13:00" },
  { label: "Afternoon (3 PM–6 PM)", start: "15:00", end: "18:00" },
  { label: "Evening (5 PM–8 PM)", start: "17:00", end: "20:00" },
  { label: "Night (7 PM–10 PM)", start: "19:00", end: "22:00" },
];

// 30-minute interval options (06:00 to 23:00)
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

// Get color scheme based on start time
function getShiftColorScheme(startStr: string) {
  if (!startStr) return { bg: "bg-primary/80", border: "border-primary", text: "text-primary" };
  const [h] = startStr.split(":").map(Number);
  if (h < 12) return { bg: "bg-amber-500", border: "border-amber-500", text: "text-amber-600 bg-amber-50" };
  if (h < 17) return { bg: "bg-sky-500", border: "border-sky-500", text: "text-sky-600 bg-sky-50" };
  if (h < 20) return { bg: "bg-indigo-600", border: "border-indigo-600", text: "text-indigo-600 bg-indigo-50" };
  return { bg: "bg-slate-700", border: "border-slate-700", text: "text-slate-700 bg-slate-100" };
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

function timeToPercent(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  const mins = h * 60 + m;
  const startMins = 8 * 60;
  const endMins = 23 * 60;
  const clamped = Math.max(startMins, Math.min(endMins, mins));
  return ((clamped - startMins) / (endMins - startMins)) * 100;
}

// Adjust time string by offset minutes (clamped between 06:00 and 23:00)
function adjustTime(timeStr: string, deltaMins: number): string {
  if (!timeStr) return timeStr;
  const [h, m] = timeStr.split(":").map(Number);
  const totalMins = Math.max(6 * 60, Math.min(23 * 60, h * 60 + m + deltaMins));
  const newH = String(Math.floor(totalMins / 60)).padStart(2, "0");
  const newM = String(totalMins % 60).padStart(2, "0");
  return `${newH}:${newM}`;
}

// Check for overlapping ranges in a single slot group
function findOverlaps(ranges: Array<{ start_time: string; end_time: string }>) {
  const overlaps: string[] = [];
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const r1 = ranges[i];
      const r2 = ranges[j];
      if (!r1.start_time || !r1.end_time || !r2.start_time || !r2.end_time) continue;
      const startMax = r1.start_time > r2.start_time ? r1.start_time : r2.start_time;
      const endMin = r1.end_time < r2.end_time ? r1.end_time : r2.end_time;
      if (startMax < endMin) {
        overlaps.push(`Shift ${i + 1} and Shift ${j + 1} overlap (${startMax} – ${endMin})`);
      }
    }
  }
  return overlaps;
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
  const avgDuration = useWatch({ control, name: "avg_duration_min" });
  const [hoveredShift, setHoveredShift] = useState<{
    groupIndex: number;
    rangeIndex: number;
  } | null>(null);

  // Compute live schedule statistics
  const activeDaysSet = new Set<DayName>();
  let totalWeeklyMins = 0;

  (slotsValue || []).forEach((slot) => {
    const daysCount = slot.days?.length || 0;
    (slot.days || []).forEach((d) => activeDaysSet.add(d));
    (slot.ranges || []).forEach((r) => {
      if (r.start_time && r.end_time && r.end_time > r.start_time) {
        const [sh, sm] = r.start_time.split(":").map(Number);
        const [eh, em] = r.end_time.split(":").map(Number);
        const durationMins = eh * 60 + em - (sh * 60 + sm);
        totalWeeklyMins += durationMins * daysCount;
      }
    });
  });

  const totalWeeklyHours = (totalWeeklyMins / 60).toFixed(1).replace(/\.0$/, "");
  const durationNum = Number(avgDuration) || 10;
  const estimatedCapacity = Math.floor(totalWeeklyMins / durationNum);

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

  const nudgeTime = (
    slotIndex: number,
    rangeIndex: number,
    field: "start_time" | "end_time",
    deltaMins: number,
  ) => {
    const currentVal = slotsValue?.[slotIndex]?.ranges?.[rangeIndex]?.[field] || "";
    const nextVal = adjustTime(currentVal, deltaMins);
    setValue(`slots.${slotIndex}.ranges.${rangeIndex}.${field}`, nextVal, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  return (
    <fieldset className="space-y-6 rounded-lg border p-4 bg-card">
      {/* Header Summary Badges Bar */}
      <div className="space-y-2 border-b pb-3">
        <div className="flex items-center justify-between">
          <Label className="text-base font-bold">Availability Schedule</Label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-semibold text-primary">
            <Clock className="size-3.5" />
            {totalWeeklyHours} hrs/week
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 font-semibold text-secondary-foreground">
            🗓️ {activeDaysSet.size} active day{activeDaysSet.size !== 1 ? "s" : ""}
          </span>
          {estimatedCapacity > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Users className="size-3.5" />
              ~{estimatedCapacity} max patients/week
            </span>
          )}
        </div>
      </div>

      {fields.map((field, index) => {
        const currentDays = slotsValue?.[index]?.days || [];
        const currentRanges = slotsValue?.[index]?.ranges || [];
        const overlaps = findOverlaps(currentRanges);

        return (
          <div
            key={field.id}
            className="space-y-4 rounded-lg border bg-background p-4 shadow-sm transition-all"
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
                      i % 2 === 0
                        ? "bg-muted-foreground/30"
                        : "bg-muted-foreground/15"
                    }`}
                    style={{ left: `${(i / 30) * 100}%` }}
                  />
                ))}
                {/* Visual Color-Coded Segments for Active Ranges */}
                {currentRanges.map((range, rIdx) => {
                  const left = timeToPercent(range.start_time);
                  const right = timeToPercent(range.end_time);
                  const width = Math.max(0, right - left);
                  const colors = getShiftColorScheme(range.start_time);
                  const isHovered =
                    hoveredShift?.groupIndex === index &&
                    hoveredShift?.rangeIndex === rIdx;

                  return (
                    <div
                      key={rIdx}
                      className={`absolute top-0 bottom-0 ${colors.bg} transition-all rounded-sm ${
                        isHovered ? "ring-2 ring-foreground z-10 scale-y-110" : "opacity-90"
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`Shift ${rIdx + 1}: ${range.start_time} - ${range.end_time}`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Overlap Conflict Warning Alert */}
            {overlaps.length > 0 && (
              <Alert variant="destructive" className="py-2">
                <AlertTriangle className="size-4" />
                <AlertDescription className="text-xs font-medium">
                  {overlaps.join(" · ")}
                </AlertDescription>
              </Alert>
            )}

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
                const colors = getShiftColorScheme(range.start_time);
                const isHovered =
                  hoveredShift?.groupIndex === index &&
                  hoveredShift?.rangeIndex === rangeIndex;

                return (
                  <div
                    key={rangeIndex}
                    onMouseEnter={() =>
                      setHoveredShift({ groupIndex: index, rangeIndex })
                    }
                    onMouseLeave={() => setHoveredShift(null)}
                    className={`flex flex-wrap items-center gap-2 rounded-md border p-2.5 bg-card transition-all border-l-4 ${colors.border} ${
                      isHovered ? "ring-2 ring-primary/40 shadow-sm" : ""
                    }`}
                  >
                    <span className="text-xs font-bold min-w-16">
                      Shift {rangeIndex + 1}:
                    </span>

                    {/* Start Time Select & Nudge Buttons */}
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-6 text-xs text-muted-foreground"
                        title="Minus 30 mins"
                        onClick={() => nudgeTime(index, rangeIndex, "start_time", -30)}
                      >
                        -
                      </Button>
                      <FormField
                        control={control}
                        name={`slots.${index}.ranges.${rangeIndex}.start_time`}
                        render={({ field: start }) => (
                          <FormItem className="min-w-32">
                            <Select
                              value={start.value}
                              onValueChange={start.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className="h-8 text-xs font-medium">
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-6 text-xs text-muted-foreground"
                        title="Plus 30 mins"
                        onClick={() => nudgeTime(index, rangeIndex, "start_time", 30)}
                      >
                        +
                      </Button>
                    </div>

                    <span className="text-xs font-medium text-muted-foreground">to</span>

                    {/* End Time Select & Nudge Buttons */}
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-6 text-xs text-muted-foreground"
                        title="Minus 30 mins"
                        onClick={() => nudgeTime(index, rangeIndex, "end_time", -30)}
                      >
                        -
                      </Button>
                      <FormField
                        control={control}
                        name={`slots.${index}.ranges.${rangeIndex}.end_time`}
                        render={({ field: end }) => (
                          <FormItem className="min-w-32">
                            <Select
                              value={end.value}
                              onValueChange={end.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className="h-8 text-xs font-medium">
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-6 text-xs text-muted-foreground"
                        title="Plus 30 mins"
                        onClick={() => nudgeTime(index, rangeIndex, "end_time", 30)}
                      >
                        +
                      </Button>
                    </div>

                    {/* Duration Badge */}
                    {duration && (
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${colors.text}`}>
                        ⏱️ {duration}
                      </span>
                    )}

                    {/* Delete Range Button */}
                    {currentRanges.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive ml-auto"
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
git commit -m "feat(ui): implement availability schedule UI/UX overhaul with color coding, conflict alerts, and summary stats"
```
