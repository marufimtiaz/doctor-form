import { LocateFixed } from "lucide-react";
import { useEffect, useState } from "react";
import type { Control, UseFormSetValue } from "react-hook-form";

import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SurveyForm } from "@/schemas/survey";

export default function LocationInput({
  control,
  setValue,
}: {
  control: Control<SurveyForm>;
  setValue: UseFormSetValue<SurveyForm>;
}) {
  const [geoState, setGeoState] = useState<"idle" | "asking" | "ok" | "denied">(
    "idle",
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState("ok");
        // setValue rather than a controlled object: the agent may already be
        // typing when this resolves, and only these two fields should move.
        setValue("latitude", pos.coords.latitude.toFixed(6));
        setValue("longitude", pos.coords.longitude.toFixed(6));
      },
      // Denial is expected and must not block the form - city and district
      // satisfy the requirement on their own.
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [setValue]);

  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">Location</Label>
        {geoState === "asking" && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <LocateFixed className="size-3 animate-pulse" aria-hidden />
            Finding your position…
          </span>
        )}
      </div>
      {geoState === "denied" && (
        <p className="text-xs text-muted-foreground">
          No GPS fix. Type coordinates by hand, or just fill in city and
          district.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <FormField
          control={control}
          name="latitude"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="Latitude" inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="longitude"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="Longitude" inputMode="decimal" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="City" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="district"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder="District" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </fieldset>
  );
}
