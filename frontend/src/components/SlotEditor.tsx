import { AlertTriangle, Plus, Trash2, X } from "lucide-react";
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

function sortRanges(ranges: Array<{ start_time: string; end_time: string }>) {
  return [...ranges].sort((a, b) => a.start_time.localeCompare(b.start_time));
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

// Strictly filter dropdown options based on adjacent shift boundaries
function getFilteredTimeOptions(
  field: "start_time" | "end_time",
  rangeIndex: number,
  ranges: Array<{ start_time: string; end_time: string }>,
) {
  const range = ranges[rangeIndex];
  if (!range) return TIME_OPTIONS;

  if (rangeIndex === 0) {
    // Shift 1
    const nextShift = ranges[1];
    const maxBound = nextShift?.start_time || "24:00";

    if (field === "start_time") {
      // Must be < end_time and < maxBound
      const upper = range.end_time && range.end_time < maxBound ? range.end_time : maxBound;
      return TIME_OPTIONS.filter((t) => t.value < upper);
    } else {
      // end_time: Must be > start_time and <= maxBound
      const lower = range.start_time || "06:00";
      return TIME_OPTIONS.filter((t) => t.value > lower && t.value <= maxBound);
    }
  } else {
    // Shift 2
    const prevShift = ranges[0];
    const minBound = prevShift?.end_time || "06:00";

    if (field === "start_time") {
      // Must be >= minBound and < end_time
      const upper = range.end_time || "24:00";
      return TIME_OPTIONS.filter((t) => t.value >= minBound && t.value < upper);
    } else {
      // end_time: Must be > start_time
      const lower = range.start_time || minBound;
      return TIME_OPTIONS.filter((t) => t.value > lower);
    }
  }
}

function findFarthestFreeSlot(ranges: Array<{ start_time: string; end_time: string }>): { start: string; end: string } | null {
  const totalSlots = 32;
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
  const [hoveredShift, setHoveredShift] = useState<{
    groupIndex: number;
    rangeIndex: number;
  } | null>(null);

  const timelineRefs = useRef<Record<number, HTMLDivElement | null>>({});

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

  const updateSortedRanges = (slotIndex: number, ranges: Array<{ start_time: string; end_time: string }>) => {
    const sorted = sortRanges(ranges);
    setValue(`slots.${slotIndex}.ranges`, sorted, {
      shouldValidate: true,
      shouldDirty: true,
    });
  };

  const addSmartHandle = (slotIndex: number) => {
    const currentRanges = slotsValue?.[slotIndex]?.ranges || [];
    if (currentRanges.length >= 2) return;
    const freeSlot = findFarthestFreeSlot(currentRanges);
    if (!freeSlot) return;
    updateSortedRanges(slotIndex, [...currentRanges, { start_time: freeSlot.start, end_time: freeSlot.end }]);
  };

  const addRange = (slotIndex: number, start = "17:00", end = "20:00") => {
    const currentRanges = slotsValue?.[slotIndex]?.ranges || [];
    if (currentRanges.length >= 2) return;
    updateSortedRanges(slotIndex, [...currentRanges, { start_time: start, end_time: end }]);
  };

  const removeRange = (slotIndex: number, rangeIndex: number) => {
    const currentRanges = slotsValue?.[slotIndex]?.ranges || [];
    if (currentRanges.length <= 1) return;
    const remaining = currentRanges.filter((_, i) => i !== rangeIndex);
    updateSortedRanges(slotIndex, remaining);
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

      const currentRanges = [...(slotsValue?.[slotIndex]?.ranges || [])];
      const currentRange = currentRanges[rangeIndex];
      if (!currentRange) return;

      if (rangeIndex === 0) {
        const maxBound = currentRanges[1]?.start_time || "24:00";
        if (field === "start_time" && nextTime >= (currentRange.end_time < maxBound ? currentRange.end_time : maxBound)) return;
        if (field === "end_time" && (nextTime <= currentRange.start_time || nextTime > maxBound)) return;
      } else {
        const minBound = currentRanges[0]?.end_time || "06:00";
        if (field === "start_time" && (nextTime < minBound || nextTime >= currentRange.end_time)) return;
        if (field === "end_time" && nextTime <= currentRange.start_time) return;
      }

      currentRanges[rangeIndex] = { ...currentRange, [field]: nextTime };
      updateSortedRanges(slotIndex, currentRanges);
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
      <div className="flex items-center justify-between border-b pb-3">
        <Label className="text-sm sm:text-base font-bold">Availability Schedule</Label>
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

            {/* Timeline Track Container */}
            <div className="space-y-2 rounded-md bg-muted/40 p-2.5 sm:p-3">
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

              <div className="flex justify-between text-[10px] font-medium text-muted-foreground w-full px-0.5">
                <span>8 AM</span>
                <span>12 PM</span>
                <span>4 PM</span>
                <span>8 PM</span>
                <span>12 AM</span>
              </div>

              <div
                ref={(el) => {
                  timelineRefs.current[index] = el;
                }}
                className="relative h-6 w-full rounded-full bg-muted border select-none touch-none"
              >
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
                      <div
                        onPointerDown={(e) =>
                          handlePointerDrag(e, index, rIdx, "start_time")
                        }
                        className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-4 h-7 bg-background border-2 border-primary rounded-md shadow-md cursor-ew-resize hover:scale-110 active:scale-125 z-20 flex items-center justify-center touch-none"
                        title={`Drag Start Time (${range.start_time})`}
                      >
                        <div className="w-0.5 h-3 bg-primary/80 rounded-full" />
                      </div>

                      <div
                        onPointerDown={(e) =>
                          handlePointerDrag(e, index, rIdx, "end_time")
                        }
                        className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-4 h-7 bg-background border-2 border-primary rounded-md shadow-md cursor-ew-resize hover:scale-110 active:scale-125 z-20 flex items-center justify-center touch-none"
                        title={`Drag End Time (${range.end_time})`}
                      >
                        <div className="w-0.5 h-3 bg-primary/80 rounded-full" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Preset Chips directly under the timeline bar */}
              {currentRanges.length < 2 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-muted/50">
                  <div className="flex flex-wrap gap-1">
                    {SHIFT_PRESETS.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px] bg-background"
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
                <div className="text-[11px] font-medium text-muted-foreground pt-1.5 border-t border-muted/50 italic text-center sm:text-left">
                  ✓ Maximum 2 shift ranges added for this group.
                </div>
              )}
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

            {/* Shift Rows */}
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

                const startOptions = getFilteredTimeOptions("start_time", rangeIndex, currentRanges);
                const endOptions = getFilteredTimeOptions("end_time", rangeIndex, currentRanges);

                const handleTimeChange = (field: "start_time" | "end_time", value: string) => {
                  const updated = [...currentRanges];
                  updated[rangeIndex] = { ...updated[rangeIndex], [field]: value };
                  updateSortedRanges(index, updated);
                };

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

                    <div className="flex items-center gap-2">
                      <FormField
                        control={control}
                        name={`slots.${index}.ranges.${rangeIndex}.start_time`}
                        render={({ field: start }) => (
                          <FormItem className="m-0 flex-1 min-w-0">
                            <Select
                              value={start.value}
                              onValueChange={(val) => handleTimeChange("start_time", val)}
                            >
                              <FormControl>
                                <SelectTrigger className="h-8 w-full text-xs font-medium bg-background">
                                  <SelectValue placeholder="Start Time" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="max-h-56">
                                {startOptions.map((t) => (
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
                              onValueChange={(val) => handleTimeChange("end_time", val)}
                            >
                              <FormControl>
                                <SelectTrigger className="h-8 w-full text-xs font-medium bg-background">
                                  <SelectValue placeholder="End Time" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="max-h-56">
                                {endOptions.map((t) => (
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
