import { bigint, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { lyricVersions, lyricWorks } from "./lyrics";
import { projects, workspaces } from "./tenancy";

/** `llm` = answered by a model; `commands` = answered by the deterministic command router. */
export const chatMode = pgEnum("chat_mode", ["llm", "commands"]);
export type ChatMode = (typeof chatMode.enumValues)[number];

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Null = all projects the user can see. Tools are scoped to this. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_threads_user_idx").on(t.userId, t.updatedAt)],
);

/** One row per UI message. `parts` holds the AI SDK UIMessage parts (text, tool calls and results, data parts). */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    parts: jsonb("parts").notNull(),
    mode: chatMode("mode"),
    provider: text("provider"),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }),
    /** Agents whose tools ran while producing this message, e.g. ["finance", "lyrics"]. */
    agents: jsonb("agents").$type<string[]>(),
    notice: text("notice"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.id] }), index("chat_messages_thread_idx").on(t.threadId, t.createdAt)],
);

/** Rolling per-project summary shared with the coordinator. Built from tool activity, not raw user text. */
export const projectContext = pgTable("project_context", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmCallStatus = pgEnum("llm_call_status", ["ok", "error", "blocked"]);

/** Every model call, for cost tracking, the monthly budget, and debugging provider fallbacks. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    threadId: uuid("thread_id").references(() => chatThreads.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: llmCallStatus("status").notNull(),
    errorCode: text("error_code"),
    error: text("error"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms"),
    /** Set when this call was a retry on the other provider after `fallbackFrom` failed. */
    fallbackFrom: text("fallback_from"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_workspace_month_idx").on(t.workspaceId, t.createdAt)],
);

export const suggestionStatus = pgEnum("lyric_suggestion_status", ["open", "accepted", "dismissed"]);
export type SuggestionStatus = (typeof suggestionStatus.enumValues)[number];

/**
 * AI-proposed lyric text, kept apart from the human record. It only becomes a lyric version when a
 * person accepts it, and that version is marked `human_edit_of_ai_suggestion`.
 */
export const lyricSuggestions = pgTable(
  "lyric_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => lyricWorks.id, { onDelete: "cascade" }),
    baseVersionId: uuid("base_version_id")
      .notNull()
      .references(() => lyricVersions.id),
    kind: text("kind").$type<"structure" | "rhyme" | "edit">().notNull(),
    suggestion: text("suggestion").notNull(),
    rationale: text("rationale"),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    threadId: uuid("thread_id").references(() => chatThreads.id, { onDelete: "set null" }),
    requestedBy: text("requested_by")
      .notNull()
      .references(() => user.id),
    status: suggestionStatus("status").notNull().default("open"),
    decidedBy: text("decided_by").references(() => user.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    acceptedVersionId: uuid("accepted_version_id").references(() => lyricVersions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lyric_suggestions_work_idx").on(t.workId, t.createdAt)],
);
