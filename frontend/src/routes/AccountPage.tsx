import { LogOut } from "lucide-react";
import { toast } from "sonner";

import { changePassword, TOKEN_KEY } from "@/api";
import { useAuth } from "@/auth";
import ChangePasswordForm from "@/components/PasswordForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AccountPage() {
  const { user, logout } = useAuth();

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>

      {user && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-medium">{user.name}</div>
              <div className="text-sm text-muted-foreground">{user.company}</div>
            </div>
            <Badge variant="secondary">{user.role}</Badge>
          </CardContent>
        </Card>
      )}

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

      <Button variant="outline" className="w-full" onClick={logout}>
        <LogOut className="size-4" aria-hidden />
        Sign out
      </Button>
    </main>
  );
}
