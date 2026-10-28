import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { approvalRequests, type ApproverRole } from "@/db/schema/approvals";
import { projectMembers, projects } from "@/db/schema/tenancy";
import { formatMoney } from "@/lib/format";
import { recordAudit, recordSystemAudit } from "./audit";
import { requireProjectRole, visibleProjectIds } from "./access";
import { conflict, forbidden, invalid, notFound, ServiceError, type ServiceContext } from "./context";
import {
  assertCanImportInto,
  commitImportTx,
  LARGE_IMPORT_ROWS,
  loadBatch,
  pendingImportRows,
  revertImportTx,
} from "./imports";
import { contributorsInput, getWork, replaceContributors } from "./lyrics";
import { archiveProjectTx, setAllowLlmOnLyricsTx } from "./projects";
import { assertFinalizable, finalizeWorkTx, generateRightsPackage } from "./rights";

export const APPROVAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Prepared = {
  projectId: string | null;
  entityType: string;
  entityId: string;
  summary: string;
  requiredRole: ApproverRole;
  /** Extra context copied into the audit events, e.g. the work id so rights packages can cite them. */
  auditContext?: Record<string, unknown>;
};

type ActionDef<P> = {
  label: string;
  schema: z.ZodType<P>;
  /** Validates the action against current state for `ctx`; runs at request time and again on approval. */
  prepare: (exec: Executor, ctx: ServiceContext, payload: P) => Promise<Prepared>;
  execute: (exec: Executor, approver: ServiceContext, payload: P, requestId: string) => Promise<unknown>;
};

const define = <P,>(d: ActionDef<P>) => d;

const workPayload = z.object({ workId: z.string().uuid() });
const batchPayload = z.object({ batchId: z.string().uuid() });
const projectPayload = z.object({ projectId: z.string().uuid() });

async function requireEditorOnWork(exec: Executor, ctx: ServiceContext, workId: string) {
  const { work, project, role } = await getWork(exec, ctx, workId);
  if (role === "viewer") throw forbidden();
  if (project.archivedAt) throw invalid("This project is archived.");
  return { work, project };
}

async function describeBatch(exec: Executor, ctx: ServiceContext, batchId: string) {
  const batch = await loadBatch(exec, ctx, batchId);
  const [project] = batch.projectId
    ? await exec.select({ name: projects.name }).from(projects).where(eq(projects.id, batch.projectId))
    : [];
  return { batch, where: project ? project.name : "personal expenses" };
}

export const APPROVAL_ACTIONS = {
  "lyric.finalize": define({
    label: "Finalize lyric",
    schema: workPayload,
    async prepare(exec, ctx, { workId }) {
      const { work } = await requireEditorOnWork(exec, ctx, workId);
      await assertFinalizable(exec, work);
      return {
        projectId: work.projectId,
        entityType: "lyric_work",
        entityId: work.id,
        summary: `Finalize “${work.title}”: lock the text and split and issue the final rights package`,
        requiredRole: "lead",
        auditContext: { workId: work.id },
      };
    },
    execute: (exec, approver, { workId }, requestId) => finalizeWorkTx(exec, approver, workId, requestId),
  }),

  "lyric.contributors.change": define({
    label: "Change split on a final lyric",
    schema: workPayload.extend({ contributors: contributorsInput }),
    async prepare(exec, ctx, { workId, contributors }) {
      const { work } = await requireEditorOnWork(exec, ctx, workId);
      if (work.status === "draft") throw invalid("This work is still a draft, so you can change the split directly.");
      const split = contributors.map((c) => `${c.name} ${c.sharePct}%`).join(", ");
      return {
        projectId: work.projectId,
        entityType: "lyric_work",
        entityId: work.id,
        summary: `Change the split on final work “${work.title}” to ${split}`,
        requiredRole: "lead",
        auditContext: { workId: work.id },
      };
    },
    async execute(exec, approver, { workId, contributors }, requestId) {
      const { work } = await getWork(exec, approver, workId);
      if (work.status === "draft") throw invalid("This work is a draft again; change the split directly.");
      await replaceContributors(exec, approver, work, contributors);
      const pkg = await generateRightsPackage(exec, approver, work, { kind: "final", approvalRequestId: requestId });
      return { packageId: pkg.id };
    },
  }),

  "import.commit_large": define({
    label: "Large CSV import",
    schema: batchPayload,
    async prepare(exec, ctx, { batchId }) {
      const { batch, where } = await describeBatch(exec, ctx, batchId);
      if (batch.status !== "previewed") throw invalid("This import has already been committed.");
      await assertCanImportInto(exec, ctx, batch.projectId);
      const rows = await pendingImportRows(exec, ctx, batch);
      if (rows <= LARGE_IMPORT_ROWS) throw invalid(`Imports of ${LARGE_IMPORT_ROWS} rows or fewer don't need an approval.`);
      return {
        projectId: batch.projectId,
        entityType: "import_batch",
        entityId: batch.id,
        summary: `Import ${rows} expenses from ${batch.filename} into ${where}`,
        requiredRole: batch.projectId ? "lead" : "owner",
      };
    },
    async execute(exec, approver, { batchId }) {
      const b = await commitImportTx(exec, approver, batchId, { approved: true });
      return { inserted: b.inserted, skippedDupes: b.skippedDupes };
    },
  }),

  "import.revert": define({
    label: "Revert CSV import",
    schema: batchPayload,
    async prepare(exec, ctx, { batchId }) {
      const { batch, where } = await describeBatch(exec, ctx, batchId);
      if (batch.status !== "committed") throw invalid("Only committed imports can be reverted.");
      if (batch.projectId) await requireProjectRole(exec, ctx, batch.projectId, "editor");
      const total = batch.totalMinor ? ` (${formatMoney(batch.totalMinor)})` : "";
      return {
        projectId: batch.projectId,
        entityType: "import_batch",
        entityId: batch.id,
        summary: `Revert the import of ${batch.filename} in ${where}: remove ${batch.inserted} expenses${total}`,
        requiredRole: batch.projectId ? "lead" : "owner",
      };
    },
    execute: (exec, approver, { batchId }) => revertImportTx(exec, approver, batchId),
  }),

  "project.archive": define({
    label: "Archive project",
    schema: projectPayload,
    async prepare(exec, ctx, { projectId }) {
      const { project } = await requireProjectRole(exec, ctx, projectId, "lead");
      if (project.archivedAt) throw invalid("This project is already archived.");
      return {
        projectId,
        entityType: "project",
        entityId: projectId,
        summary: `Archive the project “${project.name}”`,
        requiredRole: "owner",
      };
    },
    execute: (exec, approver, { projectId }) => archiveProjectTx(exec, approver, projectId),
  }),

  "project.allow_llm_on_lyrics": define({
    label: "Let AI models read lyrics",
    schema: projectPayload,
    async prepare(exec, ctx, { projectId }) {
      const { project } = await requireProjectRole(exec, ctx, projectId, "lead");
      if (project.settings.allow_llm_on_lyrics) throw invalid("AI access to lyrics is already on for this project.");
      return {
        projectId,
        entityType: "project",
        entityId: projectId,
        summary: `Let AI models read the lyrics in “${project.name}”`,
        requiredRole: "owner",
      };
    },
    execute: (exec, approver, { projectId }) => setAllowLlmOnLyricsTx(exec, approver, projectId, true),
  }),
} as const;

export type ApprovalActionType = keyof typeof APPROVAL_ACTIONS;
type PayloadOf<T extends ApprovalActionType> = z.input<(typeof APPROVAL_ACTIONS)[T]["schema"]>;

function actionDef(type: string) {
  const def = (APPROVAL_ACTIONS as Record<string, ActionDef<unknown>>)[type];
  if (!def) throw invalid(`Unknown approval action: ${type}`);
  return def;
}

export function isApprovalActionType(type: string): type is ApprovalActionType {
  return type in APPROVAL_ACTIONS;
}

// ---------------------------------------------------------------------------------------------
// Requesting

export async function requestApproval<T extends ApprovalActionType>(
  ctx: ServiceContext,
  actionType: T,
  payload: PayloadOf<T>,
  reason?: string | null,
) {
  const def = actionDef(actionType);
  const data = def.schema.parse(payload);
  const note = z.string().trim().max(1000).optional().nullable().parse(reason) || null;
  return db.transaction(async (tx) => {
    await expireStale(tx, ctx.workspaceId);
    const prepared = await def.prepare(tx, ctx, data);
    const [existing] = await tx
      .select({ id: approvalRequests.id })
      .from(approvalRequests)
      .where(
        and(
          eq(approvalRequests.actionType, actionType),
          eq(approvalRequests.entityId, prepared.entityId),
          eq(approvalRequests.status, "pending"),
        ),
      );
    if (existing) throw conflict("There's already a pending request for this. It's in the approvals queue.");
    const [req] = await tx
      .insert(approvalRequests)
      .values({
        workspaceId: ctx.workspaceId,
        projectId: prepared.projectId,
        actionType,
        payload: data as object,
        summary: prepared.summary,
        entityType: prepared.entityType,
        entityId: prepared.entityId,
        requestedBy: ctx.userId,
        requestedByActor: ctx.actorType,
        reason: note,
        requiredRole: prepared.requiredRole,
        expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
      })
      .returning();
    await recordAudit(tx, ctx, {
      action: "approval.requested",
      projectId: req.projectId,
      entityType: "approval_request",
      entityId: req.id,
      after: {
        actionType,
        summary: req.summary,
        payload: data,
        reason: note,
        requiredRole: req.requiredRole,
        expiresAt: req.expiresAt.toISOString(),
        entity: { type: req.entityType, id: req.entityId },
        ...prepared.auditContext,
      },
    });
    return req;
  });
}

// ---------------------------------------------------------------------------------------------
// Deciding

/** Marks overdue pending requests as expired. Called lazily from reads and writes. */
export async function expireStale(exec: Executor, workspaceId: string) {
  const expired = await exec
    .update(approvalRequests)
    .set({ status: "expired" })
    .where(
      and(
        eq(approvalRequests.workspaceId, workspaceId),
        eq(approvalRequests.status, "pending"),
        lt(approvalRequests.expiresAt, sql`now()`),
      ),
    )
    .returning();
  for (const r of expired) {
    await recordSystemAudit(
      exec,
      { workspaceId },
      {
        action: "approval.expired",
        projectId: r.projectId,
        entityType: "approval_request",
        entityId: r.id,
        after: { actionType: r.actionType, summary: r.summary, expiresAt: r.expiresAt.toISOString() },
      },
    );
  }
  return expired.length;
}

async function canApprove(exec: Executor, ctx: ServiceContext, req: { requiredRole: ApproverRole; projectId: string | null }) {
  if (ctx.workspaceRole === "owner") return true;
  if (req.requiredRole === "owner" || !req.projectId) return false;
  try {
    await requireProjectRole(exec, ctx, req.projectId, "lead");
    return true;
  } catch {
    return false;
  }
}

export const decisionInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
});

/**
 * Approve: re-validates the stored payload and executes it under the approver's identity. If the
 * action fails (e.g. the work changed since the request), the request is marked failed and the
 * action's partial writes are rolled back. Reject: by an approver, or by the requester (withdraw).
 */
export async function decideApproval(ctx: ServiceContext, requestId: string, input: z.input<typeof decisionInput>) {
  const { decision, note } = decisionInput.parse(input);
  return db.transaction(async (tx) => {
    await expireStale(tx, ctx.workspaceId);
    const [req] = await tx
      .select()
      .from(approvalRequests)
      .where(and(eq(approvalRequests.id, requestId), eq(approvalRequests.workspaceId, ctx.workspaceId)))
      .for("update");
    if (!req) throw notFound("Request not found.");
    if (!(await isVisible(tx, ctx, req))) throw notFound("Request not found.");
    if (req.status !== "pending") throw invalid(`This request is already ${req.status}.`);

    const isRequester = req.requestedBy === ctx.userId;
    const approver = await canApprove(tx, ctx, req);
    const def = actionDef(req.actionType);
    const auditBase = { actionType: req.actionType, summary: req.summary, entity: { type: req.entityType, id: req.entityId } };
    const workContext = req.entityType === "lyric_work" ? { workId: req.entityId } : {};

    if (decision === "reject") {
      if (!approver && !isRequester) throw forbidden("Only an approver or the requester can reject this.");
      const withdrawn = isRequester && !approver;
      const [updated] = await tx
        .update(approvalRequests)
        .set({ status: "rejected", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note ?? (withdrawn ? "Withdrawn" : null) })
        .where(eq(approvalRequests.id, req.id))
        .returning();
      await recordAudit(tx, ctx, {
        action: withdrawn ? "approval.withdrawn" : "approval.rejected",
        projectId: req.projectId,
        entityType: "approval_request",
        entityId: req.id,
        before: { status: "pending" },
        after: { ...auditBase, ...workContext, status: "rejected", note },
      });
      return updated;
    }

    if (!approver) {
      throw forbidden(
        req.requiredRole === "owner" ? "Only a workspace owner can approve this." : "Only a project lead or a workspace owner can approve this.",
      );
    }
    if (isRequester && ctx.workspaceRole !== "owner") {
      throw forbidden("You can't approve your own request. Another lead or a workspace owner has to.");
    }
    const selfApproved = isRequester;

    await tx
      .update(approvalRequests)
      .set({ status: "approved", decidedBy: ctx.userId, decidedAt: new Date(), decisionNote: note })
      .where(eq(approvalRequests.id, req.id));
    await recordAudit(tx, ctx, {
      action: "approval.approved",
      projectId: req.projectId,
      entityType: "approval_request",
      entityId: req.id,
      before: { status: "pending" },
      after: { ...auditBase, ...workContext, status: "approved", note, selfApproved },
    });

    let result: unknown;
    let error: string | null = null;
    try {
      result = await tx.transaction(async (sp) => {
        const payload = def.schema.parse(req.payload);
        await def.prepare(sp, ctx, payload);
        return def.execute(sp, ctx, payload, req.id);
      });
    } catch (err) {
      if (err instanceof ServiceError) error = err.message;
      else if (err instanceof z.ZodError) error = err.issues[0]?.message ?? "The request is no longer valid.";
      else throw err;
    }

    const [updated] = await tx
      .update(approvalRequests)
      .set(error ? { status: "failed", error } : { status: "executed", executedAt: new Date(), result: (result ?? null) as object })
      .where(eq(approvalRequests.id, req.id))
      .returning();
    await recordAudit(tx, ctx, {
      action: error ? "approval.failed" : "approval.executed",
      projectId: req.projectId,
      entityType: "approval_request",
      entityId: req.id,
      before: { status: "approved" },
      after: { ...auditBase, ...workContext, status: updated.status, ...(error ? { error } : { result }) },
    });
    return updated;
  });
}

// ---------------------------------------------------------------------------------------------
// Reading

async function visibilityCondition(exec: Executor, ctx: ServiceContext): Promise<SQL> {
  if (ctx.workspaceRole === "owner") return eq(approvalRequests.workspaceId, ctx.workspaceId);
  const ids = await visibleProjectIds(exec, ctx, { includeArchived: true });
  return and(
    eq(approvalRequests.workspaceId, ctx.workspaceId),
    or(
      ids.length ? inArray(approvalRequests.projectId, ids) : sql`false`,
      and(isNull(approvalRequests.projectId), eq(approvalRequests.requestedBy, ctx.userId)),
    ),
  )!;
}

async function isVisible(exec: Executor, ctx: ServiceContext, req: { projectId: string | null; requestedBy: string }) {
  if (ctx.workspaceRole === "owner") return true;
  if (!req.projectId) return req.requestedBy === ctx.userId;
  return (await visibleProjectIds(exec, ctx, { includeArchived: true })).includes(req.projectId);
}

const requester = sql<string>`(select u.name from "user" u where u.id = ${approvalRequests.requestedBy})`;
const decider = sql<string | null>`(select u.name from "user" u where u.id = ${approvalRequests.decidedBy})`;

export async function listApprovals(
  exec: Executor,
  ctx: ServiceContext,
  f: { scope: "pending" | "decided"; entityType?: string; entityId?: string; limit?: number },
) {
  await expireStale(exec, ctx.workspaceId);
  const leadOf = new Set(
    ctx.workspaceRole === "owner"
      ? []
      : (
          await exec
            .select({ projectId: projectMembers.projectId })
            .from(projectMembers)
            .where(and(eq(projectMembers.userId, ctx.userId), eq(projectMembers.role, "lead")))
        ).map((r) => r.projectId),
  );
  const rows = await exec
    .select({ req: approvalRequests, requesterName: requester, deciderName: decider, projectName: projects.name })
    .from(approvalRequests)
    .leftJoin(projects, eq(projects.id, approvalRequests.projectId))
    .where(
      and(
        await visibilityCondition(exec, ctx),
        f.scope === "pending" ? eq(approvalRequests.status, "pending") : sql`${approvalRequests.status} <> 'pending'`,
        f.entityType ? eq(approvalRequests.entityType, f.entityType) : undefined,
        f.entityId ? eq(approvalRequests.entityId, f.entityId) : undefined,
      ),
    )
    .orderBy(desc(f.scope === "pending" ? approvalRequests.createdAt : sql`coalesce(${approvalRequests.decidedAt}, ${approvalRequests.createdAt})`))
    .limit(Math.min(f.limit ?? 100, 200));
  return rows.map((r) => {
    const isRequester = r.req.requestedBy === ctx.userId;
    const approver =
      ctx.workspaceRole === "owner" || (r.req.requiredRole === "lead" && !!r.req.projectId && leadOf.has(r.req.projectId));
    return {
      ...r,
      isRequester,
      canApprove: r.req.status === "pending" && approver && (!isRequester || ctx.workspaceRole === "owner"),
      canReject: r.req.status === "pending" && (approver || isRequester),
      label: isApprovalActionType(r.req.actionType) ? APPROVAL_ACTIONS[r.req.actionType].label : r.req.actionType,
    };
  });
}

export type ApprovalRow = Awaited<ReturnType<typeof listApprovals>>[number];

/** Pending requests the caller could approve; drives the sidebar badge. */
export async function countAwaitingMe(exec: Executor, ctx: ServiceContext) {
  const rows = await listApprovals(exec, ctx, { scope: "pending" });
  return rows.filter((r) => r.canApprove).length;
}
