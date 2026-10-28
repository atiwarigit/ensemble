import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { hasWorkspaceRole } from "@/lib/services/access";
import { listPendingInvites } from "@/lib/services/invites";
import { listWorkspaceMembers } from "@/lib/services/workspace";
import { InvitePanel } from "./invite-panel";
import { MembersTable } from "./members-table";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const { ctx } = await requireAppContext();
  const canInvite = hasWorkspaceRole(ctx.workspaceRole, "admin");
  const [members, invites] = await Promise.all([
    listWorkspaceMembers(db, ctx),
    canInvite ? listPendingInvites(db, ctx) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title="Members" description="Ensemble is invite-only. Owners and admins can invite people." />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Workspace members</CardTitle>
            <CardDescription>Owners see every project. Everyone else only sees projects they&apos;re added to.</CardDescription>
          </CardHeader>
          <CardContent>
            <MembersTable
              members={members.map((m) => ({ ...m, joinedAt: m.joinedAt.toISOString(), twoFactorEnabled: !!m.twoFactorEnabled }))}
              currentUserId={ctx.userId}
              canChangeRoles={ctx.workspaceRole === "owner"}
              canRemove={canInvite}
            />
          </CardContent>
        </Card>
        {canInvite && (
          <InvitePanel
            canInviteOwners={ctx.workspaceRole === "owner"}
            invites={invites.map((i) => ({
              ...i,
              expiresAt: i.expiresAt.toISOString(),
              createdAt: i.createdAt.toISOString(),
            }))}
          />
        )}
      </div>
    </>
  );
}
