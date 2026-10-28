import { sql } from "drizzle-orm";
import { char, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, bigint } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { storedFiles } from "./files";
import { lyricWorks } from "./lyrics";
import { projects, workspaces } from "./tenancy";

export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected", "expired", "executed", "failed"]);
export type ApprovalStatus = (typeof approvalStatus.enumValues)[number];

/** `lead` = project lead (workspace owners count as lead everywhere); `owner` = workspace owner. */
export const approverRole = pgEnum("approval_required_role", ["lead", "owner"]);
export type ApproverRole = (typeof approverRole.enumValues)[number];

/**
 * Plan §3.5. A gated action is stored here with its validated payload and only runs after someone
 * with `required_role` approves it; the payload is re-validated and executed under the approver.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    payload: jsonb("payload").notNull(),
    summary: text("summary").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    requestedByActor: text("requested_by_actor").notNull().default("user"),
    reason: text("reason"),
    status: approvalStatus("status").notNull().default("pending"),
    requiredRole: approverRole("required_role").notNull(),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    result: jsonb("result"),
    error: text("error"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("approval_requests_workspace_status_idx").on(t.workspaceId, t.status),
    index("approval_requests_entity_idx").on(t.entityType, t.entityId),
    uniqueIndex("approval_requests_one_pending_idx")
      .on(t.actionType, t.entityId)
      .where(sql`status = 'pending'`),
  ],
);

export const rightsPackageKind = pgEnum("rights_package_kind", ["draft", "final"]);

/** Generated rights documentation packages (ZIP with PDF, manifest, texts, evidence, SHA256SUMS). Append-only. */
export const rightsPackages = pgTable(
  "rights_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => lyricWorks.id, { onDelete: "cascade" }),
    kind: rightsPackageKind("kind").notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => storedFiles.id),
    filename: text("filename").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    zipSha256: char("zip_sha256", { length: 64 }).notNull(),
    pdfSha256: char("pdf_sha256", { length: 64 }).notNull(),
    manifestSha256: char("manifest_sha256", { length: 64 }).notNull(),
    /** sha256sum-format listing of every file in the ZIP, kept for display without unzipping. */
    sha256sums: text("sha256sums").notNull(),
    chainHeadId: bigint("chain_head_id", { mode: "number" }),
    chainHeadHash: char("chain_head_hash", { length: 64 }),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequests.id),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rights_packages_work_idx").on(t.workId, t.createdAt)],
);
