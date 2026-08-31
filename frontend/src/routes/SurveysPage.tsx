import { useCallback, useEffect, useState } from "react";

import { listMySurveys, myStats, type Stats, type Survey } from "@/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describePlace } from "@/lib/formatters";

export default function SurveysPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed load must not read as an empty list: an agent with 40 surveys
  // being told they have none is worse than an error message.
  const [loadError, setLoadError] = useState<string | null>(null);

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

  // Refetched on every visit rather than cached, so the counts and the list
  // reflect doctors filed since the tab was last opened.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">My surveys</h1>

      <div className="grid grid-cols-2 gap-3">
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
                <CardContent className="space-y-2 p-4 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-base">{s.hospital_name}</span>
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

                  <div className="rounded-md bg-muted/40 p-2.5 space-y-0.5 border">
                    <div className="font-medium text-foreground">
                      {s.doctor_name ? (
                        s.doctor_name
                      ) : (
                        <span className="text-muted-foreground text-xs italic">
                          {s.ocr_status === "failed"
                            ? "Could not read nameplate"
                            : s.ocr_status === "processing"
                              ? "Reading nameplate…"
                              : "Nameplate details pending"}
                        </span>
                      )}
                    </div>
                    {s.doctor_degrees && (
                      <div className="text-xs text-muted-foreground">
                        {s.doctor_degrees}
                      </div>
                    )}
                    {s.doctor_specializations && (
                      <div className="text-xs text-muted-foreground font-medium">
                        {s.doctor_specializations}
                      </div>
                    )}
                  </div>

                  {describePlace(s) && (
                    <div className="text-muted-foreground">{describePlace(s)}</div>
                  )}
                  {s.phones.length > 0 && (
                    <div className="text-muted-foreground">
                      {s.phones.join(" · ")}
                    </div>
                  )}
                  <div className="text-muted-foreground">
                    {s.daily_patients}/day · {s.avg_duration_min} min · ৳
                    {s.consultation_fee_bdt}
                  </div>
                  {s.nameplate_url && (
                    <a
                      className="inline-block text-xs font-medium text-primary underline underline-offset-4"
                      href={s.nameplate_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View original nameplate
                    </a>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
