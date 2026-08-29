import { Plus, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <Label className="text-sm font-medium">Availability</Label>
      {fields.map((field, index) => {
        const currentDays = slotsValue?.[index]?.days || [];

        return (
          <div
            key={field.id}
            className="space-y-3 rounded-md border p-3 bg-card"
          >
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
        <Plus className="size-4" aria-hidden /> Add slot
      </Button>
    </fieldset>
  );
}
