import { zodResolver } from "@hookform/resolvers/zod";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  adminStats,
  createUser,
  deleteSurvey,
  listAllSurveys,
  listUsers,
  resetPassword,
  type AdminStats,
  type Survey,
  type UserPublic,
} from "@/api";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describePlace, describeSlot } from "@/lib/formatters";
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

  const filtered = district.trim() !== "" || agentId !== "";

  return (
    <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">All surveys</h1>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
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

      {stats && stats.per_agent.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">By agent</h2>
          <div className="flex flex-wrap gap-2">
            {stats.per_agent.map((a) => (
              <Button
                key={a.user_id}
                variant={agentId === a.user_id ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setAgentId(agentId === a.user_id ? "" : a.user_id)
                }
              >
                {a.name}
                <Badge variant="secondary" className="ml-2">
                  {a.today} / {a.total}
                </Badge>
              </Button>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder="Filter by district"
          aria-label="Filter by district"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAgentId("");
              setDistrict("");
            }}
          >
            Clear
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Surveys</h2>
        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>Could not load surveys: {loadError}</span>
              <Button variant="outline" size="sm" onClick={() => void refresh()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : surveys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing matches.</p>
        ) : (
          <>
            {/* Table at desk width, cards on a phone - the admin is usually
                at a desk, but the roster should not be unusable on mobile. */}
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
                        {s.doctor_name ?? (
                          <span className="text-muted-foreground">
                            — nameplate pending
                          </span>
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
                    <CardContent className="space-y-1 p-4 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">
                          {s.doctor_name ?? "Dr. — (nameplate pending)"}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleting(s)}
                        >
                          Delete
                        </Button>
                      </div>
                      <div>{s.hospital_name}</div>
                      <div className="text-muted-foreground">
                        filed by {s.agent_name ?? "unknown"} ·{" "}
                        {new Date(s.created_at).toLocaleString()}
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
          </>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">People</h2>
        <Card className="py-0">
          <CardContent className="p-0">
            <ul className="divide-y">
              {people.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-2 p-4 text-sm"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.company}</span>
                  <Badge variant="secondary">{p.role}</Badge>
                  {!p.is_active && <Badge variant="outline">deactivated</Badge>}
                  <Button
                    className="ml-auto"
                    variant="outline"
                    size="sm"
                    onClick={() => setResetting(p)}
                  >
                    Reset password
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Add an agent</h2>
        <Card>
          <CardContent>
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
                    <FormItem className="max-w-sm">
                      <FormLabel>Initial password</FormLabel>
                      <FormControl>
                        <Input
                          type="password"
                          autoComplete="new-password"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Give this to the agent directly. They can change it from their
                  own page.
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
