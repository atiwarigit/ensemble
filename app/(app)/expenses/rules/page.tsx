import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { hasWorkspaceRole } from "@/lib/services/access";
import { listCategories, listRules } from "@/lib/services/expenses";
import { CategoryForm, DeleteRuleButton, RuleForm } from "./forms";

export const metadata: Metadata = { title: "Rules & categories" };

export default async function RulesPage() {
  const { ctx } = await requireAppContext();
  const [rules, categories] = await Promise.all([listRules(db, ctx), listCategories(db, ctx)]);
  const catName = new Map(categories.map((c) => [c.id, c.fullName]));
  const canWrite = hasWorkspaceRole(ctx.workspaceRole, "member");
  const canManageCategories = hasWorkspaceRole(ctx.workspaceRole, "admin");
  const options = categories.map((c) => ({ id: c.id, name: c.fullName, parentId: c.parentId }));

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Categorization rules</CardTitle>
          <CardDescription>
            Applied to imported rows in priority order (lowest first). The first rule whose text appears in the row wins.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {canWrite && <RuleForm categories={options} />}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Priority</TableHead>
                <TableHead>If</TableHead>
                <TableHead>Contains</TableHead>
                <TableHead>Category</TableHead>
                {canWrite && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => (
                <TableRow key={r.id} data-testid="rule-row">
                  <TableCell className="tabular-nums text-muted-foreground">{r.priority}</TableCell>
                  <TableCell className="capitalize">{r.matchField}</TableCell>
                  <TableCell>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.pattern}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{catName.get(r.categoryId) ?? "—"}</Badge>
                  </TableCell>
                  {canWrite && (
                    <TableCell>
                      <DeleteRuleButton id={r.id} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Categories</CardTitle>
          <CardDescription>Generation-cost categories roll up into the generation spend report.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ul className="grid gap-1 text-sm">
            {categories.map((c) => (
              <li key={c.id} className={c.parentId ? "pl-4 text-muted-foreground" : "font-medium"}>
                {c.name}
                {c.isGenerationCost && !c.parentId && (
                  <Badge variant="outline" className="ml-2">
                    Generation cost
                  </Badge>
                )}
              </li>
            ))}
          </ul>
          {canManageCategories && <CategoryForm parents={options.filter((c) => !c.parentId)} />}
        </CardContent>
      </Card>
    </div>
  );
}
