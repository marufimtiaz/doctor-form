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
  type ChangePasswordForm,
  type SetPasswordForm,
} from "@/schemas/password";

type Values = ChangePasswordForm | SetPasswordForm;

/** Used both for changing your own password and for an admin resetting
 *  someone else's, which differ only in whether a current password is asked
 *  for - and therefore in which schema applies. */
export default function PasswordForm({
  requireCurrent,
  submitLabel,
  onSubmit,
}: {
  requireCurrent: boolean;
  submitLabel: string;
  onSubmit: (next: string, current: string) => Promise<void>;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(requireCurrent ? changePasswordSchema : setPasswordSchema),
    defaultValues: requireCurrent
      ? { current_password: "", new_password: "", confirm_password: "" }
      : { new_password: "", confirm_password: "" },
  });

  async function submit(values: Values) {
    const current = "current_password" in values ? values.current_password : "";
    try {
      await onSubmit(values.new_password, current);
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
        {requireCurrent && (
          <FormField
            control={form.control}
            name={"current_password" as never}
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
