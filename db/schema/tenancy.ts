import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member", "viewer"]);
export const projectType = pgEnum("project_type", ["artist", "release", "internal"]);
export const projectRole = pgEnum("project_role", ["lead", "editor", "viewer"]);

export type WorkspaceRole = (typeof workspaceRole.enumValues)[number];
export type ProjectRole = (typeof projectRole.enumValues)[number];
export type ProjectType = (typeof projectType.enumValues)[number];

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};

export type LlmPreference = "auto" | "anthropic" | "openai" | "off";

export type WorkspaceSettings = {
  /** Which configured provider the coordinator uses. "off" forces command mode even when keys are set. */
  llm_provider?: LlmPreference;
  /** Monthly LLM spend cap in USD. Defaults to LLM_MONTHLY_BUDGET_USD (or 25). Raising it needs an approval. */
  llm_monthly_budget_usd?: number;
};

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  settings: jsonb("settings").$type<WorkspaceSettings>().notNull().default({}),
  ...timestamps,
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)],
);

export type ProjectSettings = {
  allow_llm_on_lyrics?: boolean;
};

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: projectType("type").notNull().default("artist"),
    artistName: text("artist_name"),
    description: text("description"),
    settings: jsonb("settings").$type<ProjectSettings>().notNull().default({ allow_llm_on_lyrics: false }),
    createdBy: text("created_by").references(() => user.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("projects_workspace_idx").on(t.workspaceId)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_members_user_idx").on(t.userId)],
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: workspaceRole("role").notNull(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: text("invited_by").references(() => user.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [uniqueIndex("invites_token_hash_idx").on(t.tokenHash), index("invites_workspace_idx").on(t.workspaceId)],
);
