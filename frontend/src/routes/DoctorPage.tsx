import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
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
import {
  doctorSchema,
  emptyDoctorValues,
  surveySchema,
  toBackendSlots,
  type DoctorForm,
} from "@/schemas/survey";

export default function DoctorPage() {
  const navigate = useNavigate();
  const { hospital, doctorsAdded, recordDoctor, exitHospital } = useHospital();

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
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {hospital.hospital_name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {doctorsAdded === 0
              ? "No doctors filed yet"
              : `${doctorsAdded} doctor${doctorsAdded > 1 ? "s" : ""} filed here`}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            exitHospital();
            navigate("/");
          }}
        >
          New hospital
        </Button>
      </section>

      <Card>
        <CardContent>
          <Form {...form}>
            {/* react-hooks/refs cannot see that onSubmit only ever runs from a
                submit event, which is exactly where the rule's own message says
                a ref belongs. It reaches previewToken through readNameplate, to
                discard a preview still in flight for the doctor just filed. */}
            {/* eslint-disable-next-line react-hooks/refs */}
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <NameplateInput
                key={resetKey}
                file={nameplate}
                onChange={(f) => {
                  setNameplate(f);
                  // Otherwise the destructive "required" text sits under a
                  // perfectly valid image until the next submit attempt.
                  if (f) setNameplateError(null);
                  void readNameplate(f);
                }}
                error={nameplateError}
              />

              <fieldset className="space-y-3 rounded-lg border p-4">
                <div>
                  <Label className="text-sm font-medium">Doctor details</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ocrState === "reading"
                      ? "Reading the nameplate…"
                      : ocrState === "done"
                        ? "Read from the nameplate. Correct anything that is wrong."
                        : ocrState === "failed"
                          ? "Couldn't read the nameplate. It will be read after filing."
                          : "Filled in from the nameplate photo once you add one."}
                  </p>
                </div>
                {(
                  [
                    ["doctor_name", "Name"],
                    ["doctor_degrees", "Degrees"],
                    ["doctor_specializations", "Specializations"],
                  ] as const
                ).map(([name, label]) => (
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
                label="Phone numbers"
                hint="Pre-filled from the hospital's common line when it has one."
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
                      <FormLabel>Patients per day</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          {...field}
                          value={(field.value as string | number) ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="avg_duration_min"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Minutes per patient</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          {...field}
                          value={(field.value as string | number) ?? ""}
                        />
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
                      <FormLabel>Fee (BDT)</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={0}
                          {...field}
                          value={(field.value as string | number) ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                className="w-full sm:w-auto"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Filing…" : "File doctor and add another"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </main>
  );
}
