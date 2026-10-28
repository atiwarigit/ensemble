import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import { projectMembers, projects, workspaceMembers, workspaces } from "@/db/schema/tenancy";
import { recordAudit } from "./audit";
import { requireWorkspaceRole } from "./access";
import { conflict, forbidden, notFound, type ServiceContext } from "./context";

export async function getWorkspace(exec: Executor, ctx: ServiceContext) {
  const [ws] = await exec.select().from(workspaces).where(eq(workspaces.id, ctx.workspaceId));
  return ws;
}

export async function listWorkspaceMembers(exec: Executor, ctx: ServiceContext) {
  return exec
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: workspaceMembers.role,
      twoFactorEnabled: user.twoFactorEnabled,
      joinedAt: workspaceMembers.createdAt,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(workspaceMembers.createdAt));
}

const roleInput = z.enum(["owner", "admin", "member", "viewer"]);

export async function changeWorkspaceRole(ctx: ServiceContext, userId: string, role: z.input<typeof roleInput>) {
  const next = roleInput.parse(role);
  requireWorkspaceRole(ctx, "owner");
  return db.transaction(async (tx) => {
    const members = await listWorkspaceMembers(tx, ctx);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw notFound("Member not found.");
    if (target.role === next) return;
    if (target.role === "owner" && members.filter((m) => m.role === "owner").length === 1) {
      throw conflict("The workspace needs at least one owner.");
    }
    await tx
      .update(workspaceMembers)
      .set({ role: next })
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)));
    await recordAudit(tx, ctx, {
      action: "workspace.member.role_changed",
      entityType: "workspace_member",
      entityId: userId,
      before: { role: target.role },
      after: { role: next },
    });
  });
}

export async function removeWorkspaceMember(ctx: ServiceContext, userId: string) {
  requireWorkspaceRole(ctx, "admin");
  if (userId === ctx.userId) throw conflict("You can't remove yourself.");
  return db.transaction(async (tx) => {
    const members = await listWorkspaceMembers(tx, ctx);
    const target = members.find((m) => m.userId === userId);
    if (!target) throw notFound("Member not found.");
    if (target.role === "owner" && ctx.workspaceRole !== "owner") throw forbidden("Only owners can remove owners.");
    const memberships = await tx
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(and(eq(projects.workspaceId, ctx.workspaceId), eq(projectMembers.userId, userId)));
    for (const m of memberships) {
      await tx
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, m.projectId), eq(projectMembers.userId, userId)));
    }
    await tx
      .delete(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, userId)));
    await recordAudit(tx, ctx, {
      action: "workspace.member.removed",
      entityType: "workspace_member",
      entityId: userId,
      before: { email: target.email, role: target.role, projects: memberships.map((m) => m.projectId) },
    });
  });
}
