import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
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
  changePasswordSchema,
  setPasswordSchema,
  type ChangePasswordForm as ChangePasswordValues,
  type SetPasswordForm as SetPasswordValues,
} from "@/schemas/password";

/** For users changing their own password. */
export function ChangePasswordForm({
  submitLabel = "Change password",
  onSubmit,
}: {
  submitLabel?: string;
  onSubmit: (next: string, current: string) => Promise<void>;
}) {
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current_password: "", new_password: "", confirm_password: "" },
  });

  async function submit(values: ChangePasswordValues) {
    try {
      await onSubmit(values.new_password, values.current_password);
      form.reset();
    } catch (err) {
      form.setError("root", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        {form.formState.errors.root && (
          <p className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        {form.formState.isSubmitSuccessful && !form.formState.errors.root && (
          <p className="text-sm text-muted-foreground">Password updated.</p>
        )}
        <FormField
          control={form.control}
          name="current_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Current password</FormLabel>
              <FormControl>
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="new_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}

/** For admins setting another user's password. */
export function SetPasswordForm({
  submitLabel = "Set new password",
  onSubmit,
}: {
  submitLabel?: string;
  onSubmit: (next: string) => Promise<void>;
}) {
  const form = useForm<SetPasswordValues>({
    resolver: zodResolver(setPasswordSchema),
    defaultValues: { new_password: "", confirm_password: "" },
  });

  async function submit(values: SetPasswordValues) {
    try {
      await onSubmit(values.new_password);
      form.reset();
    } catch (err) {
      form.setError("root", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
        {form.formState.errors.root && (
          <p className="text-sm text-destructive">
            {form.formState.errors.root.message}
          </p>
        )}
        {form.formState.isSubmitSuccessful && !form.formState.errors.root && (
          <p className="text-sm text-muted-foreground">Password updated.</p>
        )}
        <FormField
          control={form.control}
          name="new_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>New password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirm_password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm new password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}

export default ChangePasswordForm;
