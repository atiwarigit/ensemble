import { Download, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { BudgetList } from "@/components/budget-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatMoney, formatMonth } from "@/lib/format";
import { budgetStatus, listCategories, rollUpCategory, spendByMonth } from "@/lib/services/expenses";
import { currentMonth, expenseOptions } from "../data";
import { ExpenseFilters } from "../filters";
import { SpendChart } from "./spend-chart";

export const metadata: Metadata = { title: "Expense reports" };

function lastMonths(endMonth: string, n: number) {
  const [y, m] = endMonth.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export default async function ReportsPage(props: PageProps<"/expenses/reports">) {
  const { ctx } = await requireAppContext();
  const sp = await props.searchParams;
  const projectId = typeof sp.project === "string" && sp.project ? sp.project : undefined;
  const endMonth = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth();
  const months = lastMonths(endMonth, 6);
  const from = `${months[0]}-01`;
  const [ey, em] = endMonth.split("-").map(Number);
  const to = em === 12 ? `${ey + 1}-01-01` : `${ey}-${String(em + 1).padStart(2, "0")}-01`;

  const [cells, categories, budgets, options] = await Promise.all([
    spendByMonth(db, ctx, { projectId, from, to }),
    listCategories(db, ctx),
    budgetStatus(db, ctx, { projectId: projectId !== "personal" ? projectId : undefined, month: endMonth }),
    expenseOptions(ctx),
  ]);

  const byCategory = new Map<string, { name: string; isGenerationCost: boolean; months: Map<string, number>; total: number }>();
  for (const c of cells) {
    const top = rollUpCategory(categories, c.categoryId);
    const entry = byCategory.get(top.id) ?? { name: top.name, isGenerationCost: top.isGenerationCost, months: new Map(), total: 0 };
    entry.months.set(c.month, (entry.months.get(c.month) ?? 0) + c.totalMinor);
    entry.total += c.totalMinor;
    byCategory.set(top.id, entry);
  }
  const series = [...byCategory.entries()].sort((a, b) => b[1].total - a[1].total);
  const chartSeries = series.map(([id, s], i) => ({ key: `c${i}`, id, label: s.name }));
  const chartData = months.map((m) => ({
    label: formatMonth(m),
    ...Object.fromEntries(chartSeries.map((s) => [s.key, (byCategory.get(s.id)!.months.get(m) ?? 0) / 100])),
  }));
  const monthTotals = months.map((m) => series.reduce((sum, [, s]) => sum + (s.months.get(m) ?? 0), 0));
  const grandTotal = monthTotals.reduce((a, b) => a + b, 0);

  const generation = new Map<string, number>();
  for (const c of cells) {
    const cat = categories.find((x) => x.id === c.categoryId);
    if (!cat?.isGenerationCost) continue;
    generation.set(cat.fullName, (generation.get(cat.fullName) ?? 0) + c.totalMinor);
  }
  const generationTotal = [...generation.values()].reduce((a, b) => a + b, 0);

  const exportParams = new URLSearchParams({ kind: "report", from, to, ...(projectId ? { project: projectId } : {}) });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ExpenseFilters projects={options.projects} showSearch={false} showCategory={false} defaultMonth={endMonth} />
        <Button variant="outline" asChild>
          <a href={`/api/expenses/export?${exportParams}`}>
            <Download /> Export report CSV
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly spend by category</CardTitle>
          <CardDescription>
            {formatMonth(months[0])} – {formatMonth(endMonth)} · {formatMoney(grandTotal)} total
          </CardDescription>
        </CardHeader>
        <CardContent>
          {series.length ? (
            <SpendChart data={chartData} series={chartSeries} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No spending in this period.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Budget vs. actual</CardTitle>
            <CardDescription>For the period containing {formatMonth(endMonth)}.</CardDescription>
          </CardHeader>
          <CardContent>
            <BudgetList budgets={budgets} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Generation costs
            </CardTitle>
            <CardDescription>AI generation tools (Suno, Kling…) over the same six months.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-2xl font-semibold tabular-nums" data-testid="generation-total">
              {formatMoney(generationTotal)}
            </p>
            <ul className="grid gap-1 text-sm">
              {[...generation.entries()].map(([name, total]) => (
                <li key={name} className="flex justify-between">
                  <span className="text-muted-foreground">{name}</span>
                  <span className="tabular-nums">{formatMoney(total)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By category and month</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                {months.map((m) => (
                  <TableHead key={m} className="text-right">
                    {formatMonth(m)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {series.map(([id, s]) => (
                <TableRow key={id} data-testid="report-category">
                  <TableCell className="font-medium">{s.name}</TableCell>
                  {months.map((m) => (
                    <TableCell key={m} className="text-right tabular-nums">
                      {s.months.get(m) ? formatMoney(s.months.get(m)!) : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(s.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>Total</TableCell>
                {monthTotals.map((t, i) => (
                  <TableCell key={months[i]} className="text-right tabular-nums">
                    {formatMoney(t)}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{formatMoney(grandTotal)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
