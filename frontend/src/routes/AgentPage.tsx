import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  changePassword,
  createSurvey,
  listMySurveys,
  myStats,
  TOKEN_KEY,
  type Stats,
  type Survey,
} from "@/api";
import LocationInput from "@/components/LocationInput";
import NameplateInput from "@/components/NameplateInput";
import ChangePasswordForm from "@/components/PasswordForm";
import PhoneEditor from "@/components/PhoneEditor";
import SlotEditor from "@/components/SlotEditor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { describePlace, describeSlot } from "@/lib/formatters";
import {
  emptySurveyValues,
  surveySchema,
  toBackendSlots,
  type SurveyForm,
  type SurveyOutput,
} from "@/schemas/survey";

export default function AgentPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load must not read as an empty list: an agent with 40 surveys
  // being told they have none is worse than an error message.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nameplate, setNameplate] = useState<File | null>(null);
  const [nameplateError, setNameplateError] = useState<string | null>(null);
  // Remounts LocationInput after each submit so the next chamber gets its
  // own GPS fix. Without the increment the key never changes, the effect runs
  // once per page load, and an agent filing six surveys a day gets
  // coordinates for the first one only.
  const [resetKey, setResetKey] = useState(0);

  const form = useForm<SurveyForm, any, SurveyOutput>({
    resolver: zodResolver(surveySchema),
    defaultValues: emptySurveyValues(),
  });

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([myStats(), listMySurveys()]);
      setStats(s);
      setMine(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmit(values: SurveyForm) {
    if (!nameplate) {
      setNameplateError("A nameplate photo is required.");
      return;
    }
    setNameplateError(null);

    const parsed = surveySchema.parse(values);
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
      form.reset(emptySurveyValues());
      setNameplate(null);
      setResetKey((n) => n + 1);
      setResetKey((k) => k + 1);
      toast.success("Survey submitted.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          New chamber survey
        </h1>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {loading ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : !stats ? (
            <Alert variant="destructive" className="col-span-2">
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>Could not load your counts.</span>
                <Button variant="outline" size="sm" onClick={() => void refresh()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Card className="py-4">
                <CardContent className="text-center">
                  <div className="text-2xl font-semibold">{stats.today}</div>
                  <div className="text-xs text-muted-foreground">
                    filed today
                  </div>
                </CardContent>
              </Card>
              <Card className="py-4">
                <CardContent className="text-center">
                  <div className="text-2xl font-semibold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">in total</div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </section>

      <Card>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
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
                key={resetKey}
                control={form.control}
                setValue={form.setValue}
                getValues={form.getValues}
              />
              <NameplateInput
                file={nameplate}
                onChange={(f) => {
                  setNameplate(f);
                  // Otherwise the destructive "required" text sits under a
                  // perfectly valid image until the next submit attempt.
                  if (f) setNameplateError(null);
                }}
                error={nameplateError}
              />
              <SlotEditor control={form.control} setValue={form.setValue} />
              <PhoneEditor control={form.control} />

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
                {form.formState.isSubmitting ? "Submitting…" : "Submit survey"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">My surveys</h2>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : loadError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>Could not load your surveys: {loadError}</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing filed yet.</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((s) => (
              <li key={s.id}>
                <Card>
                  <CardContent className="space-y-1 p-4 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.hospital_name}</span>
                        {s.has_emergency_service && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                            🚨 Emergency Service
                          </span>
                        )}
                      </div>
                      <time className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleString()}
                      </time>
                    </div>
                    <div className="text-muted-foreground">
                      {describePlace(s)}
                    </div>
                    <div className="text-muted-foreground">
                      {s.slots.map(describeSlot).join(" · ")}
                    </div>
                    <div className="text-muted-foreground">
                      {s.phones.join(" · ")}
                    </div>
                    <div className="text-muted-foreground">
                      {s.daily_patients}/day · {s.avg_duration_min} min · ৳
                      {s.consultation_fee_bdt}
                    </div>
                    {s.nameplate_url && (
                      <a
                        className="text-primary underline underline-offset-4"
                        href={s.nameplate_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View nameplate
                      </a>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Account</h2>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Change password</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm
              submitLabel="Change password"
              onSubmit={async (next, current) => {
                const resp = await changePassword(current, next);
                // The change bumps token_version, so the token we hold is now
                // dead. Storing the replacement keeps this session alive while
                // every other device is signed out.
                localStorage.setItem(TOKEN_KEY, resp.access_token);
                toast.success("Password changed.");
              }}
            />
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
