import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { llmCalls } from "@/db/schema/chat";
import { workspaces, type LlmPreference, type WorkspaceSettings } from "@/db/schema/tenancy";
import { planProviders, providerStatus } from "@/lib/llm/providers";
import { recordAudit } from "./audit";
import { requireWorkspaceRole } from "./access";
import { invalid, notFound, type ServiceContext } from "./context";

export function defaultBudgetUsd() {
  const v = Number(process.env.LLM_MONTHLY_BUDGET_USD);
  return Number.isFinite(v) && v >= 0 ? v : 25;
}

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function monthSpendMicros(exec: Executor, workspaceId: string) {
  const [{ total }] = await exec
    .select({ total: sql<number>`coalesce(sum(${llmCalls.costUsdMicros}), 0)::bigint` })
    .from(llmCalls)
    .where(and(eq(llmCalls.workspaceId, workspaceId), gte(llmCalls.createdAt, monthStart())));
  return Number(total);
}

async function loadSettings(exec: Executor, workspaceId: string, opts: { forUpdate?: boolean } = {}) {
  const q = exec.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const [row] = opts.forUpdate ? await q.for("update") : await q;
  if (!row) throw notFound("Workspace not found.");
  return row.settings ?? {};
}

export async function getAiSettings(exec: Executor, ctx: ServiceContext) {
  const settings = await loadSettings(exec, ctx.workspaceId);
  const pref: LlmPreference = settings.llm_provider ?? "auto";
  const budgetUsd = settings.llm_monthly_budget_usd ?? defaultBudgetUsd();
  const spentMicros = await monthSpendMicros(exec, ctx.workspaceId);
  const plan = planProviders(pref);
  return {
    pref,
    budgetUsd,
    spentMicros,
    overBudget: spentMicros >= budgetUsd * 1_000_000,
    plan,
    providers: providerStatus().map(({ id, configured, model }) => ({ id, configured, model })),
    envOverride: process.env.LLM_PROVIDER || null,
  };
}

async function writeSettings(exec: Executor, workspaceId: string, next: WorkspaceSettings) {
  await exec.update(workspaces).set({ settings: next }).where(eq(workspaces.id, workspaceId));
}

export const preferenceInput = z.enum(["auto", "anthropic", "openai", "off"]);

export async function setLlmPreference(ctx: ServiceContext, pref: z.input<typeof preferenceInput>) {
  requireWorkspaceRole(ctx, "owner");
  const value = preferenceInput.parse(pref);
  return db.transaction(async (tx) => {
    const settings = await loadSettings(tx, ctx.workspaceId, { forUpdate: true });
    const before = settings.llm_provider ?? "auto";
    if (before === value) return;
    if (value === "anthropic" || value === "openai") {
      const p = providerStatus().find((s) => s.id === value);
      if (!p?.configured) throw invalid(`${value === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"} isn't set on the server.`);
    }
    await writeSettings(tx, ctx.workspaceId, { ...settings, llm_provider: value });
    await recordAudit(tx, ctx, {
      action: "workspace.llm.provider_changed",
      entityType: "workspace",
      entityId: ctx.workspaceId,
      before: { llmProvider: before },
      after: { llmProvider: value },
    });
  });
}

export const budgetInput = z.coerce.number().min(0, "The budget can't be negative").max(10_000, "That's above the $10,000 cap");

/** Lowering takes effect immediately. Raising goes through the `llm.budget.raise` approval. */
export async function lowerBudget(ctx: ServiceContext, usd: number) {
  requireWorkspaceRole(ctx, "owner");
  const value = budgetInput.parse(usd);
  return db.transaction(async (tx) => {
    const settings = await loadSettings(tx, ctx.workspaceId, { forUpdate: true });
    const before = settings.llm_monthly_budget_usd ?? defaultBudgetUsd();
    if (value > before) throw invalid("Raising the budget needs an approval. Use “Request increase”.");
    if (value === before) return;
    await writeSettings(tx, ctx.workspaceId, { ...settings, llm_monthly_budget_usd: value });
    await recordAudit(tx, ctx, {
      action: "workspace.llm.budget_lowered",
      entityType: "workspace",
      entityId: ctx.workspaceId,
      before: { budgetUsd: before },
      after: { budgetUsd: value },
    });
  });
}

export async function currentBudget(exec: Executor, workspaceId: string) {
  const settings = await loadSettings(exec, workspaceId);
  return settings.llm_monthly_budget_usd ?? defaultBudgetUsd();
}

export async function raiseBudgetTx(tx: Executor, ctx: ServiceContext, usd: number) {
  const value = budgetInput.parse(usd);
  const settings = await loadSettings(tx, ctx.workspaceId, { forUpdate: true });
  const before = settings.llm_monthly_budget_usd ?? defaultBudgetUsd();
  if (value <= before) throw invalid(`The budget is already $${before}.`);
  await writeSettings(tx, ctx.workspaceId, { ...settings, llm_monthly_budget_usd: value });
  await recordAudit(tx, ctx, {
    action: "workspace.llm.budget_raised",
    entityType: "workspace",
    entityId: ctx.workspaceId,
    before: { budgetUsd: before },
    after: { budgetUsd: value },
  });
  return { budgetUsd: value };
}

export type LlmCallLog = {
  workspaceId: string;
  userId: string;
  threadId: string | null;
  provider: string;
  model: string;
  status: "ok" | "error" | "blocked";
  errorCode?: string | null;
  error?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  costUsdMicros?: number;
  latencyMs?: number;
  fallbackFrom?: string | null;
};

export async function logLlmCall(exec: Executor, row: LlmCallLog) {
  await exec.insert(llmCalls).values({ ...row, error: row.error?.slice(0, 500) ?? null });
}

export async function recentLlmCalls(exec: Executor, ctx: ServiceContext, limit = 20) {
  requireWorkspaceRole(ctx, "admin");
  return exec
    .select()
    .from(llmCalls)
    .where(eq(llmCalls.workspaceId, ctx.workspaceId))
    .orderBy(sql`${llmCalls.createdAt} desc`)
    .limit(limit);
}
