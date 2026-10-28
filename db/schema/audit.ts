import { bigserial, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const actorType = pgEnum("actor_type", ["user", "agent", "system"]);
export type ActorType = (typeof actorType.enumValues)[number];

// Append-only. UPDATE/DELETE/TRUNCATE are rejected and prev_hash/hash are filled by DB triggers
// (see db/migrations/*_audit_triggers.sql); the app never sets them.
export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    workspaceId: uuid("workspace_id"),
    projectId: uuid("project_id"),
    actorType: actorType("actor_type").notNull(),
    actorUserId: text("actor_user_id"),
    agentId: text("agent_id"),
    onBehalfOfUserId: text("on_behalf_of_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    requestId: text("request_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    prevHash: text("prev_hash"),
    hash: text("hash").notNull().default(""),
  },
  (t) => [
    index("audit_events_workspace_idx").on(t.workspaceId, t.id),
    index("audit_events_project_idx").on(t.projectId, t.id),
    index("audit_events_entity_idx").on(t.entityType, t.entityId),
  ],
);
