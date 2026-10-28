import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { SignOutButton } from "@/components/sign-out-button";
import { TwoFactorSetup } from "@/components/two-factor-setup";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext } from "@/lib/authz";

export const metadata: Metadata = { title: "Set up two-factor authentication" };

export default async function SetupTwoFactorPage() {
  const { user } = await requireAppContext({ allowMissing2fa: true });
  if (user.twoFactorEnabled) redirect("/");

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Turn on two-factor authentication</CardTitle>
          <CardDescription>
            Owners and admins must use an authenticator app (1Password, Google Authenticator, Authy…) to protect
            workspace data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSetup />
        </CardContent>
      </Card>
      <div className="text-center">
        <SignOutButton variant="link" />
      </div>
    </AuthShell>
  );
}
