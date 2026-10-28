import Link from "next/link";
import { BudgetList } from "@/components/budget-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { formatMoney, formatMonth } from "@/lib/format";
import { budgetStatus, listExpenses } from "@/lib/services/expenses";
import { getProject, listAddableMembers, listProjectMembers } from "@/lib/services/projects";
import { MembersPanel } from "./members-panel";

export default async function ProjectOverviewPage(props: PageProps<"/projects/[projectId]">) {
  const { projectId } = await props.params;
  const { ctx } = await requireAppContext();
  const { project, role } = await orNotFound(getProject(db, ctx, projectId));
  const canManage = role === "lead";
  const month = new Date().toISOString().slice(0, 7);
  const [members, addable, spend, budgets] = await Promise.all([
    listProjectMembers(db, ctx, projectId),
    canManage ? listAddableMembers(db, ctx, projectId) : Promise.resolve([]),
    listExpenses(db, ctx, { projectId, month }, 1),
    budgetStatus(db, ctx, { projectId, month }),
  ]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>Only these people and workspace owners can see this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <MembersPanel
            projectId={projectId}
            members={members.map((m) => ({ ...m, addedAt: m.addedAt.toISOString() }))}
            addable={addable}
            canManage={canManage}
            currentUserId={ctx.userId}
          />
        </CardContent>
      </Card>
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Spend in {formatMonth(month)}</CardTitle>
            <CardDescription>
              {spend.count} expense{spend.count === 1 ? "" : "s"} ·{" "}
              <Link href={`/expenses?project=${projectId}`} className="underline underline-offset-4">
                View all
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-2xl font-semibold tabular-nums">{formatMoney(spend.totalMinor)}</p>
            {budgets.length > 0 && <BudgetList budgets={budgets} showProject={false} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{project.description || "No description yet."}</CardContent>
        </Card>
      </div>
    </div>
  );
}
