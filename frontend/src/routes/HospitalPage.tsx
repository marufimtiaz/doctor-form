import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import {
  changePassword,
  listMySurveys,
  myStats,
  TOKEN_KEY,
  type Stats,
  type Survey,
} from "@/api";
import LocationInput from "@/components/LocationInput";
import ChangePasswordForm from "@/components/PasswordForm";
import PhoneEditor from "@/components/PhoneEditor";
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
import { useHospital } from "@/hospital";
import { describePlace, describeSlot } from "@/lib/formatters";
import {
  emptyHospitalValues,
  hospitalSchema,
  type HospitalForm,
} from "@/schemas/survey";

export default function HospitalPage() {
  const navigate = useNavigate();
  const { hospital, doctorsAdded, startHospital } = useHospital();

  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load must not read as an empty list: an agent with 40 surveys
  // being told they have none is worse than an error message.
  const [loadError, setLoadError] = useState<string | null>(null);

  const form = useForm<HospitalForm>({
    resolver: zodResolver(hospitalSchema),
    defaultValues: emptyHospitalValues(),
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

  function onSubmit(values: HospitalForm) {
    startHospital(values);
    navigate("/doctors");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">New hospital</h1>
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
                  <div className="text-xs text-muted-foreground">filed today</div>
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

      {hospital && (
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
          </AlertDescription>
        </Alert>
      )}

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
                control={form.control}
                setValue={form.setValue}
                getValues={form.getValues}
              />
              <PhoneEditor control={form.control} />

              <Button type="submit" className="w-full sm:w-auto">
                Start adding doctors
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
                    <div className="text-muted-foreground">{describePlace(s)}</div>
                    <div className="text-muted-foreground">
                      {s.slots.map(describeSlot).join(" · ")}
                    </div>
                    <div className="text-muted-foreground">{s.phones.join(" · ")}</div>
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
