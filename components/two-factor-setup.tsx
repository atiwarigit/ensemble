"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

type Enrolment = { totpURI: string; backupCodes: string[] };

export function TwoFactorSetup({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function start(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({
      password: String(new FormData(e.currentTarget).get("password")),
    });
    setPending(false);
    if (error || !data || !("totpURI" in data)) return setError(error?.message ?? "Couldn't start enrolment.");
    setEnrolment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: String(new FormData(e.currentTarget).get("code")).trim(),
    });
    setPending(false);
    if (error) return setError(error.message ?? "That code didn't work. Check your device clock and try again.");
    toast.success("Two-factor authentication is on.");
    router.replace(redirectTo ?? "/");
    router.refresh();
  }

  const secret = enrolment ? new URL(enrolment.totpURI).searchParams.get("secret") : null;

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!enrolment ? (
        <form onSubmit={start} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tf-password">Confirm your password</Label>
            <Input id="tf-password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Set up authenticator
          </Button>
        </form>
      ) : (
        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-sm font-medium">1. Scan this QR code with your authenticator app</p>
            <div className="w-fit rounded-lg border bg-white p-3">
              <QRCode value={enrolment.totpURI} size={160} />
            </div>
            <p className="text-xs text-muted-foreground">
              Or enter this key manually:{" "}
              <code data-testid="totp-secret" className="break-all rounded bg-muted px-1 py-0.5 font-mono">
                {secret}
              </code>
            </p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">2. Save your backup codes</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await navigator.clipboard.writeText(enrolment.backupCodes.join("\n"));
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/50 p-3 font-mono text-xs">
              {enrolment.backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Each code works once if you lose your device.</p>
          </div>
          <form onSubmit={verify} className="space-y-2">
            <Label htmlFor="tf-code" className="text-sm font-medium">
              3. Enter the 6-digit code to finish
            </Label>
            <div className="flex gap-2">
              <Input
                id="tf-code"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                required
                className="max-w-36"
              />
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                Turn on 2FA
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
