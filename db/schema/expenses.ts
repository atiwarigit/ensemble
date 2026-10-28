import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects, workspaces } from "./tenancy";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};

export const expenseSource = pgEnum("expense_source", ["manual", "csv", "agent"]);
export const budgetPeriod = pgEnum("budget_period", ["month", "quarter", "total"]);
export const ruleMatchField = pgEnum("rule_match_field", ["merchant", "description"]);
export const importKind = pgEnum("import_kind", ["expenses", "s4a"]);
export const importStatus = pgEnum("import_status", ["previewed", "committed", "reverted"]);

export type BudgetPeriod = (typeof budgetPeriod.enumValues)[number];

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => expenseCategories.id),
    isGenerationCost: boolean("is_generation_cost").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("expense_categories_name_idx").on(t.workspaceId, sql`coalesce(${t.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`, sql`lower(${t.name})`),
  ],
);

export const importMappings = pgTable(
  "import_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: importKind("kind").notNull().default("expenses"),
    columnMap: jsonb("column_map").$type<ColumnMap>().notNull(),
    dateFormat: text("date_format").notNull(),
    amountMode: text("amount_mode").$type<AmountMode>().notNull(),
    headerSignature: text("header_signature").notNull(),
    createdBy: text("created_by").references(() => user.id),
    ...timestamps,
  },
  (t) => [index("import_mappings_signature_idx").on(t.workspaceId, t.headerSignature)],
);

export type ColumnMap = {
  date: string;
  description: string;
  amount?: string | null;
  debit?: string | null;
  credit?: string | null;
  merchant?: string | null;
  category?: string | null;
  account?: string | null;
  currency?: string | null;
};
export type AmountMode = "negative_is_expense" | "positive_is_expense" | "split";

export type ImportErrorSummary = { line: number; message: string }[];

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id),
    kind: importKind("kind").notNull().default("expenses"),
    filename: text("filename").notNull(),
    fileSha256: text("file_sha256").notNull(),
    // Original file text, kept only until the batch is committed (or discarded).
    rawCsv: text("raw_csv"),
    blobUrl: text("blob_url"),
    headers: jsonb("headers").$type<string[]>().notNull(),
    headerSignature: text("header_signature").notNull(),
    mappingId: uuid("mapping_id").references(() => importMappings.id, { onDelete: "set null" }),
    columnMap: jsonb("column_map").$type<ColumnMap>(),
    dateFormat: text("date_format"),
    amountMode: text("amount_mode").$type<AmountMode>(),
    rowCount: integer("row_count").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    skippedDupes: integer("skipped_dupes").notNull().default(0),
    excluded: integer("excluded").notNull().default(0),
    errors: jsonb("errors").$type<ImportErrorSummary>().notNull().default([]),
    totalMinor: bigint("total_minor", { mode: "number" }).notNull().default(0),
    status: importStatus("status").notNull().default("previewed"),
    createdBy: text("created_by").references(() => user.id),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    revertedBy: text("reverted_by").references(() => user.id),
    ...timestamps,
  },
  (t) => [index("import_batches_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // null = personal / unallocated: visible to its creator and workspace owners only.
    projectId: uuid("project_id").references(() => projects.id),
    date: date("date", { mode: "string" }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    merchant: text("merchant"),
    description: text("description").notNull(),
    categoryId: uuid("category_id").references(() => expenseCategories.id),
    paymentAccount: text("payment_account"),
    source: expenseSource("source").notNull().default("manual"),
    importBatchId: uuid("import_batch_id").references(() => importBatches.id),
    dedupeHash: text("dedupe_hash"),
    notes: text("notes"),
    receiptBlobUrl: text("receipt_blob_url"),
    createdBy: text("created_by").references(() => user.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("expenses_dedupe_idx")
      .on(t.workspaceId, t.dedupeHash)
      .where(sql`${t.archivedAt} is null and ${t.dedupeHash} is not null`),
    index("expenses_project_date_idx").on(t.projectId, t.date),
    index("expenses_workspace_date_idx").on(t.workspaceId, t.date),
    index("expenses_batch_idx").on(t.importBatchId),
  ],
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => expenseCategories.id),
    period: budgetPeriod("period").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("USD"),
    alertAtPct: integer("alert_at_pct").notNull().default(80),
    createdBy: text("created_by").references(() => user.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("budgets_scope_idx").on(
      t.projectId,
      sql`coalesce(${t.categoryId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.period,
    ),
  ],
);

export const categorizationRules = pgTable(
  "categorization_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    matchField: ruleMatchField("match_field").notNull().default("description"),
    // Case-insensitive substring match.
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => expenseCategories.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    priority: integer("priority").notNull().default(100),
    createdBy: text("created_by").references(() => user.id),
    ...timestamps,
  },
  (t) => [index("categorization_rules_workspace_idx").on(t.workspaceId, t.priority)],
);
