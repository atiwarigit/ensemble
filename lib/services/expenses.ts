import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { user } from "@/db/schema/auth";
import {
  budgets,
  categorizationRules,
  expenseCategories,
  expenses,
  type BudgetPeriod,
} from "@/db/schema/expenses";
import { projects } from "@/db/schema/tenancy";
import { parseAmountMinor, SUPPORTED_CURRENCIES } from "@/lib/csv/expenses-csv";
import { recordAudit } from "./audit";
import { requireProjectRole, requireWorkspaceRole, visibleProjectIds } from "./access";
import { conflict, forbidden, invalid, notFound, type ServiceContext } from "./context";

// ---------------------------------------------------------------------------------------------
// Categories

export const DEFAULT_CATEGORIES: { name: string; generation?: boolean; children?: string[] }[] = [
  { name: "Generation", generation: true, children: ["Suno", "Kling"] },
  { name: "Software" },
  { name: "Marketing" },
  { name: "Travel" },
  { name: "Legal" },
  { name: "Studio" },
  { name: "Other" },
];

export async function seedDefaultCategories(exec: Executor, workspaceId: string) {
  const existing = await exec
    .select({ id: expenseCategories.id, name: expenseCategories.name, parentId: expenseCategories.parentId })
    .from(expenseCategories)
    .where(eq(expenseCategories.workspaceId, workspaceId));
  const byName = new Map(existing.filter((c) => !c.parentId).map((c) => [c.name.toLowerCase(), c.id]));
  for (const cat of DEFAULT_CATEGORIES) {
    let parentId = byName.get(cat.name.toLowerCase());
    if (!parentId) {
      [{ id: parentId }] = await exec
        .insert(expenseCategories)
        .values({ workspaceId, name: cat.name, isGenerationCost: !!cat.generation })
        .returning({ id: expenseCategories.id });
    }
    for (const child of cat.children ?? []) {
      if (existing.some((c) => c.parentId === parentId && c.name.toLowerCase() === child.toLowerCase())) continue;
      await exec
        .insert(expenseCategories)
        .values({ workspaceId, name: child, parentId, isGenerationCost: !!cat.generation });
    }
  }
}

export type Category = {
  id: string;
  name: string;
  fullName: string;
  parentId: string | null;
  isGenerationCost: boolean;
};

export async function listCategories(exec: Executor, ctx: ServiceContext): Promise<Category[]> {
  const rows = await exec
    .select()
    .from(expenseCategories)
    .where(and(eq(expenseCategories.workspaceId, ctx.workspaceId), isNull(expenseCategories.archivedAt)))
    .orderBy(asc(expenseCategories.name));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      parentId: r.parentId,
      isGenerationCost: r.isGenerationCost,
      fullName: r.parentId ? `${byId.get(r.parentId)?.name ?? "?"} / ${r.name}` : r.name,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export const categoryInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  parentId: z.string().uuid().nullish().or(z.literal("").transform(() => null)),
  isGenerationCost: z.boolean().default(false),
});

export async function createCategory(ctx: ServiceContext, input: z.input<typeof categoryInput>) {
  requireWorkspaceRole(ctx, "admin");
  const data = categoryInput.parse(input);
  return db.transaction(async (tx) => {
    if (data.parentId) {
      const [parent] = await tx
        .select()
        .from(expenseCategories)
        .where(and(eq(expenseCategories.id, data.parentId), eq(expenseCategories.workspaceId, ctx.workspaceId)));
      if (!parent) throw invalid("Parent category not found.");
      if (parent.parentId) throw invalid("Categories can only be nested one level.");
    }
    const [cat] = await tx
      .insert(expenseCategories)
      .values({ workspaceId: ctx.workspaceId, ...data })
      .onConflictDoNothing()
      .returning();
    if (!cat) throw conflict("A category with that name already exists.");
    await recordAudit(tx, ctx, {
      action: "expense.category.created",
      entityType: "expense_category",
      entityId: cat.id,
      after: data,
    });
    return cat;
  });
}

// ---------------------------------------------------------------------------------------------
// Categorization rules

export const ruleInput = z.object({
  matchField: z.enum(["merchant", "description"]).default("description"),
  pattern: z.string().trim().min(2, "Pattern must be at least 2 characters").max(100),
  categoryId: z.string().uuid("Choose a category"),
  priority: z.coerce.number().int().min(0).max(1000).default(100),
});

export type Rule = typeof categorizationRules.$inferSelect;

export async function listRules(exec: Executor, ctx: ServiceContext) {
  return exec
    .select()
    .from(categorizationRules)
    .where(eq(categorizationRules.workspaceId, ctx.workspaceId))
    .orderBy(asc(categorizationRules.priority), asc(categorizationRules.createdAt));
}

/** First matching rule wins (lowest priority number). Merchant rules fall back to description when there's no merchant. */
export function matchRule(rules: Rule[], row: { merchant: string | null; description: string }) {
  for (const r of rules) {
    const haystack = (r.matchField === "merchant" ? (row.merchant ?? row.description) : row.description).toLowerCase();
    if (haystack.includes(r.pattern.toLowerCase())) return r;
  }
  return null;
}

export async function createRule(ctx: ServiceContext, input: z.input<typeof ruleInput>) {
  requireWorkspaceRole(ctx, "member");
  const data = ruleInput.parse(input);
  return db.transaction(async (tx) => {
    await assertCategory(tx, ctx, data.categoryId);
    const [rule] = await tx
      .insert(categorizationRules)
      .values({ ...data, workspaceId: ctx.workspaceId, createdBy: ctx.userId })
      .returning();
    await recordAudit(tx, ctx, {
      action: "expense.rule.created",
      entityType: "categorization_rule",
      entityId: rule.id,
      after: data,
    });
    return rule;
  });
}

export async function deleteRule(ctx: ServiceContext, ruleId: string) {
  requireWorkspaceRole(ctx, "member");
  return db.transaction(async (tx) => {
    const [rule] = await tx
      .delete(categorizationRules)
      .where(and(eq(categorizationRules.id, ruleId), eq(categorizationRules.workspaceId, ctx.workspaceId)))
      .returning();
    if (!rule) throw notFound("Rule not found.");
    await recordAudit(tx, ctx, {
      action: "expense.rule.deleted",
      entityType: "categorization_rule",
      entityId: rule.id,
      before: { matchField: rule.matchField, pattern: rule.pattern, categoryId: rule.categoryId },
    });
  });
}

async function assertCategory(exec: Executor, ctx: ServiceContext, categoryId: string | null | undefined) {
  if (!categoryId) return;
  const [cat] = await exec
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.id, categoryId), eq(expenseCategories.workspaceId, ctx.workspaceId)));
  if (!cat) throw invalid("Category not found.");
}

// ---------------------------------------------------------------------------------------------
// Expenses

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null);

export const expenseInput = z.object({
  date: isoDate,
  amount: z.string().trim().min(1, "Amount is required"),
  currency: z.enum(SUPPORTED_CURRENCIES).default("USD"),
  merchant: optionalText(120),
  description: z.string().trim().min(1, "Description is required").max(300),
  categoryId: z.string().uuid().nullish().or(z.literal("").transform(() => null)),
  projectId: z.string().uuid().nullish().or(z.literal("").transform(() => null)),
  paymentAccount: optionalText(40),
  notes: optionalText(2000),
});
export type ExpenseInput = z.input<typeof expenseInput>;

function toRecord(data: z.output<typeof expenseInput>) {
  const minor = parseAmountMinor(data.amount);
  if (minor === null || minor <= 0) throw invalid("Enter a positive amount, e.g. 29.99");
  return {
    date: data.date,
    amountMinor: minor,
    currency: data.currency,
    merchant: data.merchant,
    description: data.description,
    categoryId: data.categoryId ?? null,
    projectId: data.projectId ?? null,
    paymentAccount: data.paymentAccount,
    notes: data.notes,
  };
}

/** Project expenses need editor on the project; personal expenses (no project) belong to their creator. */
async function assertCanWriteExpense(
  exec: Executor,
  ctx: ServiceContext,
  target: { projectId: string | null; createdBy?: string | null },
) {
  requireWorkspaceRole(ctx, "member");
  if (target.projectId) {
    await requireProjectRole(exec, ctx, target.projectId, "editor");
  } else if (target.createdBy && target.createdBy !== ctx.userId && ctx.workspaceRole !== "owner") {
    throw forbidden("Only the person who added a personal expense can change it.");
  }
}

/** SQL scope for expenses the caller can see. */
export async function expenseVisibility(exec: Executor, ctx: ServiceContext): Promise<SQL> {
  const base = and(eq(expenses.workspaceId, ctx.workspaceId), isNull(expenses.archivedAt))!;
  if (ctx.workspaceRole === "owner") return base;
  const ids = await visibleProjectIds(exec, ctx, { includeArchived: true });
  return and(
    base,
    or(
      ids.length ? inArray(expenses.projectId, ids) : sql`false`,
      and(isNull(expenses.projectId), eq(expenses.createdBy, ctx.userId)),
    ),
  )!;
}

export type ExpenseFilters = {
  /** A project id, or "personal" for unallocated expenses. */
  projectId?: string;
  categoryId?: string;
  /** YYYY-MM */
  month?: string;
  from?: string;
  to?: string;
  q?: string;
  importBatchId?: string;
};

export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end: next };
}

async function filterConditions(exec: Executor, ctx: ServiceContext, f: ExpenseFilters) {
  const conds: SQL[] = [await expenseVisibility(exec, ctx)];
  if (f.projectId === "personal") conds.push(isNull(expenses.projectId));
  else if (f.projectId) conds.push(eq(expenses.projectId, f.projectId));
  if (f.categoryId) {
    // A parent category includes its children.
    conds.push(
      or(
        eq(expenses.categoryId, f.categoryId),
        inArray(
          expenses.categoryId,
          exec.select({ id: expenseCategories.id }).from(expenseCategories).where(eq(expenseCategories.parentId, f.categoryId)),
        ),
      )!,
    );
  }
  if (f.month && /^\d{4}-\d{2}$/.test(f.month)) {
    const { start, end } = monthRange(f.month);
    conds.push(gte(expenses.date, start), lt(expenses.date, end));
  }
  if (f.from) conds.push(gte(expenses.date, f.from));
  if (f.to) conds.push(lt(expenses.date, f.to));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(expenses.description, like), ilike(expenses.merchant, like))!);
  }
  if (f.importBatchId) conds.push(eq(expenses.importBatchId, f.importBatchId));
  return and(...conds)!;
}

export async function listExpenses(exec: Executor, ctx: ServiceContext, f: ExpenseFilters = {}, limit = 500) {
  const where = await filterConditions(exec, ctx, f);
  const rows = await exec
    .select({
      expense: expenses,
      projectName: projects.name,
      createdByName: user.name,
    })
    .from(expenses)
    .leftJoin(projects, eq(projects.id, expenses.projectId))
    .leftJoin(user, eq(user.id, expenses.createdBy))
    .where(where)
    .orderBy(desc(expenses.date), desc(expenses.createdAt))
    .limit(limit);
  const [totals] = await exec
    .select({ count: sql<number>`count(*)::int`, totalMinor: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint` })
    .from(expenses)
    .where(where);
  return { rows, count: totals.count, totalMinor: Number(totals.totalMinor) };
}

export async function getExpense(exec: Executor, ctx: ServiceContext, id: string) {
  const [row] = await exec
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, id), await expenseVisibility(exec, ctx)));
  if (!row) throw notFound("Expense not found.");
  return row;
}

export async function createExpense(ctx: ServiceContext, input: ExpenseInput) {
  const record = toRecord(expenseInput.parse(input));
  return db.transaction(async (tx) => {
    await assertCanWriteExpense(tx, ctx, { projectId: record.projectId });
    await assertCategory(tx, ctx, record.categoryId);
    const [row] = await tx
      .insert(expenses)
      .values({ ...record, workspaceId: ctx.workspaceId, source: ctx.actorType === "agent" ? "agent" : "manual", createdBy: ctx.userId })
      .returning();
    await recordAudit(tx, ctx, {
      action: "expense.created",
      projectId: row.projectId,
      entityType: "expense",
      entityId: row.id,
      after: record,
    });
    return row;
  });
}

export async function updateExpense(ctx: ServiceContext, id: string, input: ExpenseInput) {
  const record = toRecord(expenseInput.parse(input));
  return db.transaction(async (tx) => {
    const existing = await getExpense(tx, ctx, id);
    await assertCanWriteExpense(tx, ctx, existing);
    if (record.projectId !== existing.projectId) await assertCanWriteExpense(tx, ctx, { projectId: record.projectId });
    await assertCategory(tx, ctx, record.categoryId);
    const [row] = await tx.update(expenses).set(record).where(eq(expenses.id, id)).returning();
    const before = Object.fromEntries(Object.keys(record).map((k) => [k, existing[k as keyof typeof existing]]));
    await recordAudit(tx, ctx, {
      action: "expense.updated",
      projectId: row.projectId,
      entityType: "expense",
      entityId: id,
      before,
      after: record,
    });
    return row;
  });
}

export async function archiveExpense(ctx: ServiceContext, id: string) {
  return db.transaction(async (tx) => {
    const existing = await getExpense(tx, ctx, id);
    await assertCanWriteExpense(tx, ctx, existing);
    await tx.update(expenses).set({ archivedAt: new Date() }).where(eq(expenses.id, id));
    await recordAudit(tx, ctx, {
      action: "expense.deleted",
      projectId: existing.projectId,
      entityType: "expense",
      entityId: id,
      before: {
        date: existing.date,
        amountMinor: existing.amountMinor,
        description: existing.description,
        categoryId: existing.categoryId,
      },
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Budgets

export const budgetInput = z.object({
  projectId: z.string().uuid(),
  categoryId: z.string().uuid().nullish().or(z.literal("").transform(() => null)),
  period: z.enum(["month", "quarter", "total"]),
  amount: z.string().trim().min(1, "Amount is required"),
  alertAtPct: z.coerce.number().int().min(1).max(200).default(80),
});

export async function upsertBudget(ctx: ServiceContext, input: z.input<typeof budgetInput>) {
  const data = budgetInput.parse(input);
  const amountMinor = parseAmountMinor(data.amount);
  if (amountMinor === null || amountMinor <= 0) throw invalid("Enter a positive budget amount.");
  return db.transaction(async (tx) => {
    await requireProjectRole(tx, ctx, data.projectId, "lead");
    await assertCategory(tx, ctx, data.categoryId);
    const [existing] = await tx
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.projectId, data.projectId),
          data.categoryId ? eq(budgets.categoryId, data.categoryId) : isNull(budgets.categoryId),
          eq(budgets.period, data.period),
        ),
      );
    const values = { amountMinor, alertAtPct: data.alertAtPct };
    const [row] = existing
      ? await tx.update(budgets).set(values).where(eq(budgets.id, existing.id)).returning()
      : await tx
          .insert(budgets)
          .values({
            workspaceId: ctx.workspaceId,
            projectId: data.projectId,
            categoryId: data.categoryId ?? null,
            period: data.period,
            createdBy: ctx.userId,
            ...values,
          })
          .returning();
    await recordAudit(tx, ctx, {
      action: existing ? "expense.budget.updated" : "expense.budget.created",
      projectId: data.projectId,
      entityType: "budget",
      entityId: row.id,
      before: existing ? { amountMinor: existing.amountMinor, alertAtPct: existing.alertAtPct } : null,
      after: { categoryId: data.categoryId ?? null, period: data.period, ...values },
    });
    return row;
  });
}

export async function deleteBudget(ctx: ServiceContext, budgetId: string) {
  return db.transaction(async (tx) => {
    const [b] = await tx
      .select()
      .from(budgets)
      .where(and(eq(budgets.id, budgetId), eq(budgets.workspaceId, ctx.workspaceId)));
    if (!b) throw notFound("Budget not found.");
    await requireProjectRole(tx, ctx, b.projectId, "lead");
    await tx.delete(budgets).where(eq(budgets.id, budgetId));
    await recordAudit(tx, ctx, {
      action: "expense.budget.deleted",
      projectId: b.projectId,
      entityType: "budget",
      entityId: b.id,
      before: { categoryId: b.categoryId, period: b.period, amountMinor: b.amountMinor },
    });
  });
}

function periodRange(period: BudgetPeriod, month: string) {
  const [y, m] = month.split("-").map(Number);
  if (period === "month") return monthRange(month);
  if (period === "quarter") {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const start = `${y}-${String(qStart).padStart(2, "0")}-01`;
    const endMonth = qStart + 3;
    const end = endMonth > 12 ? `${y + 1}-01-01` : `${y}-${String(endMonth).padStart(2, "0")}-01`;
    return { start, end };
  }
  return { start: "0001-01-01", end: "9999-12-31" };
}

export type BudgetStatus = {
  id: string;
  projectId: string;
  projectName: string;
  categoryId: string | null;
  categoryName: string;
  period: BudgetPeriod;
  amountMinor: number;
  spentMinor: number;
  pct: number;
  alertAtPct: number;
  state: "ok" | "warning" | "over";
  range: { start: string; end: string };
};

/** Budget vs. actual for the period containing `month` (YYYY-MM). */
export async function budgetStatus(
  exec: Executor,
  ctx: ServiceContext,
  opts: { projectId?: string; month: string },
): Promise<BudgetStatus[]> {
  const ids = await visibleProjectIds(exec, ctx);
  const scoped = opts.projectId ? ids.filter((id) => id === opts.projectId) : ids;
  if (!scoped.length) return [];
  const rows = await exec
    .select({ budget: budgets, projectName: projects.name })
    .from(budgets)
    .innerJoin(projects, eq(projects.id, budgets.projectId))
    .where(inArray(budgets.projectId, scoped))
    .orderBy(asc(projects.name), asc(budgets.period));
  const categories = await listCategories(exec, ctx);
  const catName = new Map(categories.map((c) => [c.id, c.fullName]));

  const result: BudgetStatus[] = [];
  for (const { budget: b, projectName } of rows) {
    const range = periodRange(b.period, opts.month);
    const catIds = b.categoryId
      ? [b.categoryId, ...categories.filter((c) => c.parentId === b.categoryId).map((c) => c.id)]
      : null;
    const [{ spent }] = await exec
      .select({ spent: sql<number>`coalesce(sum(${expenses.amountMinor}), 0)::bigint` })
      .from(expenses)
      .where(
        and(
          eq(expenses.projectId, b.projectId),
          isNull(expenses.archivedAt),
          gte(expenses.date, range.start),
          lt(expenses.date, range.end),
          catIds ? inArray(expenses.categoryId, catIds) : undefined,
        ),
      );
    const spentMinor = Number(spent);
    const pct = b.amountMinor ? Math.round((spentMinor / b.amountMinor) * 100) : 0;
    result.push({
      id: b.id,
      projectId: b.projectId,
      projectName,
      categoryId: b.categoryId,
      categoryName: b.categoryId ? (catName.get(b.categoryId) ?? "Unknown") : "All spending",
      period: b.period,
      amountMinor: b.amountMinor,
      spentMinor,
      pct,
      alertAtPct: b.alertAtPct,
      state: pct >= 100 ? "over" : pct >= b.alertAtPct ? "warning" : "ok",
      range,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Reports

export type SpendCell = { month: string; categoryId: string | null; projectId: string | null; totalMinor: number };

export async function spendByMonth(exec: Executor, ctx: ServiceContext, f: ExpenseFilters): Promise<SpendCell[]> {
  const where = await filterConditions(exec, ctx, f);
  const month = sql<string>`to_char(${expenses.date}, 'YYYY-MM')`;
  const rows = await exec
    .select({
      month,
      categoryId: expenses.categoryId,
      projectId: expenses.projectId,
      totalMinor: sql<number>`sum(${expenses.amountMinor})::bigint`,
    })
    .from(expenses)
    .where(where)
    .groupBy(month, expenses.categoryId, expenses.projectId)
    .orderBy(month);
  return rows.map((r) => ({ ...r, totalMinor: Number(r.totalMinor) }));
}

/** Rolls category ids up to their top-level parent for reporting. */
export function rollUpCategory(categories: Category[], categoryId: string | null) {
  if (!categoryId) return { id: "uncategorized", name: "Uncategorized", isGenerationCost: false };
  const cat = categories.find((c) => c.id === categoryId);
  if (!cat) return { id: "uncategorized", name: "Uncategorized", isGenerationCost: false };
  const top = cat.parentId ? (categories.find((c) => c.id === cat.parentId) ?? cat) : cat;
  return { id: top.id, name: top.name, isGenerationCost: cat.isGenerationCost || top.isGenerationCost };
}
