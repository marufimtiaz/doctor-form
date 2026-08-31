import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";

import LocationInput from "@/components/LocationInput";
import PhoneEditor from "@/components/PhoneEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useHospital } from "@/hospital";
import { cn } from "@/lib/utils";
import {
  emptyHospitalValues,
  hospitalSchema,
  type HospitalForm,
} from "@/schemas/survey";

export default function HospitalPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { hospital, startHospital } = useHospital();

  if (hospital) {
    return <Navigate to="/doctors" replace />;
  }

  const form = useForm<HospitalForm>({
    resolver: zodResolver(hospitalSchema),
    defaultValues: emptyHospitalValues(),
  });

  function onSubmit(values: HospitalForm) {
    startHospital(values);
    navigate("/doctors");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("hospital.title")}</h1>
      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="hospital_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("hospital.hospital_name")}</FormLabel>
                    <FormControl>
                      <Input maxLength={200} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="has_emergency_service"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-sm font-medium">
                      {t("hospital.emergency_service")}
                    </FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <button
                          type="button"
                          className={cn(
                            "flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all cursor-pointer select-none",
                            field.value
                              ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold shadow-xs"
                              : "border-input bg-background hover:bg-accent text-muted-foreground",
                          )}
                          onClick={() => field.onChange(true)}
                        >
                          <span className="text-xl">🚨</span>
                          <span className="text-xs font-bold">
                            {t("hospital.emergency_yes")}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 p-3 text-center transition-all cursor-pointer select-none",
                            !field.value
                              ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                              : "border-input bg-background hover:bg-accent text-muted-foreground",
                          )}
                          onClick={() => field.onChange(false)}
                        >
                          <span className="text-xl">🏥</span>
                          <span className="text-xs font-bold">
                            {t("hospital.emergency_no")}
                          </span>
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

                <LocationInput
                  control={form.control}
                  setValue={form.setValue}
                  getValues={form.getValues}
                />
                <PhoneEditor
                  control={form.control}
                  label={t("hospital.common_booking_number")}
                  addLabel={t("hospital.add_common_number")}
                  allowEmpty
                />

                <Button
                  type="submit"
                  className="w-full sm:w-auto font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-md transition-all"
                >
                  {t("hospital.start_adding_doctors")}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
    </main>
  );
}
