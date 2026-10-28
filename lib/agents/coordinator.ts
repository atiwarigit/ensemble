import {
  createUIMessageStream,
  generateId,
  isStepCount,
  streamText,
  tool,
  toUIMessageStream,
  type ModelMessage,
  type ToolSet,
  type InferUIMessageChunk,
} from "ai";
import { db } from "@/db";
import {
  estimateCostMicros,
  isRetryableProviderError,
  languageModel,
  PROVIDER_LABEL,
  providerErrorCode,
  type ProviderStatus,
} from "@/lib/llm/providers";
import { getAiSettings, logLlmCall } from "@/lib/services/ai-settings";
import { recordAudit } from "@/lib/services/audit";
import { appendProjectContext, getProjectContext, saveMessage } from "@/lib/services/chat";
import type { ServiceContext } from "@/lib/services/context";
import { listWorks } from "@/lib/services/lyrics";
import { type ChatMetadata, type ChatUIMessage, type ToolOutput } from "./chat-types";
import { COMMAND_HELP, planCommand } from "./commands";
import { allTools, resolveTool, runTool, type ResolvedTool, type ToolRun } from "./registry";
import type { ToolContext } from "./types";

const MAX_STEPS = 6;
const HISTORY_MESSAGES = 12;

type Chunk = InferUIMessageChunk<ChatUIMessage>;
type Writer = { write: (chunk: Chunk) => void };

export type TurnInput = {
  ctx: ServiceContext;
  userName: string;
  workspaceName: string;
  thread: { id: string; projectId: string | null; projectName: string | null };
  history: ChatUIMessage[];
  message: ChatUIMessage;
};

export const textOf = (m: Pick<ChatUIMessage, "parts">) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n")
    .trim();

/** Prior turns go to the model as plain text plus a digest of tool results, so history works across providers. */
function historyMessages(history: ChatUIMessage[]): ModelMessage[] {
  const out: ModelMessage[] = [];
  for (const m of history.slice(-HISTORY_MESSAGES)) {
    let content = textOf(m);
    if (m.role === "assistant") {
      const digest = m.parts
        .filter((p) => p.type.startsWith("tool-") && "output" in p)
        .map((p) => (p as { output?: ToolOutput }).output?.summary)
        .filter(Boolean);
      if (digest.length) content += `\n[Tool results: ${digest.join(" | ")}]`;
    }
    if (content) out.push({ role: m.role === "user" ? "user" : "assistant", content });
  }
  return out;
}

function instructions(input: TurnInput, projectContext: string | null) {
  const scope = input.thread.projectName ? `the project “${input.thread.projectName}”` : "all projects the user can see";
  return [
    `You are the coordinator ("Conductor") for Ensemble, the private workspace of ${input.workspaceName}.`,
    `You're helping ${input.userName}. Today is ${new Date().toISOString().slice(0, 10)} (UTC). Scope: ${scope}.`,
    "Specialist agents are exposed as tools: finance_* (expenses, budgets, generation costs) and lyrics_* (lyric works, version history, rights packages).",
    "Decide which agents a request needs. If it spans domains, call tools from each one, then give a single combined answer.",
    "Rules:",
    "- Only state figures and facts that come from tool results. Amounts are USD. Don't guess.",
    "- requestFinalization only files an approval request; say it is pending approval, never that it's done.",
    "- Never write lyrics into a work. You may propose an edit with lyrics_proposeLyricEdit only after lyrics_readLyricText returns the text; if the text is private, say so.",
    "- Be brief. Use short bullet points, one per agent's findings, and include links the tools return as markdown links.",
    projectContext ? `Recent activity in this project:\n${projectContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function writeText(writer: Writer, text: string) {
  const id = generateId();
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

const toolOutput = (run: ToolRun): ToolOutput =>
  run.ok
    ? { summary: run.result.summary, data: run.result.data, links: run.result.links, approvalId: run.result.approvalId }
    : { error: run.error };

type TurnState = {
  agents: Set<string>;
  summaries: string[];
  toolCalls: number;
};

function track(state: TurnState, resolved: ResolvedTool, run: ToolRun) {
  state.agents.add(resolved.agent.id);
  state.toolCalls++;
  if (run.ok) state.summaries.push(`${resolved.agent.label}: ${run.result.summary}`);
}

// ---------------------------------------------------------------------------------------------
// Command mode

async function runCommands(writer: Writer, input: TurnInput, tc: ToolContext, state: TurnState, text: string) {
  const plan = planCommand(text);
  if (plan.kind === "help" || plan.kind === "unknown") {
    writeText(
      writer,
      (plan.kind === "unknown" ? "I couldn't match that to a command. " : "") +
        "Here's what I can do without an AI model:\n\n" +
        COMMAND_HELP.map((c) => `- \`${c.usage}\` — ${c.description}`).join("\n"),
    );
    return;
  }
  if (plan.kind === "form") {
    const options =
      plan.field.options === "works"
        ? (await listWorks(db, tc.ctx, input.thread.projectId ? { projectId: input.thread.projectId } : {})).map((w) => w.title)
        : null;
    writer.write({ type: "data-form", data: { prompt: plan.prompt, command: plan.command, field: plan.field, options } });
    writeText(writer, plan.prompt);
    return;
  }
  const lines: string[] = [];
  for (const call of plan.calls) {
    const resolved = resolveTool(call.tool);
    if (!resolved) continue;
    const toolCallId = generateId();
    writer.write({ type: "tool-input-available", toolCallId, toolName: resolved.name, input: call.input });
    const run = await runTool(tc, resolved, call.input);
    track(state, resolved, run);
    if (run.ok) writer.write({ type: "tool-output-available", toolCallId, output: toolOutput(run) });
    else writer.write({ type: "tool-output-error", toolCallId, errorText: run.error });
    lines.push(run.ok ? `**${resolved.agent.label}:** ${run.result.summary}` : `**${resolved.agent.label}:** ${run.error}`);
  }
  writeText(writer, lines.join("\n\n"));
}

// ---------------------------------------------------------------------------------------------
// LLM mode

type Attempt =
  | { status: "ok"; tokensIn: number; tokensOut: number; costMicros: number }
  | { status: "failed-early"; error: unknown }
  | { status: "failed-late"; error: unknown };

function buildTools(tc: ToolContext, state: TurnState): ToolSet {
  const tools: ToolSet = {};
  for (const resolved of allTools({ mode: "llm" })) {
    tools[resolved.name] = tool({
      description: `[${resolved.agent.label} agent${resolved.tool.risk === "gated" ? ", needs approval" : ""}] ${resolved.tool.description}`,
      inputSchema: resolved.tool.input as never,
      execute: async (args: unknown) => {
        const run = await runTool(tc, resolved, args);
        track(state, resolved, run);
        return toolOutput(run);
      },
    });
  }
  return tools;
}

const CONTENT_CHUNKS = new Set(["text-start", "text-delta", "tool-input-start", "tool-input-available", "reasoning-start"]);

async function attemptLlm(
  writer: Writer,
  input: TurnInput,
  tcBase: ToolContext,
  state: TurnState,
  provider: ProviderStatus,
  projectContext: string | null,
  fallbackFrom: string | null,
): Promise<Attempt> {
  const tc: ToolContext = { ...tcBase, mode: "llm", llm: { provider: provider.id, model: provider.model } };
  const started = Date.now();
  let streamError: unknown = null;
  const result = streamText({
    model: languageModel(provider),
    instructions: instructions(input, projectContext),
    messages: [...historyMessages(input.history), { role: "user", content: textOf(input.message) }],
    tools: buildTools(tc, state),
    stopWhen: isStepCount(MAX_STEPS),
    maxRetries: 0,
    onError: ({ error }) => {
      streamError = error;
    },
  });
  const ui = toUIMessageStream({
    stream: result.stream,
    sendStart: false,
    sendFinish: false,
    onError: () => "The AI provider returned an error.",
  });

  const pending: Chunk[] = [];
  let emitted = false;
  let failed = false;
  const reader = ui.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Chunk;
    if (chunk.type === "error") {
      failed = true;
      if (!emitted) {
        await reader.cancel().catch(() => {});
        break;
      }
      writeText(writer, "\n\n_The AI provider stopped responding partway through, so this answer may be incomplete._");
      continue;
    }
    if (!emitted) {
      if (!CONTENT_CHUNKS.has(chunk.type)) {
        pending.push(chunk);
        continue;
      }
      emitted = true;
      pending.splice(0).forEach((c) => writer.write(c));
    }
    writer.write(chunk);
  }

  const usage = failed ? null : await Promise.resolve(result.usage).catch(() => null);
  const tokensIn = usage?.inputTokens ?? 0;
  const tokensOut = usage?.outputTokens ?? 0;
  const costMicros = estimateCostMicros(provider.model, tokensIn, tokensOut);
  await logLlmCall(db, {
    workspaceId: input.ctx.workspaceId,
    userId: input.ctx.userId,
    threadId: input.thread.id,
    provider: provider.id,
    model: provider.model,
    status: failed ? "error" : "ok",
    errorCode: failed ? providerErrorCode(streamError) : null,
    error: failed ? String((streamError as Error | null)?.message ?? streamError) : null,
    tokensIn,
    tokensOut,
    costUsdMicros: costMicros,
    latencyMs: Date.now() - started,
    fallbackFrom,
  });
  if (!failed) return { status: "ok", tokensIn, tokensOut, costMicros };
  return emitted ? { status: "failed-late", error: streamError } : { status: "failed-early", error: streamError };
}

// ---------------------------------------------------------------------------------------------

/** Runs one chat turn and returns the UI message stream. The user message must already be saved. */
export async function runChatTurn(input: TurnInput) {
  const agentCtx: ServiceContext = { ...input.ctx, actorType: "agent", onBehalfOfUserId: input.ctx.userId };
  const tc: ToolContext = { ctx: agentCtx, projectId: input.thread.projectId, threadId: input.thread.id, mode: "commands", llm: null };
  const state: TurnState = { agents: new Set(), summaries: [], toolCalls: 0 };
  const text = textOf(input.message);
  const meta: ChatMetadata = { mode: "commands", provider: null, model: null, notice: null, createdAt: Date.now() };
  let tokensIn = 0;
  let tokensOut = 0;
  let cost = 0;
  let fallbackFrom: string | null = null;

  const stream = createUIMessageStream<ChatUIMessage>({
    originalMessages: [...input.history, input.message],
    generateId: () => `msg_${generateId()}`,
    onError: () => "Something went wrong answering that.",
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId: `msg_${generateId()}`, messageMetadata: meta });
      const settings = await getAiSettings(db, input.ctx);
      let order = text.startsWith("/") ? [] : settings.plan.order;
      if (order.length && settings.overBudget) {
        meta.notice = `This month's AI budget ($${settings.budgetUsd}) is used up, so I answered with commands. An owner can raise it in Settings → AI assistant.`;
        await logLlmCall(db, {
          workspaceId: input.ctx.workspaceId,
          userId: input.ctx.userId,
          threadId: input.thread.id,
          provider: order[0].id,
          model: order[0].model,
          status: "blocked",
          errorCode: "budget",
        });
        order = [];
      }
      const projectContext = order.length ? await getProjectContext(db, input.thread.projectId) : null;

      let answered = false;
      for (let i = 0; i < order.length && !answered; i++) {
        const p = order[i];
        const attempt = await attemptLlm(writer, input, tc, state, p, projectContext, fallbackFrom);
        if (attempt.status === "ok") {
          answered = true;
          Object.assign(meta, { mode: "llm", provider: p.id, model: p.model });
          tokensIn = attempt.tokensIn;
          tokensOut = attempt.tokensOut;
          cost = attempt.costMicros;
          if (fallbackFrom) {
            meta.notice = `${PROVIDER_LABEL[fallbackFrom as "anthropic"]} was unavailable, so ${PROVIDER_LABEL[p.id]} answered.`;
          }
          break;
        }
        if (attempt.status === "failed-late") {
          answered = true;
          Object.assign(meta, { mode: "llm", provider: p.id, model: p.model });
          break;
        }
        const code = providerErrorCode(attempt.error);
        if (!isRetryableProviderError(attempt.error) || i === order.length - 1) {
          meta.notice = `${PROVIDER_LABEL[p.id]} returned an error (${code}), so I answered with commands instead.`;
          break;
        }
        fallbackFrom = p.id;
      }

      if (!answered) await runCommands(writer, input, tc, state, text);
      meta.agents = [...state.agents];
      meta.costUsdMicros = cost;
      writer.write({ type: "finish", messageMetadata: meta });
    },
    onEnd: async ({ responseMessage }) => {
      await saveMessage(db, {
        id: responseMessage.id,
        threadId: input.thread.id,
        role: "assistant",
        parts: responseMessage.parts,
        mode: meta.mode,
        provider: meta.provider,
        model: meta.model,
        tokensIn,
        tokensOut,
        costUsdMicros: cost,
        agents: meta.agents ?? [],
        notice: meta.notice,
      });
      await recordAudit(db, { ...agentCtx, agentId: "coordinator" }, {
        action: "agent.coordinator.turn",
        projectId: input.thread.projectId,
        entityType: "chat_thread",
        entityId: input.thread.id,
        after: {
          mode: meta.mode,
          provider: meta.provider,
          model: meta.model,
          fallbackFrom,
          agents: meta.agents,
          toolCalls: state.toolCalls,
          tokensIn,
          tokensOut,
          costUsdMicros: cost,
          notice: meta.notice,
        },
      });
      await appendProjectContext(db, input.thread.projectId, state.summaries);
    },
  });
  return stream;
}
