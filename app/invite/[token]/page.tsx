import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { findOpenInvite } from "@/lib/services/invites";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept invite" };

export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;
  const found = await findOpenInvite(db, token);

  return (
    <AuthShell>
      {found ? (
        <Card>
          <CardHeader>
            <CardTitle>Join {found.workspaceName}</CardTitle>
            <CardDescription>
              You&apos;ve been invited as <strong>{found.invite.role}</strong> with{" "}
              <strong>{found.invite.email}</strong>. Choose your name and a password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AcceptInviteForm token={token} email={found.invite.email} />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Invite unavailable</CardTitle>
            <CardDescription>
              This invite link is invalid, has expired, or was already used. Ask the person who invited you for a new
              link.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/sign-in" className="text-sm underline underline-offset-4">
              Go to sign in
            </Link>
          </CardContent>
        </Card>
      )}
    </AuthShell>
  );
}
