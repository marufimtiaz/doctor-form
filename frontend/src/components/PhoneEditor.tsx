import { Plus, X } from "lucide-react";
import {
  useFieldArray,
  useFormState,
  type ArrayPath,
  type Control,
  type FieldValues,
  type Path,
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

/** Generic over the form it edits: the hospital carries an optional common
 *  line and each doctor carries their own required numbers, so both forms hold
 *  a `phones` array and both use this editor. */
export default function PhoneEditor<T extends FieldValues>({
  control,
  label = "Phone numbers",
  hint,
  addLabel = "Add number",
  allowEmpty = false,
}: {
  control: Control<T>;
  label?: string;
  hint?: string;
  addLabel?: string;
  /** The hospital's common line may be left out entirely; a doctor's may not. */
  allowEmpty?: boolean;
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "phones" as ArrayPath<T>,
  });
  const { errors } = useFormState({ control, name: "phones" as Path<T> });

  // "Add at least one phone number." is raised against the array itself, so it
  // has no per-row FormMessage to land in - and with no rows left there would
  // be no row to render one anyway. Surfaced here instead.
  const arrayError = (
    errors as Record<
      string,
      { message?: string; root?: { message?: string } } | undefined
    >
  ).phones;
  const arrayMessage = arrayError?.root?.message ?? arrayError?.message;

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <div>
        <Label className="text-sm font-medium">{label}</Label>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
      {fields.map((field, index) => (
        <div key={field.id} className="flex items-start gap-2">
          <FormField
            control={control}
            name={`phones.${index}.value` as Path<T>}
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
          {(allowEmpty || fields.length > 1) && (
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
      {arrayMessage && (
        <p className="text-sm font-medium text-destructive">{arrayMessage}</p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => append({ value: "" } as never)}
      >
        <Plus className="size-4" aria-hidden /> {addLabel}
      </Button>
    </fieldset>
  );
}
