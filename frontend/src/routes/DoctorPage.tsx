import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { createSurvey } from "@/api";
import NameplateInput from "@/components/NameplateInput";
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

  const form = useForm<DoctorForm>({
    resolver: zodResolver(doctorSchema),
    defaultValues: emptyDoctorValues(),
  });

  if (!hospital) return <Navigate to="/" replace />;

  async function onSubmit(values: DoctorForm) {
    if (!hospital) return;
    if (!nameplate) {
      setNameplateError("A nameplate photo is required.");
      return;
    }
    setNameplateError(null);

    // The hospital half and the doctor half are disjoint, so this reassembles
    // exactly the object surveySchema has always validated.
    const parsed = surveySchema.parse({ ...hospital, ...values });

    const body = new FormData();
    body.set("hospital_name", parsed.hospital_name);
    body.set("has_emergency_service", String(parsed.has_emergency_service));
    body.set("daily_patients", String(parsed.daily_patients));
    body.set("avg_duration_min", String(parsed.avg_duration_min));
    body.set("consultation_fee_bdt", String(parsed.consultation_fee_bdt));
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

    try {
      await createSurvey(body);
      form.reset(emptyDoctorValues());
      setNameplate(null);
      setResetKey((n) => n + 1);
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
          Exit hospital
        </Button>
      </section>

      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <NameplateInput
                key={resetKey}
                file={nameplate}
                onChange={(f) => {
                  setNameplate(f);
                  // Otherwise the destructive "required" text sits under a
                  // perfectly valid image until the next submit attempt.
                  if (f) setNameplateError(null);
                }}
                error={nameplateError}
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
