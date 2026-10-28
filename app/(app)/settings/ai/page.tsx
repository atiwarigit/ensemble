import { CheckCircle2, XCircle } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/llm/providers";
import { hasWorkspaceRole } from "@/lib/services/access";
import { getAiSettings, recentLlmCalls } from "@/lib/services/ai-settings";
import { AssistantStatus } from "../../chat/assistant-status";
import { BudgetForm, PreferenceForm } from "./ai-settings-form";

export const metadata: Metadata = { title: "AI assistant" };

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000_000 ? 4 : 2)}`;

export default async function AiSettingsPage() {
  const { ctx } = await requireAppContext();
  const ai = await getAiSettings(db, ctx);
  const isAdmin = hasWorkspaceRole(ctx.workspaceRole, "admin");
  const calls = isAdmin ? await recentLlmCalls(db, ctx) : [];
  const pct = ai.budgetUsd ? Math.min(100, Math.round((ai.spentMicros / (ai.budgetUsd * 1_000_000)) * 100)) : 100;
  const configured = Object.fromEntries(ai.providers.map((p) => [p.id, p.configured])) as { anthropic: boolean; openai: boolean };

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Anthropic and OpenAI are both optional. Without a key, chat answers with deterministic commands."
      />
      <AssistantStatus plan={ai.plan} overBudget={ai.overBudget} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Providers</CardTitle>
            <CardDescription>
              Keys are server environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY); they&apos;re never stored in the database.
              {ai.envOverride && (
                <>
                  {" "}
                  <strong>LLM_PROVIDER={ai.envOverride}</strong> is set and overrides the choice below.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Role</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ai.providers.map((p) => {
                  const idx = ai.plan.order.findIndex((o) => o.id === p.id);
                  return (
                    <TableRow key={p.id} data-testid={`provider-${p.id}`}>
                      <TableCell className="font-medium">{PROVIDER_LABEL[p.id]}</TableCell>
                      <TableCell>
                        {p.configured ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="size-4" /> Set
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <XCircle className="size-4" /> Not set
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{p.model}</TableCell>
                      <TableCell>
                        {idx === 0 ? <Badge>Primary</Badge> : idx === 1 ? <Badge variant="secondary">Fallback</Badge> : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {ctx.workspaceRole === "owner" ? (
              <PreferenceForm pref={ai.pref} configured={configured} />
            ) : (
              <p className="text-sm text-muted-foreground">Only workspace owners can change the provider.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Monthly budget</CardTitle>
            <CardDescription>
              Costs are estimated from token counts. When the budget is used up, chat answers with commands until next month.
              Raising it needs an owner&apos;s approval; lowering it is immediate.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-1.5" data-testid="llm-budget">
              <div className="flex justify-between text-sm">
                <span>
                  {usd(ai.spentMicros)} of ${ai.budgetUsd} this month
                </span>
                <span className="text-muted-foreground">{pct}%</span>
              </div>
              <Progress value={pct} />
            </div>
            {isAdmin && <BudgetForm budgetUsd={ai.budgetUsd} canLower={ctx.workspaceRole === "owner"} />}
          </CardContent>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle>Recent model calls</CardTitle>
              <CardDescription>Every call is logged with provider, model, tokens and estimated cost.</CardDescription>
            </CardHeader>
            <CardContent>
              {calls.length === 0 ? (
                <p className="text-sm text-muted-foreground">No model calls yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tokens in / out</TableHead>
                      <TableHead className="text-right">Est. cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map((c) => (
                      <TableRow key={c.id} data-testid="llm-call">
                        <TableCell className="text-xs whitespace-nowrap">{formatDateTime(c.createdAt)}</TableCell>
                        <TableCell>
                          {PROVIDER_LABEL[c.provider as "openai"] ?? c.provider}
                          {c.fallbackFrom && <span className="text-xs text-muted-foreground"> (fallback)</span>}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.model}</TableCell>
                        <TableCell>
                          <Badge variant={c.status === "ok" ? "secondary" : "destructive"}>
                            {c.status}
                            {c.errorCode ? ` · ${c.errorCode}` : ""}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {c.tokensIn} / {c.tokensOut}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">{usd(c.costUsdMicros)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
