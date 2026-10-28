import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { TwoFactorSetup } from "@/components/two-factor-setup";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAppContext, twoFactorRequired } from "@/lib/authz";
import { hasWorkspaceRole } from "@/lib/services/access";
import { DisableTwoFactor } from "./disable-two-factor";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const { user, ctx } = await requireAppContext();
  const required = twoFactorRequired() && hasWorkspaceRole(ctx.workspaceRole, "admin");

  return (
    <>
      <PageHeader title="Security" description="Manage how you sign in." />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Two-factor authentication</CardTitle>
          <CardDescription>
            {required
              ? "Required for owners and admins."
              : "Optional for your role, but recommended."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {user.twoFactorEnabled ? (
            <div className="space-y-4">
              <Alert>
                <ShieldCheck className="text-emerald-600" />
                <AlertTitle>Two-factor authentication is on</AlertTitle>
                <AlertDescription>You&apos;ll be asked for a code from your authenticator app when you sign in.</AlertDescription>
              </Alert>
              {!required && <DisableTwoFactor />}
            </div>
          ) : (
            <TwoFactorSetup redirectTo="/settings/security" />
          )}
        </CardContent>
      </Card>
    </>
  );
}
