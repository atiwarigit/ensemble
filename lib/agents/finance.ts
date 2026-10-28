import { z } from "zod";
import { db } from "@/db";
import { formatMoney } from "@/lib/format";
import {
  budgetStatus,
  getExpense,
  listCategories,
  listExpenses,
  rollUpCategory,
  spendByMonth,
  updateExpense,
} from "@/lib/services/expenses";
import { invalid } from "@/lib/services/context";
import { currentMonth, monthLabel, parseMonth } from "./dates";
import { defineTool, type Agent, type ToolContext } from "./types";

const monthArg = z
  .string()
  .optional()
  .describe('Month as YYYY-MM, a month name ("october"), "this month" or "last month". Defaults to this month.');

function resolveMonth(input?: string) {
  if (!input) return currentMonth();
  const m = parseMonth(input);
  if (!m) throw invalid(`I couldn't tell which month "${input}" is. Try a name like "october" or 2026-10.`);
  return m;
}

const scope = (tc: ToolContext) => (tc.projectId ? { projectId: tc.projectId } : {});

const summarizeSpend = defineTool({
  name: "summarizeSpend",
  description:
    "Total spend for a month, broken down by top-level category, plus the generation-cost subtotal (Suno, Kling and other generation tools).",
  risk: "read",
  input: z.object({ month: monthArg }),
  async run(tc, { month }) {
    const m = resolveMonth(month);
    const [cells, categories] = await Promise.all([
      spendByMonth(db, tc.ctx, { ...scope(tc), month: m }),
      listCategories(db, tc.ctx),
    ]);
    const byCat = new Map<string, { name: string; totalMinor: number; generation: boolean }>();
    let total = 0;
    let generation = 0;
    for (const c of cells) {
      const top = rollUpCategory(categories, c.categoryId);
      const row = byCat.get(top.id) ?? { name: top.name, totalMinor: 0, generation: top.isGenerationCost };
      row.totalMinor += c.totalMinor;
      byCat.set(top.id, row);
      total += c.totalMinor;
      if (top.isGenerationCost) generation += c.totalMinor;
    }
    const rows = [...byCat.values()].sort((a, b) => b.totalMinor - a.totalMinor);
    const label = monthLabel(m);
    const summary = total
      ? `${label}: ${formatMoney(total)} spent, of which ${formatMoney(generation)} was generation (AI tools). ` +
        `Top categories: ${rows
          .slice(0, 4)
          .map((r) => `${r.name} ${formatMoney(r.totalMinor)}`)
          .join(", ")}.`
      : `No expenses recorded for ${label}.`;
    return {
      summary,
      data: {
        month: m,
        totalMinor: total,
        generationMinor: generation,
        currency: "USD",
        categories: rows.map((r) => ({ name: r.name, totalMinor: r.totalMinor, isGenerationCost: r.generation })),
      },
      links: [{ href: `/expenses/reports?month=${m}`, label: `${label} report` }],
    };
  },
});

const findExpenses = defineTool({
  name: "listExpenses",
  description: "Lists recent expenses, optionally for one month and/or matching a merchant or description search.",
  risk: "read",
  input: z.object({
    month: monthArg,
    search: z.string().max(80).optional().describe("Text to match in merchant or description"),
    limit: z.number().int().min(1).max(25).optional(),
  }),
  async run(tc, { month, search, limit }) {
    const m = month ? resolveMonth(month) : undefined;
    const { rows, count, totalMinor } = await listExpenses(db, tc.ctx, { ...scope(tc), month: m, q: search }, limit ?? 10);
    const items = rows.map(({ expense: e, projectName }) => ({
      id: e.id,
      date: e.date,
      merchant: e.merchant,
      description: e.description,
      amountMinor: e.amountMinor,
      project: projectName ?? "Personal",
    }));
    const what = [m && monthLabel(m), search && `matching “${search}”`].filter(Boolean).join(" ");
    return {
      summary: count
        ? `${count} expense${count === 1 ? "" : "s"}${what ? ` ${what}` : ""}, totalling ${formatMoney(totalMinor)}. Showing ${items.length}.`
        : `No expenses found${what ? ` ${what}` : ""}.`,
      data: { count, totalMinor, items },
      links: [{ href: `/expenses?${new URLSearchParams({ ...(m ? { month: m } : {}), ...(search ? { q: search } : {}) })}`, label: "Open in Expenses" }],
    };
  },
});

const budgets = defineTool({
  name: "budgetStatus",
  description: "Budget vs. actual for each project budget in the period containing the given month.",
  risk: "read",
  input: z.object({ month: monthArg }),
  async run(tc, { month }) {
    const m = resolveMonth(month);
    const rows = await budgetStatus(db, tc.ctx, { month: m, projectId: tc.projectId ?? undefined });
    if (!rows.length) return { summary: "No budgets are set up for the projects in scope.", data: { budgets: [] } };
    const flagged = rows.filter((r) => r.state !== "ok");
    return {
      summary:
        `${rows.length} budget${rows.length === 1 ? "" : "s"} checked for ${monthLabel(m)}. ` +
        (flagged.length
          ? flagged.map((r) => `${r.projectName} · ${r.categoryName} is at ${r.pct}% (${r.state === "over" ? "over" : "warning"})`).join("; ") + "."
          : "All are within their alert thresholds."),
      data: {
        budgets: rows.map((r) => ({
          project: r.projectName,
          category: r.categoryName,
          period: r.period,
          amountMinor: r.amountMinor,
          spentMinor: r.spentMinor,
          pct: r.pct,
          state: r.state,
        })),
      },
    };
  },
});

const categorize = defineTool({
  name: "categorizeExpense",
  description: "Sets the category of one expense (by id from listExpenses). Category is matched by name, e.g. “Marketing” or “Generation/Suno”.",
  risk: "write",
  input: z.object({ expenseId: z.string().uuid(), category: z.string().min(1).max(80) }),
  async run(tc, { expenseId, category }) {
    const e = await getExpense(db, tc.ctx, expenseId);
    // Plan §3.5: agents never write to someone else's personal expenses.
    if (!e.projectId && e.createdBy !== tc.ctx.userId) {
      throw invalid("That's another person's personal expense, so the assistant can't change it.");
    }
    const categories = await listCategories(db, tc.ctx);
    const needle = category.trim().toLowerCase();
    const cat =
      categories.find((c) => c.fullName.toLowerCase() === needle) ??
      categories.find((c) => c.name.toLowerCase() === needle);
    if (!cat) throw invalid(`There's no category called “${category}”.`);
    await updateExpense(tc.ctx, e.id, {
      date: e.date,
      amount: (e.amountMinor / 100).toFixed(2),
      currency: e.currency as "USD",
      merchant: e.merchant,
      description: e.description,
      categoryId: cat.id,
      projectId: e.projectId,
      paymentAccount: e.paymentAccount,
      notes: e.notes,
    });
    return { summary: `Set “${e.description}” (${formatMoney(e.amountMinor)}) to ${cat.fullName}.`, data: { expenseId, categoryId: cat.id } };
  },
});

export const financeAgent: Agent = {
  id: "finance",
  label: "Finance",
  description: "Expenses, categories, budgets and monthly spend reports (including AI generation costs).",
  tools: [summarizeSpend, findExpenses, budgets, categorize],
};
