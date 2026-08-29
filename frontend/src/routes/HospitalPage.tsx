import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import LocationInput from "@/components/LocationInput";
import PhoneEditor from "@/components/PhoneEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  emptyHospitalValues,
  hospitalSchema,
  type HospitalForm,
} from "@/schemas/survey";

export default function HospitalPage() {
  const navigate = useNavigate();
  const { hospital, doctorsAdded, startHospital, exitHospital } = useHospital();

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
      <h1 className="text-2xl font-semibold tracking-tight">
        {hospital ? "Hospital" : "New hospital"}
      </h1>

      {hospital ? (
        // The form is deliberately not rendered beside this. Submitting it
        // replaces the open hospital and resets its doctor count, so starting
        // a different one has to be an explicit choice rather than something
        // an agent can do by scrolling past the banner and typing.
        <Alert>
          <AlertDescription className="flex flex-wrap items-center gap-2">
            <span>
              {hospital.hospital_name} is still open
              {doctorsAdded > 0
                ? ` with ${doctorsAdded} doctor${doctorsAdded > 1 ? "s" : ""} filed`
                : ""}
              .
            </span>
            <Button size="sm" onClick={() => navigate("/doctors")}>
              Continue with {hospital.hospital_name}
            </Button>
            <Button variant="outline" size="sm" onClick={exitHospital}>
              New hospital
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-5"
              >
                <FormField
                  control={form.control}
                  name="hospital_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Hospital name</FormLabel>
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
                        Emergency Service (12am afterwards)
                      </FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-2 pt-0.5">
                          <Button
                            type="button"
                            variant={field.value ? "default" : "outline"}
                            size="sm"
                            className="h-8 px-4 text-xs font-semibold"
                            onClick={() => field.onChange(true)}
                          >
                            Yes
                          </Button>
                          <Button
                            type="button"
                            variant={!field.value ? "default" : "outline"}
                            size="sm"
                            className="h-8 px-4 text-xs font-semibold"
                            onClick={() => field.onChange(false)}
                          >
                            No
                          </Button>
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
                  label="Common booking number (optional)"
                  addLabel="Add common number"
                  allowEmpty
                />

                <Button type="submit" className="w-full sm:w-auto">
                  Start adding doctors
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
