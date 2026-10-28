import type { z } from "zod";
import type { ServiceContext } from "@/lib/services/context";

export type AgentId = "finance" | "lyrics" | "analytics";

/** Plan §2: `read` runs immediately, `write` runs and is audited, `gated` only ever files an approval request. */
export type ToolRisk = "read" | "write" | "gated";

export type ToolContext = {
  /** The signed-in user's context with actorType "agent"; agents get no extra privileges. */
  ctx: ServiceContext;
  projectId: string | null;
  threadId: string;
  mode: "llm" | "commands";
  /** Set in LLM mode; recorded on anything the model produced (e.g. lyric suggestions). */
  llm: { provider: string; model: string } | null;
};

export type ToolLink = { href: string; label: string };

export type ToolResult = {
  /** One or two plain sentences; shown in the UI and given to the model. */
  summary: string;
  data?: unknown;
  links?: ToolLink[];
  approvalId?: string;
};

export type AgentTool<I = unknown> = {
  name: string;
  description: string;
  input: z.ZodType<I>;
  risk: ToolRisk;
  /** Hidden from command mode, e.g. tools that only make sense when a model supplies the text. */
  llmOnly?: boolean;
  run(tc: ToolContext, input: I): Promise<ToolResult>;
};

export type Agent = {
  id: AgentId;
  label: string;
  description: string;
  tools: AgentTool<never>[];
};

export const defineTool = <I,>(t: AgentTool<I>) => t as unknown as AgentTool<never>;

export const qualifiedName = (agent: AgentId, tool: string) => `${agent}_${tool}`;
