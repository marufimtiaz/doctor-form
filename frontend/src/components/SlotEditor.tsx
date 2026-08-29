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
  { label: "Morning (9 AM–1 PM)", start: "09:00", end: "13:00" },
  { label: "Afternoon (3 PM–6 PM)", start: "15:00", end: "18:00" },
  { label: "Evening (5 PM–8 PM)", start: "17:00", end: "20:00" },
  { label: "Night (7 PM–10 PM)", start: "19:00", end: "22:00" },
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
                      i % 2 === 0
                        ? "bg-muted-foreground/30"
                        : "bg-muted-foreground/15"
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
