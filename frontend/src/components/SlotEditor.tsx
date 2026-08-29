import { AlertTriangle, Clock, Plus, Trash2, Users, X } from "lucide-react";
import { useRef, useState } from "react";
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

// Presets with ZERO time overlap
const SHIFT_PRESETS = [
  { label: "Morning (9 AM–1 PM)", start: "09:00", end: "13:00" },
  { label: "Afternoon (2 PM–5 PM)", start: "14:00", end: "17:00" },
  { label: "Evening (5 PM–8 PM)", start: "17:00", end: "20:00" },
  { label: "Night (8 PM–11 PM)", start: "20:00", end: "23:00" },
];

// 30-minute interval options (06:00 to 24:00)
const TIME_OPTIONS: { value: string; label: string }[] = [];
for (let hour = 6; hour <= 24; hour++) {
  for (let min of [0, 30]) {
    if (hour === 24 && min === 30) continue;
    const hh = String(hour).padStart(2, "0");
    const mm = String(min).padStart(2, "0");
    const value = `${hh}:${mm}`;
    let label = "";
    if (hour === 24 || (hour === 0 && min === 0)) {
      label = "12:00 AM (Midnight)";
    } else {
      const period = hour >= 12 && hour < 24 ? "PM" : "AM";
      const displayHour = hour % 12 === 0 ? 12 : hour % 12;
      label = `${String(displayHour).padStart(2, "0")}:${mm} ${period}`;
    }
    TIME_OPTIONS.push({ value, label });
  }
}

const TIMELINE_START_MINS = 8 * 60; // 8 AM
const TIMELINE_END_MINS = 24 * 60; // 12 AM Midnight
const TOTAL_TIMELINE_MINS = TIMELINE_END_MINS - TIMELINE_START_MINS;

function getShiftColorScheme(startStr: string) {
  if (!startStr) return { bg: "bg-primary", border: "border-primary", text: "text-primary bg-primary/10" };
  const [h] = startStr.split(":").map(Number);
  if (h < 12) return { bg: "bg-amber-500", border: "border-amber-500", text: "text-amber-600 bg-amber-50 dark:bg-amber-950 dark:text-amber-300" };
  if (h < 17) return { bg: "bg-sky-500", border: "border-sky-500", text: "text-sky-600 bg-sky-50 dark:bg-sky-950 dark:text-sky-300" };
  if (h < 20) return { bg: "bg-indigo-600", border: "border-indigo-600", text: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950 dark:text-indigo-300" };
  return { bg: "bg-slate-700", border: "border-slate-700", text: "text-slate-700 bg-slate-100 dark:bg-slate-900 dark:text-slate-300" };
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
  const clamped = Math.max(TIMELINE_START_MINS, Math.min(TIMELINE_END_MINS, mins));
  return ((clamped - TIMELINE_START_MINS) / TOTAL_TIMELINE_MINS) * 100;
}

function percentToTime(percent: number): string {
  const clampedPct = Math.max(0, Math.min(100, percent));
  const rawMins = TIMELINE_START_MINS + (clampedPct / 100) * TOTAL_TIMELINE_MINS;
  const snappedMins = Math.round(rawMins / 30) * 30;
  const clampedMins = Math.max(6 * 60, Math.min(24 * 60, snappedMins));
  const h = String(Math.floor(clampedMins / 60)).padStart(2, "0");
  const m = String(clampedMins % 60).padStart(2, "0");
  return `${h}:${m}`;
}

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

function findFarthestFreeSlot(ranges: Array<{ start_time: string; end_time: string }>): { start: string; end: string } | null {
  const totalSlots = 32; // (24 - 8) * 2
  const isOccupied = new Array(totalSlots).fill(false);

  ranges.forEach((r) => {
    if (!r.start_time || !r.end_time) return;
    const [sh, sm] = r.start_time.split(":").map(Number);
    const [eh, em] = r.end_time.split(":").map(Number);
    const sIdx = Math.max(0, Math.floor((sh * 60 + sm - TIMELINE_START_MINS) / 30));
    const eIdx = Math.min(totalSlots, Math.ceil((eh * 60 + em - TIMELINE_START_MINS) / 30));
    for (let i = sIdx; i < eIdx; i++) {
      if (i >= 0 && i < totalSlots) isOccupied[i] = true;
    }
  });

  const freeIndices = isOccupied.map((occ, idx) => (occ ? -1 : idx)).filter((idx) => idx !== -1);
  if (freeIndices.length === 0) return null;

  const occIndices = isOccupied.map((occ, idx) => (occ ? idx : -1)).filter((idx) => idx !== -1);

  if (occIndices.length === 0) {
    return { start: "17:00", end: "20:00" };
  }

  let maxDist = -1;
  let bestSlotIndex = freeIndices[0];

  freeIndices.forEach((fIdx) => {
    const minDistToOcc = Math.min(...occIndices.map((oIdx) => Math.abs(fIdx - oIdx)));
    if (minDistToOcc > maxDist) {
      maxDist = minDistToOcc;
      bestSlotIndex = fIdx;
    }
  });

  const startMins = TIMELINE_START_MINS + bestSlotIndex * 30;
  const endMins = Math.min(TIMELINE_END_MINS, startMins + 60);
  const sh = String(Math.floor(startMins / 60)).padStart(2, "0");
  const sm = String(startMins % 60).padStart(2, "0");
  const eh = String(Math.floor(endMins / 60)).padStart(2, "0");
  const em = String(endMins % 60).padStart(2, "0");

  return { start: `${sh}:${sm}`, end: `${eh}:${em}` };
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

  const timelineRefs = useRef<Record<number, HTMLDivElement | null>>({});

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

  const addSmartHandle = (slotIndex: number) => {
    const currentRanges = slotsValue?.[slotIndex]?.ranges || [];
    if (currentRanges.length >= 2) return;
    const freeSlot = findFarthestFreeSlot(currentRanges);
    if (!freeSlot) return;
    setValue(
      `slots.${slotIndex}.ranges`,
      [...currentRanges, { start_time: freeSlot.start, end_time: freeSlot.end }],
      { shouldValidate: true, shouldDirty: true },
    );
  };

  const addRange = (slotIndex: number, start = "17:00", end = "20:00") => {
    const currentRanges = slotsValue?.[slotIndex]?.ranges || [];
    if (currentRanges.length >= 2) return; // Enforce max 2 shifts
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

  const handlePointerDrag = (
    e: React.PointerEvent,
    slotIndex: number,
    rangeIndex: number,
    field: "start_time" | "end_time",
  ) => {
    const trackEl = timelineRefs.current[slotIndex];
    if (!trackEl) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const updateFromPointer = (pe: React.PointerEvent | PointerEvent) => {
      const rect = trackEl.getBoundingClientRect();
      const clientX = pe.clientX;
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const nextTime = percentToTime(pct);

      const currentRange = slotsValue?.[slotIndex]?.ranges?.[rangeIndex];
      if (!currentRange) return;

      if (field === "start_time" && currentRange.end_time && nextTime >= currentRange.end_time) {
        return;
      }
      if (field === "end_time" && currentRange.start_time && nextTime <= currentRange.start_time) {
        return;
      }

      setValue(`slots.${slotIndex}.ranges.${rangeIndex}.${field}`, nextTime, {
        shouldValidate: true,
        shouldDirty: true,
      });
    };

    updateFromPointer(e);

    const onPointerMove = (pe: PointerEvent) => updateFromPointer(pe);
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  return (
    <fieldset className="space-y-6 rounded-lg border p-3 sm:p-4 bg-card">
      {/* Header Summary Badges Bar */}
      <div className="space-y-2 border-b pb-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm sm:text-base font-bold">Availability Schedule</Label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-xs">
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
        const freeSlotAvailable = currentRanges.length < 2 && findFarthestFreeSlot(currentRanges) !== null;

        return (
          <div
            key={field.id}
            className="space-y-4 rounded-lg border bg-background p-3 sm:p-4 shadow-sm transition-all"
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

            {/* 8 AM - 12 AM Timeline Track Container */}
            <div className="space-y-2 rounded-md bg-muted/40 p-2.5 sm:p-3">
              {/* Header Row with Title & Handle Pair Button */}
              <div className="flex items-center justify-between gap-2 border-b border-muted pb-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Timeline Track (8 AM – 12 AM)
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!freeSlotAvailable}
                  className="h-6 px-2 text-[11px] font-semibold shrink-0"
                  title={
                    currentRanges.length >= 2
                      ? "Max 2 handle pairs allowed per group"
                      : !freeSlotAvailable
                      ? "No free 30-min slot available"
                      : "Add handle pair in farthest free slot"
                  }
                  onClick={() => addSmartHandle(index)}
                >
                  <Plus className="mr-1 size-3" /> Handle Pair
                </Button>
              </div>

              {/* Time Labels Spanning 8 AM to 12 AM (Midnight) */}
              <div className="flex justify-between text-[10px] font-medium text-muted-foreground w-full px-0.5">
                <span>8 AM</span>
                <span>12 PM</span>
                <span>4 PM</span>
                <span>8 PM</span>
                <span>12 AM</span>
              </div>

              {/* Timeline Track */}
              <div
                ref={(el) => {
                  timelineRefs.current[index] = el;
                }}
                className="relative h-6 w-full rounded-full bg-muted border select-none touch-none"
              >
                {/* 30-min tick marks (32 slots) */}
                {Array.from({ length: 33 }).map((_, i) => (
                  <div
                    key={i}
                    className={`absolute top-0 bottom-0 w-px ${
                      i % 2 === 0
                        ? "bg-muted-foreground/30"
                        : "bg-muted-foreground/15"
                    }`}
                    style={{ left: `${(i / 32) * 100}%` }}
                  />
                ))}

                {/* Color-Coded Segments & Sleek Drag Knobs */}
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
                      className={`absolute top-0 bottom-0 ${colors.bg} transition-all rounded-sm flex items-center justify-between ${
                        isHovered ? "ring-2 ring-foreground z-10" : "opacity-90"
                      }`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      {/* Left Drag Handle Knob */}
                      <div
                        onPointerDown={(e) =>
                          handlePointerDrag(e, index, rIdx, "start_time")
                        }
                        className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-4 h-7 bg-background border-2 border-primary rounded-md shadow-md cursor-ew-resize hover:scale-110 active:scale-125 z-20 flex items-center justify-center touch-none"
                        title={`Drag Start Time (${range.start_time})`}
                      >
                        <div className="w-0.5 h-3 bg-primary/80 rounded-full" />
                      </div>

                      {/* Right Drag Handle Knob */}
                      <div
                        onPointerDown={(e) =>
                          handlePointerDrag(e, index, rIdx, "end_time")
                        }
                        className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-7 bg-background border-2 border-primary rounded-full shadow-md cursor-ew-resize hover:scale-110 active:scale-125 z-20 flex items-center justify-center touch-none"
                        title={`Drag End Time (${range.end_time})`}
                      >
                        <div className="w-0.5 h-3 bg-primary/80 rounded-full" />
                      </div>
                    </div>
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

            {/* Ultra-Clean, Non-Bloated Shift Rows */}
            <div className="space-y-2">
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
                    className={`space-y-2 p-2.5 rounded-md bg-card border-l-4 ${colors.border} ${
                      isHovered ? "ring-2 ring-primary/40 shadow-sm" : ""
                    }`}
                  >
                    {/* Header Row: Shift Title + Duration Badge + Delete Icon */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold">
                        Shift {rangeIndex + 1}:
                      </span>
                      <div className="flex items-center gap-1.5 ml-auto">
                        {duration && (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${colors.text}`}>
                            ⏱️ {duration}
                          </span>
                        )}
                        {currentRanges.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => removeRange(index, rangeIndex)}
                            aria-label="Remove shift range"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Inputs Row: Full-width responsive start/end selects */}
                    <div className="flex items-center gap-2">
                      <FormField
                        control={control}
                        name={`slots.${index}.ranges.${rangeIndex}.start_time`}
                        render={({ field: start }) => (
                          <FormItem className="m-0 flex-1 min-w-0">
                            <Select
                              value={start.value}
                              onValueChange={start.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className="h-8 w-full text-xs font-medium bg-background">
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

                      <span className="text-xs font-medium text-muted-foreground shrink-0">to</span>

                      <FormField
                        control={control}
                        name={`slots.${index}.ranges.${rangeIndex}.end_time`}
                        render={({ field: end }) => (
                          <FormItem className="m-0 flex-1 min-w-0">
                            <Select
                              value={end.value}
                              onValueChange={end.onChange}
                            >
                              <FormControl>
                                <SelectTrigger className="h-8 w-full text-xs font-medium bg-background">
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
                    </div>
                  </div>
                );
              })}

              {/* Bottom Presets & Add Shift Range (ONLY SHOWN IF < 2 SHIFTS) */}
              {currentRanges.length < 2 ? (
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
              ) : (
                <div className="text-[11px] font-medium text-muted-foreground pt-1 italic text-center sm:text-left">
                  ✓ Maximum 2 shift ranges added for this group.
                </div>
              )}
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
