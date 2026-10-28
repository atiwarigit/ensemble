import { and, asc, eq, isNull } from "drizzle-orm";
import type { Executor } from "@/db";
import {
  projectMembers,
  projects,
  workspaceMembers,
  type ProjectRole,
  type WorkspaceRole,
} from "@/db/schema/tenancy";
import { forbidden, notFound, type ServiceContext } from "./context";

const WORKSPACE_RANK: Record<WorkspaceRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
const PROJECT_RANK: Record<ProjectRole, number> = { viewer: 0, editor: 1, lead: 2 };

export function hasWorkspaceRole(role: WorkspaceRole, min: WorkspaceRole) {
  return WORKSPACE_RANK[role] >= WORKSPACE_RANK[min];
}

export function requireWorkspaceRole(ctx: ServiceContext, min: WorkspaceRole) {
  if (!hasWorkspaceRole(ctx.workspaceRole, min)) throw forbidden();
}

export function hasProjectRole(role: ProjectRole | null, min: ProjectRole) {
  return role !== null && PROJECT_RANK[role] >= PROJECT_RANK[min];
}

/** Phase 1 has a single workspace per user; returns the oldest membership. */
export async function getWorkspaceMembership(exec: Executor, userId: string) {
  const [m] = await exec
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  return m ?? null;
}

/**
 * Effective role of the caller on a project. Workspace owners act as lead on every project;
 * everyone else needs an explicit project_members row (projects are private by default).
 */
export async function getProjectAccess(exec: Executor, ctx: ServiceContext, projectId: string) {
  const [row] = await exec
    .select({ project: projects, memberRole: projectMembers.role })
    .from(projects)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, ctx.userId)),
    )
    .where(and(eq(projects.id, projectId), eq(projects.workspaceId, ctx.workspaceId)))
    .limit(1);
  if (!row) return null;
  const role: ProjectRole | null = ctx.workspaceRole === "owner" ? "lead" : (row.memberRole ?? null);
  return { project: row.project, role };
}

/**
 * The single authorization gate for project-scoped work. Projects the caller can't see are
 * reported as not found so their existence isn't leaked.
 */
export async function requireProjectRole(
  exec: Executor,
  ctx: ServiceContext,
  projectId: string,
  minRole: ProjectRole,
) {
  const access = await getProjectAccess(exec, ctx, projectId);
  if (!access || access.role === null) throw notFound("Project not found.");
  if (!hasProjectRole(access.role, minRole)) throw forbidden();
  return { project: access.project, role: access.role };
}

export async function visibleProjectIds(exec: Executor, ctx: ServiceContext, opts: { includeArchived?: boolean } = {}) {
  const archived = opts.includeArchived ? undefined : isNull(projects.archivedAt);
  if (ctx.workspaceRole === "owner") {
    const rows = await exec
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, ctx.workspaceId), archived));
    return rows.map((r) => r.id);
  }
  const rows = await exec
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(projectMembers, eq(projectMembers.projectId, projects.id))
    .where(and(eq(projects.workspaceId, ctx.workspaceId), eq(projectMembers.userId, ctx.userId), archived));
  return rows.map((r) => r.id);
}
