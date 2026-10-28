import Papa from "papaparse";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { recordAudit } from "@/lib/services/audit";
import { listCategories, listExpenses, rollUpCategory, spendByMonth } from "@/lib/services/expenses";
import { listProjects } from "@/lib/services/projects";
import { readFilters } from "@/app/(app)/expenses/data";

const money = (minor: number) => (minor / 100).toFixed(2);

export async function GET(request: Request) {
  const { ctx } = await requireAppContext();
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const filters = readFilters(sp);
  const kind = sp.kind === "report" ? "report" : "expenses";
  const categories = await listCategories(db, ctx);
  const catName = new Map(categories.map((c) => [c.id, c.fullName]));

  let csv: string;
  let rowCount: number;
  if (kind === "report") {
    const projects = await listProjects(db, ctx, { includeArchived: true });
    const projectName = new Map(projects.map((p) => [p.id, p.name]));
    const cells = await spendByMonth(db, ctx, {
      ...filters,
      from: sp.from || undefined,
      to: sp.to || undefined,
    });
    const rows = cells.map((c) => {
      const top = rollUpCategory(categories, c.categoryId);
      return {
        month: c.month,
        project: c.projectId ? (projectName.get(c.projectId) ?? "") : "Personal",
        category: top.name,
        subcategory: c.categoryId ? (catName.get(c.categoryId) ?? "") : "",
        generation_cost: top.isGenerationCost ? "yes" : "no",
        amount_usd: money(c.totalMinor),
      };
    });
    csv = Papa.unparse(rows, { columns: ["month", "project", "category", "subcategory", "generation_cost", "amount_usd"] });
    rowCount = rows.length;
  } else {
    const { rows } = await listExpenses(db, ctx, filters, 50_000);
    const data = rows.map(({ expense: e, projectName, createdByName }) => ({
      date: e.date,
      amount: money(e.amountMinor),
      currency: e.currency,
      merchant: e.merchant ?? "",
      description: e.description,
      category: e.categoryId ? (catName.get(e.categoryId) ?? "") : "",
      project: projectName ?? "Personal",
      payment_account: e.paymentAccount ?? "",
      source: e.source,
      notes: e.notes ?? "",
      added_by: createdByName ?? "",
    }));
    csv = Papa.unparse(data, {
      columns: ["date", "amount", "currency", "merchant", "description", "category", "project", "payment_account", "source", "notes", "added_by"],
    });
    rowCount = data.length;
  }

  await recordAudit(db, ctx, {
    action: "expense.exported",
    projectId: filters.projectId && filters.projectId !== "personal" ? filters.projectId : null,
    entityType: "export",
    after: { kind, filters, rows: rowCount },
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ensemble-${kind}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
