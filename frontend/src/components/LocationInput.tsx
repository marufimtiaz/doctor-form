import { CheckCircle2, Loader2, MapPin, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  Control,
  UseFormGetValues,
  UseFormSetValue,
} from "react-hook-form";
import { useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { HospitalForm } from "@/schemas/survey";

export default function LocationInput({
  control,
  setValue,
}: {
  control: Control<HospitalForm>;
  setValue: UseFormSetValue<HospitalForm>;
  getValues: UseFormGetValues<HospitalForm>;
}) {
  const { t } = useTranslation();
  const [geoState, setGeoState] = useState<"idle" | "asking" | "ok" | "denied">(
    "idle",
  );

  const latitude = useWatch({ control, name: "latitude" }) ?? "";
  const longitude = useWatch({ control, name: "longitude" }) ?? "";

  const hasCoords = Boolean(latitude.trim() && longitude.trim());

  const getGPS = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoState("denied");
      return;
    }
    setGeoState("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoState("ok");
        const latStr = pos.coords.latitude.toFixed(6);
        const lngStr = pos.coords.longitude.toFixed(6);
        setValue("latitude", latStr, { shouldValidate: true });
        setValue("longitude", lngStr, { shouldValidate: true });
      },
      () => setGeoState("denied"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [setValue]);

  useEffect(() => {
    getGPS();
  }, [getGPS]);

  const clearCoords = () => {
    setValue("latitude", "", { shouldValidate: true });
    setValue("longitude", "", { shouldValidate: true });
  };

  return (
    <fieldset className="space-y-4 rounded-lg border p-4 bg-card">
      <div className="flex items-center justify-between border-b pb-2">
        <Label className="text-sm font-semibold">{t("hospital.location_details")}</Label>
      </div>

      {/* GPS Primary Section */}
      <div className="space-y-2">
        <Button
          type="button"
          size="lg"
          className="w-full h-12 text-sm font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md flex items-center justify-center gap-2 transition-all"
          onClick={getGPS}
          disabled={geoState === "asking"}
        >
          {geoState === "asking" ? (
            <>
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              {t("hospital.locating_gps")}
            </>
          ) : hasCoords ? (
            <>
              <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
              {t("hospital.update_gps")}
            </>
          ) : (
            <>
              <MapPin className="size-4" aria-hidden />
              {t("hospital.locate_me")}
            </>
          )}
        </Button>

        {/* Coords Display Badge under the button */}
        {hasCoords ? (
          <div className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
              <MapPin className="size-3.5 shrink-0" aria-hidden />
              {t("hospital.gps_coords")}: <code className="font-mono">{latitude}, {longitude}</code>
            </span>
            <button
              type="button"
              onClick={clearCoords}
              className="text-muted-foreground hover:text-destructive p-0.5 rounded-xs"
              title="Clear coordinates"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ) : geoState === "denied" ? (
          <p className="text-xs text-amber-600 dark:text-amber-400 text-center font-medium">
            {t("hospital.gps_denied")}
          </p>
        ) : null}
      </div>

      {/* City & District Inputs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <FormField
          control={control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <Input placeholder={t("hospital.city_placeholder")} {...field} />
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
                <Input placeholder={t("hospital.district_placeholder")} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </fieldset>
  );
}
