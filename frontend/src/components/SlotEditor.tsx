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
