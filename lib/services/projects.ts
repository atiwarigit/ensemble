import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import { projectMembers, projects, workspaceMembers } from "@/db/schema/tenancy";
import { recordAudit } from "./audit";
import { hasWorkspaceRole, requireProjectRole, requireWorkspaceRole, visibleProjectIds } from "./access";
import { conflict, invalid, notFound, type ServiceContext } from "./context";

export const projectInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  type: z.enum(["artist", "release", "internal"]),
  artistName: z.string().trim().max(120).optional().transform((v) => v || null),
  description: z.string().trim().max(2000).optional().transform((v) => v || null),
});
export type ProjectInput = z.input<typeof projectInput>;

export const projectMemberInput = z.object({
  userId: z.string().min(1),
  role: z.enum(["lead", "editor", "viewer"]),
});

export async function listProjects(exec: Executor, ctx: ServiceContext, opts: { includeArchived?: boolean } = {}) {
  const ids = await visibleProjectIds(exec, ctx, opts);
  if (!ids.length) return [];
  const memberCount = sql<number>`(select count(*)::int from ${projectMembers} pm where pm.project_id = ${projects.id})`;
  const myRole = sql<string | null>`(select pm.role from ${projectMembers} pm where pm.project_id = ${projects.id} and pm.user_id = ${ctx.userId})`;
  return exec
    .select({
      id: projects.id,
      name: projects.name,
      type: projects.type,
      artistName: projects.artistName,
      archivedAt: projects.archivedAt,
      createdAt: projects.createdAt,
      memberCount,
      myRole,
    })
    .from(projects)
    .where(inArray(projects.id, ids))
    .orderBy(asc(projects.archivedAt), desc(projects.createdAt));
}

export async function getProject(exec: Executor, ctx: ServiceContext, projectId: string) {
  return requireProjectRole(exec, ctx, projectId, "viewer");
}

export async function createProject(ctx: ServiceContext, input: ProjectInput) {
  requireWorkspaceRole(ctx, "member");
  const data = projectInput.parse(input);
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ ...data, workspaceId: ctx.workspaceId, createdBy: ctx.userId })
      .returning();
    await tx.insert(projectMembers).values({ projectId: project.id, userId: ctx.userId, role: "lead" });
    await recordAudit(tx, ctx, {
      action: "project.created",
      projectId: project.id,
      entityType: "project",
      entityId: project.id,
      after: { ...data, private: true },
    });
    await recordAudit(tx, ctx, {
      action: "project.member.added",
      projectId: project.id,
      entityType: "project_member",
      entityId: `${project.id}:${ctx.userId}`,
      after: { userId: ctx.userId, role: "lead" },
    });
    return project;
  });
}

export async function updateProject(ctx: ServiceContext, projectId: string, input: ProjectInput) {
  const data = projectInput.parse(input);
  return db.transaction(async (tx) => {
    const { project } = await requireProjectRole(tx, ctx, projectId, "lead");
    const [updated] = await tx.update(projects).set(data).where(eq(projects.id, projectId)).returning();
    await recordAudit(tx, ctx, {
      action: "project.updated",
      projectId,
      entityType: "project",
      entityId: projectId,
      before: { name: project.name, type: project.type, artistName: project.artistName, description: project.description },
      after: data,
    });
    return updated;
  });
}

// Plan §3.5 gates archiving behind an approval request; that queue lands in a later milestone,
// until then it's limited to project leads and workspace owners.
export async function setProjectArchived(ctx: ServiceContext, projectId: string, archived: boolean) {
  return db.transaction(async (tx) => {
    const { project } = await requireProjectRole(tx, ctx, projectId, "lead");
    const archivedAt = archived ? new Date() : null;
    await tx.update(projects).set({ archivedAt }).where(eq(projects.id, projectId));
    await recordAudit(tx, ctx, {
      action: archived ? "project.archived" : "project.unarchived",
      projectId,
      entityType: "project",
      entityId: projectId,
      before: { archivedAt: project.archivedAt },
      after: { archivedAt },
    });
  });
}

export async function listProjectMembers(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "viewer");
  return exec
    .select({ userId: user.id, name: user.name, email: user.email, role: projectMembers.role, addedAt: projectMembers.createdAt })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(user.name));
}

export async function setProjectMember(ctx: ServiceContext, projectId: string, input: z.input<typeof projectMemberInput>) {
  const data = projectMemberInput.parse(input);
  return db.transaction(async (tx) => {
    await requireProjectRole(tx, ctx, projectId, "lead");
    const [wsMember] = await tx
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), eq(workspaceMembers.userId, data.userId)));
    if (!wsMember) throw invalid("That person isn't a member of this workspace.");
    if (wsMember.role === "viewer" && data.role !== "viewer") throw invalid("Workspace viewers can only be project viewers.");

    const [existing] = await tx
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, data.userId)));
    if (existing?.role === data.role) return;

    await tx
      .insert(projectMembers)
      .values({ projectId, userId: data.userId, role: data.role })
      .onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role: data.role } });
    await recordAudit(tx, ctx, {
      action: existing ? "project.member.role_changed" : "project.member.added",
      projectId,
      entityType: "project_member",
      entityId: `${projectId}:${data.userId}`,
      before: existing ? { userId: data.userId, role: existing.role } : null,
      after: { userId: data.userId, role: data.role },
    });
  });
}

export async function removeProjectMember(ctx: ServiceContext, projectId: string, userId: string) {
  return db.transaction(async (tx) => {
    await requireProjectRole(tx, ctx, projectId, "lead");
    const members = await tx
      .select({ userId: projectMembers.userId, role: projectMembers.role })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    const target = members.find((m) => m.userId === userId);
    if (!target) throw notFound("That person isn't on this project.");
    if (target.role === "lead" && members.filter((m) => m.role === "lead").length === 1) {
      throw conflict("A project needs at least one lead.");
    }
    await tx
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    await recordAudit(tx, ctx, {
      action: "project.member.removed",
      projectId,
      entityType: "project_member",
      entityId: `${projectId}:${userId}`,
      before: target,
    });
  });
}

/** Workspace members who could be added to the project (not already on it). */
export async function listAddableMembers(exec: Executor, ctx: ServiceContext, projectId: string) {
  await requireProjectRole(exec, ctx, projectId, "lead");
  const onProject = exec
    .select({ id: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  return exec
    .select({ userId: user.id, name: user.name, email: user.email, workspaceRole: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), sql`${user.id} not in (${onProject})`))
    .orderBy(asc(user.name));
}

export function canCreateProjects(ctx: ServiceContext) {
  return hasWorkspaceRole(ctx.workspaceRole, "member");
}