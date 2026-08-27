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
  type Slot,
  type Stats,
  type Survey,
} from "@/api";
import LocationInput from "@/components/LocationInput";
import NameplateInput from "@/components/NameplateInput";
import PasswordForm from "@/components/PasswordForm";
import PhoneEditor from "@/components/PhoneEditor";
import SlotEditor from "@/components/SlotEditor";
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
import {
  emptySurveyValues,
  surveySchema,
  type SurveyForm,
} from "@/schemas/survey";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function describeSlot(slot: Slot): string {
  return `${DAY_LABELS[slot.day_of_week]} ${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;
}

export function describePlace(s: Survey): string {
  const parts: string[] = [];
  if (s.city && s.district) parts.push(`${s.city}, ${s.district}`);
  if (s.latitude !== null && s.longitude !== null) {
    parts.push(`(${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`);
  }
  return parts.join(" ");
}

export default function AgentPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [nameplate, setNameplate] = useState<File | null>(null);
  const [nameplateError, setNameplateError] = useState<string | null>(null);

  const form = useForm<SurveyForm>({
    resolver: zodResolver(surveySchema),
    defaultValues: emptySurveyValues(),
  });

  const refresh = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([myStats(), listMySurveys()]);
      setStats(s);
      setMine(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
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
    body.set("daily_patients", String(parsed.daily_patients));
    body.set("avg_duration_min", String(parsed.avg_duration_min));
    body.set("consultation_fee_bdt", String(parsed.consultation_fee_bdt));
    // Multipart cannot nest, so these travel as JSON strings. Phones are
    // objects in the form because useFieldArray requires objects; the API
    // wants bare strings.
    body.set("slots", JSON.stringify(parsed.slots));
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
          {loading || !stats ? (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          ) : (
            <>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-semibold">{stats.today}</div>
                  <div className="text-xs text-muted-foreground">
                    filed today
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-semibold">{stats.total}</div>
                  <div className="text-xs text-muted-foreground">in total</div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </section>

      <Card>
        <CardContent className="pt-6">
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

              <LocationInput control={form.control} setValue={form.setValue} />
              <NameplateInput
                file={nameplate}
                onChange={setNameplate}
                error={nameplateError}
              />
              <SlotEditor control={form.control} />
              <PhoneEditor control={form.control} />

              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="daily_patients"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Patients per day</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} {...field} value={(field.value as string | number) ?? ""} />
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
                        <Input type="number" min={1} {...field} value={(field.value as string | number) ?? ""} />
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
                        <Input type="number" min={0} {...field} value={(field.value as string | number) ?? ""} />
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
        ) : mine.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing filed yet.</p>
        ) : (
          <ul className="space-y-3">
            {mine.map((s) => (
              <li key={s.id}>
                <Card>
                  <CardContent className="space-y-1 p-4 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">{s.hospital_name}</span>
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
            <PasswordForm
              requireCurrent
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
