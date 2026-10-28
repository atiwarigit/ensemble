"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/lib/authz";
import { sendInviteEmail } from "@/lib/email";
import { createInvite, revokeInvite } from "@/lib/services/invites";
import { changeWorkspaceRole, removeWorkspaceMember } from "@/lib/services/workspace";

export async function createInviteAction(form: FormData) {
  const result = await runAction(async ({ ctx, user }) => {
    const { invite, token } = await createInvite(ctx, {
      email: String(form.get("email") ?? ""),
      role: String(form.get("role") ?? "member") as "owner" | "admin" | "member" | "viewer",
    });
    const url = `${process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? ""}/invite/${token}`;
    const emailed = await sendInviteEmail({ to: invite.email, url, inviterName: user.name, role: invite.role });
    return { url, emailed };
  });
  revalidatePath("/settings/members");
  return result;
}

export async function revokeInviteAction(inviteId: string) {
  const result = await runAction(({ ctx }) => revokeInvite(ctx, inviteId), "Invite revoked.");
  revalidatePath("/settings/members");
  return result;
}

export async function changeRoleAction(userId: string, role: string) {
  const result = await runAction(
    ({ ctx }) => changeWorkspaceRole(ctx, userId, role as "owner" | "admin" | "member" | "viewer"),
    "Role updated.",
  );
  revalidatePath("/settings/members");
  return result;
}

export async function removeMemberAction(userId: string) {
  const result = await runAction(({ ctx }) => removeWorkspaceMember(ctx, userId), "Member removed.");
  revalidatePath("/settings/members");
  return result;
}
