import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  adminStats,
  correctDoctor,
  createUser,
  deleteSurvey,
  listAllSurveys,
  listUsers,
  rereadNameplate,
  resetPassword,
  type AdminStats,
  type DoctorFields,
  type Survey,
  type UserPublic,
} from "@/api";
import AgentCombobox from "@/components/AgentCombobox";
import { SetPasswordForm } from "@/components/PasswordForm";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { describePlace } from "@/lib/formatters";
import { createUserSchema, type CreateUserForm } from "@/schemas/user";

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [people, setPeople] = useState<UserPublic[]>([]);
  // A failed load must not render as an empty result set: an admin
  // filtering by district would conclude the filter matched nothing.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [district, setDistrict] = useState("");
  const [agentId, setAgentId] = useState("");
  const [resetting, setResetting] = useState<UserPublic | null>(null);
  const [deleting, setDeleting] = useState<Survey | null>(null);
  const [editingDoctor, setEditingDoctor] = useState<Survey | null>(null);
  const [doctorDraft, setDoctorDraft] = useState<DoctorFields>({
    doctor_name: "",
    doctor_degrees: "",
    doctor_specializations: "",
  });

  const form = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      name: "",
      phone: "",
      company: "",
      role: "agent",
      password: "",
    },
  });

  const refresh = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (district.trim()) params.district = district.trim();
      if (agentId) params.user_id = agentId;
      const [s, list, roster] = await Promise.all([
        adminStats(),
        listAllSurveys(params),
        listUsers(),
      ]);
      setStats(s);
      setSurveys(list);
      setPeople(roster);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [district, agentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAddAgent(values: CreateUserForm) {
    try {
      const parsed = createUserSchema.parse(values);
      await createUser(parsed);
      form.reset();
      toast.success(`${parsed.name} can now sign in.`);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      // Soft on the server: the row and its nameplate survive for audit.
      await deleteSurvey(deleting.id);
      toast.success("Survey removed from the active list.");
      setDeleting(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function ocrLabel(s: Survey) {
    if (s.doctor_name) return s.doctor_name;
    if (s.ocr_status === "failed") return "Could not read nameplate";
    if (s.ocr_status === "processing") return "Reading nameplate…";
    return "— nameplate pending";
  }

  function openDoctorEditor(s: Survey) {
    setDoctorDraft({
      doctor_name: s.doctor_name ?? "",
      doctor_degrees: s.doctor_degrees ?? "",
      doctor_specializations: s.doctor_specializations ?? "",
    });
    setEditingDoctor(s);
  }

  async function saveDoctor() {
    if (!editingDoctor) return;
    try {
      // Blank means "the nameplate does not show this", which is null, not "".
      await correctDoctor(editingDoctor.id, {
        doctor_name: doctorDraft.doctor_name?.trim() || null,
        doctor_degrees: doctorDraft.doctor_degrees?.trim() || null,
        doctor_specializations: doctorDraft.doctor_specializations?.trim() || null,
      });
      toast.success("Doctor details updated.");
      setEditingDoctor(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  async function reread(s: Survey) {
    try {
      await rereadNameplate(s.id);
      toast.success("Queued for another read.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  const filtered = district.trim() !== "" || agentId !== "";

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">All surveys</h1>

      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { value: stats.total, label: "total surveys" },
            { value: stats.today, label: "today" },
            { value: stats.agent_count, label: "active users" },
          ].map((tile) => (
            <Card key={tile.label} className="py-4">
              <CardContent className="text-center">
                <div className="text-2xl font-semibold">{tile.value}</div>
                <div className="text-xs text-muted-foreground">
                  {tile.label}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filter by district…"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            className="w-full sm:w-64"
          />
          {stats && stats.per_agent.length > 0 && (
            <AgentCombobox
              agents={stats.per_agent}
              value={agentId}
              onChange={setAgentId}
              totalSurveys={stats.total}
            />
          )}
          {filtered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDistrict("");
                setAgentId("");
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {loadError && (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-2">
              <span>Could not load surveys: {loadError}</span>
              <Button
                variant="outline"
                size="sm"
                className="bg-background"
                onClick={() => void refresh()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!loadError && surveys.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              {filtered ? "No surveys match the filters." : "No surveys filed yet."}
            </CardContent>
          </Card>
        ) : !loadError && (
          <>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Doctor</TableHead>
                    <TableHead>Hospital</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Throughput</TableHead>
                    <TableHead className="text-right">Fee</TableHead>
                    <TableHead>Nameplate</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {surveys.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <button
                          className="text-left font-medium underline-offset-4 hover:underline block"
                          onClick={() => openDoctorEditor(s)}
                        >
                          {s.doctor_name ? (
                            ocrLabel(s)
                          ) : (
                            <span className="text-muted-foreground italic">{ocrLabel(s)}</span>
                          )}
                        </button>
                        {s.doctor_degrees && (
                          <div className="text-xs text-muted-foreground">{s.doctor_degrees}</div>
                        )}
                        {s.doctor_specializations && (
                          <div className="text-xs text-muted-foreground font-medium">{s.doctor_specializations}</div>
                        )}
                        {s.ocr_status === "failed" && s.ocr_error && (
                          <p className="mt-1 text-xs text-destructive">{s.ocr_error}</p>
                        )}
                        {s.ocr_status !== "done" && (
                          <Button
                            variant="link"
                            size="sm"
                            className="h-auto p-0 text-xs"
                            onClick={() => void reread(s)}
                          >
                            Re-read
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>{s.hospital_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {describePlace(s)}
                      </TableCell>
                      <TableCell>{s.agent_name ?? "unknown"}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        {s.daily_patients}/day · {s.avg_duration_min} min
                      </TableCell>
                      <TableCell className="text-right">
                        ৳{s.consultation_fee_bdt}
                      </TableCell>
                      <TableCell>
                        {s.nameplate_url ? (
                          <a
                            className="text-primary underline underline-offset-4"
                            href={s.nameplate_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(s)}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="space-y-3 md:hidden">
              {surveys.map((s) => (
                <li key={s.id}>
                  <Card>
                    <CardContent className="space-y-2 p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-0.5">
                          <div className="font-semibold text-base">{s.hospital_name}</div>
                          {s.has_emergency_service && (
                            <span className="inline-block rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                              🚨 Emergency Service
                            </span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(s)}
                        >
                          Delete
                        </Button>
                      </div>

                      <div className="rounded-md bg-muted/40 p-2.5 space-y-0.5 border">
                        <button
                          className="text-left font-medium text-foreground underline-offset-4 hover:underline block w-full"
                          onClick={() => openDoctorEditor(s)}
                        >
                          {ocrLabel(s)}
                        </button>
                        {s.doctor_degrees && (
                          <div className="text-xs text-muted-foreground">{s.doctor_degrees}</div>
                        )}
                        {s.doctor_specializations && (
                          <div className="text-xs text-muted-foreground font-medium">{s.doctor_specializations}</div>
                        )}
                        {s.ocr_status === "failed" && s.ocr_error && (
                          <p className="mt-1 text-xs text-destructive">{s.ocr_error}</p>
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
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                        <span className="text-muted-foreground">
                          by {s.agent_name ?? "unknown"} ·{" "}
                          <time>{new Date(s.created_at).toLocaleString()}</time>
                        </span>
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
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Roster</h2>
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {people.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 p-4 text-sm"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.company}</span>
                  <Badge variant={p.role === "admin" ? "default" : "secondary"}>
                    {p.role}
                  </Badge>
                  {!p.is_active && (
                    <Badge variant="destructive">Deactivated</Badge>
                  )}
                  <Button
                    variant="link"
                    size="sm"
                    className="ml-auto h-auto p-0"
                    onClick={() => setResetting(p)}
                  >
                    Reset password
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Add an agent</h2>
        <Card>
          <CardContent className="pt-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onAddAgent)}
                className="space-y-4"
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="01712345678" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Initial password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="new-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  The agent changes this from their own page after sign-in.
                </p>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  Create agent
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>
      </section>

      <Dialog
        open={editingDoctor !== null}
        onOpenChange={(open) => !open && setEditingDoctor(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Doctor details</DialogTitle>
          </DialogHeader>
          {editingDoctor?.nameplate_url && (
            <a href={editingDoctor.nameplate_url} target="_blank" rel="noreferrer">
              <img
                src={editingDoctor.nameplate_url}
                alt="Nameplate"
                className="max-h-48 w-full rounded-md border object-contain"
              />
            </a>
          )}
          <div className="space-y-3">
            <div>
              <Label htmlFor="doctor-name">Name</Label>
              <Input
                id="doctor-name"
                value={doctorDraft.doctor_name ?? ""}
                onChange={(e) =>
                  setDoctorDraft({ ...doctorDraft, doctor_name: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="doctor-degrees">Degrees</Label>
              <Textarea
                id="doctor-degrees"
                rows={2}
                value={doctorDraft.doctor_degrees ?? ""}
                onChange={(e) =>
                  setDoctorDraft({ ...doctorDraft, doctor_degrees: e.target.value })
                }
              />
            </div>
            <div>
              <Label htmlFor="doctor-spec">Specializations</Label>
              <Textarea
                id="doctor-spec"
                rows={2}
                value={doctorDraft.doctor_specializations ?? ""}
                onChange={(e) =>
                  setDoctorDraft({
                    ...doctorDraft,
                    doctor_specializations: e.target.value,
                  })
                }
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void saveDoctor()}>Save</Button>
              <Button
                variant="outline"
                onClick={() => editingDoctor && void reread(editingDoctor)}
              >
                Re-read nameplate
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset password for {resetting?.name}</DialogTitle>
            <DialogDescription>
              This signs them out of every device, which is the point of a
              reset.
            </DialogDescription>
          </DialogHeader>
          {resetting && (
            <SetPasswordForm
              submitLabel="Set new password"
              onSubmit={async (next) => {
                await resetPassword(resetting.id, next);
                toast.success(`${resetting.name} has a new password.`);
                setResetting(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this survey?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.hospital_name} leaves the active list. The record and
              its nameplate are kept, so the field data stays auditable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
