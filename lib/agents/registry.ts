import { createHash } from "node:crypto";
import { db } from "@/db";
import { errorMessage } from "@/lib/errors";
import { recordAudit } from "@/lib/services/audit";
import { analyticsAgent } from "./analytics";
import { financeAgent } from "./finance";
import { lyricsAgent } from "./lyrics";
import { qualifiedName, type Agent, type AgentId, type AgentTool, type ToolContext, type ToolResult } from "./types";

export const AGENTS: Agent[] = [financeAgent, lyricsAgent, analyticsAgent];

export type ResolvedTool = { agent: Agent; tool: AgentTool<never>; name: string };

export function allTools(opts: { mode: "llm" | "commands" }): ResolvedTool[] {
  return AGENTS.flatMap((agent) =>
    agent.tools
      .filter((t) => opts.mode === "llm" || !t.llmOnly)
      .map((tool) => ({ agent, tool, name: qualifiedName(agent.id, tool.name) })),
  );
}

export function resolveTool(name: string): ResolvedTool | null {
  return allTools({ mode: "llm" }).find((t) => t.name === name) ?? null;
}

export type ToolRun = { ok: true; result: ToolResult } | { ok: false; error: string };

/** Long free text (e.g. a suggested lyric) is logged by hash, not verbatim. */
function auditableInput(input: unknown) {
  if (!input || typeof input !== "object") return input;
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([k, v]) =>
      typeof v === "string" && v.length > 200
        ? [k, { sha256: createHash("sha256").update(v).digest("hex"), length: v.length }]
        : [k, v],
    ),
  );
}

/**
 * Validates and runs one tool as the given agent, and records the step in the audit log.
 * Errors come back as `{ ok: false }` so the model (or the command router) can explain them.
 */
export async function runTool(tc: ToolContext, resolved: ResolvedTool, rawInput: unknown): Promise<ToolRun> {
  const { agent, tool, name } = resolved;
  const ctx = { ...tc.ctx, agentId: agent.id as AgentId };
  const started = Date.now();
  let run: ToolRun;
  try {
    const input = tool.input.parse(rawInput ?? {});
    run = { ok: true, result: await tool.run({ ...tc, ctx }, input) };
  } catch (err) {
    run = { ok: false, error: errorMessage(err) };
  }
  await recordAudit(db, ctx, {
    action: "agent.tool.called",
    projectId: tc.projectId,
    entityType: "chat_thread",
    entityId: tc.threadId,
    after: {
      agent: agent.id,
      tool: name,
      risk: tool.risk,
      mode: tc.mode,
      provider: tc.llm?.provider ?? null,
      model: tc.llm?.model ?? null,
      input: auditableInput(rawInput),
      ok: run.ok,
      ...(run.ok ? { summary: run.result.summary, approvalId: run.result.approvalId ?? null } : { error: run.error }),
      ms: Date.now() - started,
    },
  });
  return run;
}
