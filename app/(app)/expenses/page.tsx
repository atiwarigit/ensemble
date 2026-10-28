import { Download, Upload } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDate, formatMoney } from "@/lib/format";
import { listExpenses } from "@/lib/services/expenses";
import { expenseOptions, readFilters } from "./data";
import { DeleteExpenseButton } from "./delete-expense-button";
import { ExpenseDialog } from "./expense-dialog";
import { ExpenseFilters } from "./filters";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage(props: PageProps<"/expenses">) {
  const { ctx } = await requireAppContext();
  const sp = await props.searchParams;
  const filters = readFilters(sp);
  const [{ rows, count, totalMinor }, options] = await Promise.all([listExpenses(db, ctx, filters), expenseOptions(ctx)]);
  const catName = new Map(options.categories.map((c) => [c.id, c.name]));
  const exportParams = new URLSearchParams(
    Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  );
  const canWrite = ctx.workspaceRole !== "viewer";

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <ExpenseFilters projects={options.projects} categories={options.categories} />
        <div className="mb-4 flex gap-2">
          <Button variant="outline" asChild>
            <a href={`/api/expenses/export?${exportParams}`}>
              <Download /> Export CSV
            </a>
          </Button>
          {canWrite && (
            <>
              <Button variant="outline" asChild>
                <Link href="/expenses/import">
                  <Upload /> Import CSV
                </Link>
              </Button>
              <ExpenseDialog
                projects={options.projects}
                categories={options.categories}
                defaultProjectId={filters.projectId !== "personal" ? filters.projectId : undefined}
              />
            </>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          No expenses match these filters. Add one, or import a bank CSV.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                {canWrite && <TableHead className="w-20" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ expense: e, projectName }) => (
                <TableRow key={e.id} data-testid="expense-row">
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(e.date)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{e.merchant ?? e.description}</div>
                    {e.merchant && <div className="text-xs text-muted-foreground">{e.description}</div>}
                    {e.paymentAccount && <div className="text-xs text-muted-foreground">{e.paymentAccount}</div>}
                  </TableCell>
                  <TableCell>
                    {e.categoryId ? (
                      <Badge variant="secondary">{catName.get(e.categoryId) ?? "—"}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        Uncategorized
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{projectName ?? <span className="text-muted-foreground">Personal</span>}</TableCell>
                  <TableCell>
                    {e.importBatchId ? (
                      <Link href={`/expenses/import/${e.importBatchId}`} className="text-xs text-muted-foreground hover:underline">
                        CSV
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground capitalize">{e.source}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(e.amountMinor, e.currency)}</TableCell>
                  {canWrite && (
                    <TableCell>
                      <div className="flex justify-end">
                        <ExpenseDialog
                          projects={options.projects}
                          categories={options.categories}
                          expense={{
                            id: e.id,
                            date: e.date,
                            amount: (e.amountMinor / 100).toFixed(2),
                            merchant: e.merchant,
                            description: e.description,
                            categoryId: e.categoryId,
                            projectId: e.projectId,
                            paymentAccount: e.paymentAccount,
                            notes: e.notes,
                          }}
                        />
                        <DeleteExpenseButton id={e.id} description={e.description} />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={5}>
                  {count} expense{count === 1 ? "" : "s"}
                  {count > rows.length && ` (showing ${rows.length})`}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums" data-testid="expense-total">
                  {formatMoney(totalMinor)}
                </TableCell>
                {canWrite && <TableCell />}
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </>
  );
}
