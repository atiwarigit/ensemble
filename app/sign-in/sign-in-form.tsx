"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export function SignInForm({ next, noWorkspace }: { next: string; noWorkspace: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(
    noWorkspace ? "Your account isn't a member of any workspace. Ask an owner for an invite." : null,
  );
  const [pending, setPending] = useState(false);

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) return setError(error.message ?? "Sign-in failed.");
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return setStep("totp");
    router.replace(next);
    router.refresh();
  }

  async function onCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setPending(true);
    setError(null);
    const { error } = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) return setError(error.message ?? "That code didn't work.");
    router.replace(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{step === "password" ? "Sign in" : "Two-factor authentication"}</CardTitle>
        <CardDescription>
          {step === "password"
            ? "Ensemble is invite-only. Use the email your invite was sent to."
            : useBackup
              ? "Enter one of your backup codes."
              : "Enter the 6-digit code from your authenticator app."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {step === "password" ? (
          <form onSubmit={onPassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Sign in
            </Button>
          </form>
        ) : (
          <form onSubmit={onCode} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">{useBackup ? "Backup code" : "Authentication code"}</Label>
              <Input
                id="code"
                name="code"
                key={useBackup ? "backup" : "totp"}
                inputMode={useBackup ? "text" : "numeric"}
                autoComplete="one-time-code"
                pattern={useBackup ? undefined : "[0-9]{6}"}
                maxLength={useBackup ? 32 : 6}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              Verify
            </Button>
            <Button type="button" variant="link" className="w-full" onClick={() => setUseBackup((v) => !v)}>
              {useBackup ? "Use authenticator code" : "Use a backup code"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
