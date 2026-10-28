import type { UIMessage } from "ai";
import type { ToolLink } from "./types";

export type ChatMetadata = {
  mode?: "llm" | "commands";
  provider?: string | null;
  model?: string | null;
  agents?: string[];
  /** Why this answer came from commands or a fallback provider (budget reached, provider down, …). */
  notice?: string | null;
  costUsdMicros?: number;
  createdAt?: number;
};

export type ChatFormData = {
  prompt: string;
  command: string;
  field: { name: string; label: string };
  options: string[] | null;
};

export type ChatDataParts = { form: ChatFormData };

export type ChatUIMessage = UIMessage<ChatMetadata, ChatDataParts>;

/** What every tool returns to the UI and to the model. */
export type ToolOutput = { summary?: string; data?: unknown; links?: ToolLink[]; approvalId?: string; error?: string };

export const AGENT_LABEL: Record<string, string> = { finance: "Finance", lyrics: "Lyrics", analytics: "Analytics" };
