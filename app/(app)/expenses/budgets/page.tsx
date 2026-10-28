import type { Metadata } from "next";
import { BudgetList } from "@/components/budget-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatMonth } from "@/lib/format";
import { budgetStatus } from "@/lib/services/expenses";
import { listProjects } from "@/lib/services/projects";
import { currentMonth, expenseOptions } from "../data";
import { BudgetForm, DeleteBudgetButton } from "./budget-form";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const { ctx } = await requireAppContext();
  const month = currentMonth();
  const [budgets, projects, options] = await Promise.all([
    budgetStatus(db, ctx, { month }),
    listProjects(db, ctx),
    expenseOptions(ctx),
  ]);
  const leadProjects = projects
    .filter((p) => ctx.workspaceRole === "owner" || p.myRole === "lead")
    .map((p) => ({ id: p.id, name: p.name }));
  const canManage = new Set(leadProjects.map((p) => p.id));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Budgets</CardTitle>
          <CardDescription>Spending so far in {formatMonth(month)} (or this quarter / all time, by budget).</CardDescription>
        </CardHeader>
        <CardContent>
          <BudgetList
            budgets={budgets}
            actions={(b) => (canManage.has(b.projectId) ? <DeleteBudgetButton id={b.id} /> : null)}
          />
        </CardContent>
      </Card>
      {leadProjects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Set a budget</CardTitle>
            <CardDescription>Project leads set budgets. Saving the same project, category, and period updates it.</CardDescription>
          </CardHeader>
          <CardContent>
            <BudgetForm projects={leadProjects} categories={options.categories.filter((c) => !c.parentId)} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
