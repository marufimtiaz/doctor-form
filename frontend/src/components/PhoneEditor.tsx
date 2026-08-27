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
