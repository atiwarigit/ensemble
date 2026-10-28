import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "@/db";
import { auditEvents } from "@/db/schema/audit";
import { user } from "@/db/schema/auth";
import { projects } from "@/db/schema/tenancy";
import type { ServiceContext } from "./context";
import { visibleProjectIds } from "./access";

export type AuditInput = {
  action: string;
  projectId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Must be called with the same transaction as the mutation it describes. */
export async function recordAudit(exec: Executor, ctx: ServiceContext, input: AuditInput) {
  const [row] = await exec
    .insert(auditEvents)
    .values({
      workspaceId: ctx.workspaceId,
      projectId: input.projectId ?? null,
      actorType: ctx.actorType,
      actorUserId: ctx.actorType === "user" ? ctx.userId : null,
      agentId: ctx.agentId ?? null,
      onBehalfOfUserId: ctx.onBehalfOfUserId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      requestId: ctx.requestId ?? null,
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent ?? null,
    })
    .returning({ id: auditEvents.id, hash: auditEvents.hash });
  return row;
}

/** For events without a signed-in actor (e.g. failed sign-in, invite acceptance before the user exists). */
export async function recordSystemAudit(
  exec: Executor,
  meta: { workspaceId?: string | null; actorUserId?: string | null; ip?: string | null; userAgent?: string | null },
  input: AuditInput,
) {
  await exec.insert(auditEvents).values({
    workspaceId: meta.workspaceId ?? null,
    projectId: input.projectId ?? null,
    actorType: meta.actorUserId ? "user" : "system",
    actorUserId: meta.actorUserId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });
}

const onBehalfOf = alias(user, "on_behalf_of");

export type AuditFilters = { projectId?: string; action?: string; beforeId?: number; limit?: number };

/**
 * Owners see every event in the workspace. Everyone else sees events on projects they can see,
 * plus workspace-level events they performed themselves.
 */
export async function listAuditEvents(exec: Executor, ctx: ServiceContext, filters: AuditFilters = {}) {
  const limit = Math.min(filters.limit ?? 50, 200);
  // Owners also see events that couldn't be tied to a workspace, e.g. sign-in attempts for unknown emails.
  const conds: SQL[] = [
    ctx.workspaceRole === "owner"
      ? or(eq(auditEvents.workspaceId, ctx.workspaceId), isNull(auditEvents.workspaceId))!
      : eq(auditEvents.workspaceId, ctx.workspaceId),
  ];

  if (ctx.workspaceRole !== "owner") {
    const ids = await visibleProjectIds(exec, ctx);
    const scope = or(
      ids.length ? inArray(auditEvents.projectId, ids) : sql`false`,
      and(
        isNull(auditEvents.projectId),
        or(eq(auditEvents.actorUserId, ctx.userId), eq(auditEvents.onBehalfOfUserId, ctx.userId)),
      ),
    );
    if (scope) conds.push(scope);
  }
  if (filters.projectId) conds.push(eq(auditEvents.projectId, filters.projectId));
  if (filters.action) conds.push(sql`${auditEvents.action} like ${filters.action + "%"}`);
  if (filters.beforeId) conds.push(lt(auditEvents.id, filters.beforeId));

  return exec
    .select({
      event: auditEvents,
      actorName: user.name,
      actorEmail: user.email,
      onBehalfOfName: onBehalfOf.name,
      projectName: projects.name,
    })
    .from(auditEvents)
    .leftJoin(user, eq(user.id, auditEvents.actorUserId))
    .leftJoin(onBehalfOf, eq(onBehalfOf.id, auditEvents.onBehalfOfUserId))
    .leftJoin(projects, eq(projects.id, auditEvents.projectId))
    .where(and(...conds))
    .orderBy(desc(auditEvents.id))
    .limit(limit);
}

export type AuditRow = Awaited<ReturnType<typeof listAuditEvents>>[number];

export async function verifyAuditChain(exec: Executor) {
  const breaks = await exec.execute<{ broken_id: string; reason: string }>(sql`select * from audit_verify_chain()`);
  const [head] = await exec
    .select({ id: auditEvents.id, hash: auditEvents.hash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.id))
    .limit(1);
  const [{ count }] = await exec.select({ count: sql<number>`count(*)::int` }).from(auditEvents);
  return {
    ok: breaks.length === 0,
    breaks: breaks.map((b) => ({ id: Number(b.broken_id), reason: b.reason })),
    head: head ?? null,
    count,
  };
}
