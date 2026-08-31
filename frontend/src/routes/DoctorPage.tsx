import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

import { createSurvey, previewNameplate } from "@/api";
import NameplateInput from "@/components/NameplateInput";
import PhoneEditor from "@/components/PhoneEditor";
import SlotEditor from "@/components/SlotEditor";
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
import { Label } from "@/components/ui/label";
import { useHospital } from "@/hospital";
import { useScrollDistractFree } from "@/hooks/useScrollDistractFree";
import {
  base64ToFile,
  clearDoctorDraft,
  fileToBase64,
  readDoctorDraft,
  writeDoctorDraft,
} from "@/lib/doctorDraft";
import { cn } from "@/lib/utils";
import {
  doctorSchema,
  emptyDoctorValues,
  surveySchema,
  toBackendSlots,
  type DoctorForm,
} from "@/schemas/survey";

export default function DoctorPage() {
  const { t } = useTranslation();
  const { hospital, recordDoctor } = useHospital();
  const navHidden = useScrollDistractFree();

  const [nameplate, setNameplate] = useState<File | null>(null);
  const [nameplateError, setNameplateError] = useState<string | null>(null);
  // Remounts NameplateInput after each submit: an <input type="file"> keeps
  // its own value, so clearing the File state alone leaves the old filename
  // showing under the next doctor's form.
  const [resetKey, setResetKey] = useState(0);

  // The hospital's common line, when it has one, is the starting point for
  // every doctor filed there; the agent edits or replaces it per doctor.
  const doctorDefaults = useCallback((): DoctorForm => {
    const common = hospital?.phones ?? [];
    return {
      ...emptyDoctorValues(),
      phones: common.length ? common.map((p) => ({ ...p })) : [{ value: "" }],
    };
  }, [hospital]);

  const [ocrState, setOcrState] = useState<
    "idle" | "reading" | "done" | "failed"
  >("idle");
  // An agent can replace the photo while a call is in flight. Without this the
  // slower first response overwrites the second photo's fields, leaving one
  // nameplate's details beside a different nameplate's image - and then stored
  // as approved by a human.
  const previewToken = useRef(0);

  const form = useForm<DoctorForm>({
    resolver: zodResolver(doctorSchema),
    defaultValues: doctorDefaults(),
  });

  const watchedValues = useWatch({ control: form.control });
  const isFormComplete =
    Boolean(nameplate) && doctorSchema.safeParse(watchedValues).success;

  // Restore draft on mount if available
  useEffect(() => {
    const draft = readDoctorDraft();
    if (draft?.values) {
      form.reset(draft.values);
      if (draft.nameplateBase64 && draft.nameplateName) {
        try {
          const f = base64ToFile(
            draft.nameplateBase64,
            draft.nameplateName,
            draft.nameplateType ?? undefined,
          );
          setNameplate(f);
        } catch {
          // ignore corrupted base64
        }
      }
    }
  }, [form]);

  // Save draft whenever form values or nameplate change
  useEffect(() => {
    let active = true;
    const save = async (values: DoctorForm, file: File | null) => {
      let b64: string | null = null;
      if (file) {
        try {
          b64 = await fileToBase64(file);
        } catch {
          b64 = null;
        }
      }
      if (!active) return;
      writeDoctorDraft({
        values,
        nameplateBase64: b64,
        nameplateName: file?.name ?? null,
        nameplateType: file?.type ?? null,
      });
    };

    const subscription = form.watch((v) => {
      void save(v as DoctorForm, nameplate);
    });

    void save(form.getValues(), nameplate);

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [form, nameplate]);

  const readNameplate = async (picked: File | null) => {
    const token = ++previewToken.current;
    form.setValue("doctor_name", "");
    form.setValue("doctor_degrees", "");
    form.setValue("doctor_specializations", "");

    if (!picked) {
      setOcrState("idle");
      return;
    }

    setOcrState("reading");
    try {
      const fields = await previewNameplate(picked);
      if (token !== previewToken.current) return;
      if (!fields) {
        setOcrState("idle");
        return;
      }
      form.setValue("doctor_name", fields.doctor_name ?? "");
      form.setValue("doctor_degrees", fields.doctor_degrees ?? "");
      form.setValue("doctor_specializations", fields.doctor_specializations ?? "");
      setOcrState("done");
    } catch {
      if (token !== previewToken.current) return;
      // Not shouted at the agent: the worker reads it after filing.
      setOcrState("failed");
    }
  };

  if (!hospital) return <Navigate to="/" replace />;

  async function onSubmit(values: DoctorForm) {
    if (!hospital) return;
    if (!nameplate) {
      setNameplateError("A nameplate photo is required.");
      return;
    }
    setNameplateError(null);

    try {
      // The hospital half and the doctor half are disjoint, so this reassembles
      // exactly the object surveySchema has always validated. parseStoredSession
      // guarantees the hospital half passes hospitalSchema, so this cannot throw
      // on a session this build wrote - but it stays inside the try so that a
      // session from some future build fails loudly rather than silently.
      const parsed = surveySchema.parse({ ...hospital, ...values });

      const body = new FormData();
      body.set("hospital_name", parsed.hospital_name);
      body.set("has_emergency_service", String(parsed.has_emergency_service));
      body.set("daily_patients", String(parsed.daily_patients));
      body.set("avg_duration_min", String(parsed.avg_duration_min));
      body.set("consultation_fee_bdt", String(parsed.consultation_fee_bdt));
      // Blank means no preview ran; the server then leaves the row to the worker.
      if (parsed.doctor_name) body.set("doctor_name", parsed.doctor_name);
      if (parsed.doctor_degrees) body.set("doctor_degrees", parsed.doctor_degrees);
      if (parsed.doctor_specializations)
        body.set("doctor_specializations", parsed.doctor_specializations);
      // Multipart cannot nest, so these travel as JSON strings. Phones are
      // objects in the form because useFieldArray requires objects; the API
      // wants bare strings.
      body.set("slots", JSON.stringify(toBackendSlots(parsed.slots)));
      body.set("phones", JSON.stringify(parsed.phones.map((p) => p.value)));
      body.set("nameplate", nameplate);
      if (parsed.city.trim()) body.set("city", parsed.city.trim());
      if (parsed.district.trim()) body.set("district", parsed.district.trim());
      if (parsed.latitude.trim()) body.set("latitude", parsed.latitude.trim());
      if (parsed.longitude.trim()) body.set("longitude", parsed.longitude.trim());

      await createSurvey(body);
      clearDoctorDraft();
      form.reset(doctorDefaults());
      setNameplate(null);
      setResetKey((n) => n + 1);
      // Also discards any preview still in flight for the doctor just filed, so
      // its response cannot land in the next doctor's form.
      void readNameplate(null);
      recordDoctor();
      toast.success("Doctor filed. Next doctor?");
    } catch (err) {
      // Values stay put: a network failure must not cost the agent their typing.
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-4 sm:py-6">
      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <NameplateInput
                key={resetKey}
                file={nameplate}
                onChange={(f) => {
                  setNameplate(f);
                  if (f) setNameplateError(null);
                  void readNameplate(f);
                }}
                error={nameplateError}
              />

              <fieldset className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label className="text-sm font-medium">{t("doctor.doctor_details")}</Label>
                  {ocrState === "reading" ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 border border-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:border-sky-800">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                      {t("doctor.ocr_reading")}
                    </div>
                  ) : ocrState === "done" ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
                      <CheckCircle2 className="size-3.5" aria-hidden />
                      {t("doctor.ocr_autofilled")}
                    </div>
                  ) : ocrState === "failed" ? (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
                      <AlertCircle className="size-3.5" aria-hidden />
                      {t("doctor.ocr_unreadable")}
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-0.5 text-xs font-medium text-muted-foreground border">
                      <Sparkles className="size-3.5 text-primary" aria-hidden />
                      {t("doctor.ocr_idle")}
                    </div>
                  )}
                </div>
                {(
                  [
                    ["doctor_name", t("doctor.doctor_name"), t("doctor.doctor_name_placeholder")],
                    ["doctor_degrees", t("doctor.degrees"), t("doctor.degrees_placeholder")],
                    ["doctor_specializations", t("doctor.specializations"), t("doctor.specializations_placeholder")],
                  ] as const
                ).map(([name, label, placeholder]) => (
                  <FormField
                    key={name}
                    control={form.control}
                    name={name}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs">{label}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={placeholder}
                            value={field.value ?? ""}
                            disabled={ocrState === "reading"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </fieldset>

              <PhoneEditor
                control={form.control}
                label={t("doctor.phone_numbers")}
                addLabel={t("doctor.add_phone_number")}
              />

              <SlotEditor
                control={form.control}
                setValue={form.setValue}
                getValues={form.getValues}
              />

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="daily_patients"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">{t("doctor.daily_patients")}</FormLabel>
                      <FormControl>
                        <div className="relative flex items-center">
                          <Input
                            type="number"
                            min={1}
                            className="pr-16"
                            {...field}
                            value={(field.value as string | number) ?? ""}
                          />
                          <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground font-medium">
                            {t("doctor.daily_patients_unit")}
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="avg_duration_min"
                  render={({ field }) => (
                    <FormItem className="text-xs">
                      <FormLabel className="text-xs">{t("doctor.avg_duration")}</FormLabel>
                      <FormControl>
                        <div className="relative flex items-center">
                          <Input
                            type="number"
                            min={1}
                            className="pr-12"
                            {...field}
                            value={(field.value as string | number) ?? ""}
                          />
                          <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground font-medium">
                            {t("doctor.duration_unit")}
                          </span>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="consultation_fee_bdt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">{t("doctor.visit_fee")}</FormLabel>
                      <FormControl>
                        <div className="relative flex items-center">
                          <span className="pointer-events-none absolute left-3 text-xs font-bold text-muted-foreground">
                            {t("doctor.fee_unit")}
                          </span>
                          <Input
                            type="number"
                            min={0}
                            className="pl-7"
                            {...field}
                            value={(field.value as string | number) ?? ""}
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {isFormComplete && (
                <div
                  className={cn(
                    "sticky z-10 py-3 transition-[bottom,transform] duration-300 ease-in-out sm:static sm:p-0 animate-in fade-in-0 slide-in-from-bottom-2",
                    navHidden
                      ? "bottom-1"
                      : "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]",
                  )}
                >
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full sm:w-auto font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xl shadow-primary/20 active:scale-[0.99] transition-all"
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting ? t("doctor.filing") : t("doctor.file_doctor")}
                  </Button>
                </div>
              )}
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
