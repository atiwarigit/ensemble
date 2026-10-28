import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { LlmPreference } from "@/db/schema/tenancy";

export type ProviderId = "anthropic" | "openai";
export const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI" };

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-6-luna",
};

export type ProviderStatus = { id: ProviderId; configured: boolean; model: string; baseURL?: string };

/** Read on every call so key changes take effect without a rebuild. */
export function providerStatus(): ProviderStatus[] {
  return [
    {
      id: "anthropic",
      configured: !!process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic,
      baseURL: process.env.ANTHROPIC_BASE_URL || undefined,
    },
    {
      id: "openai",
      configured: !!process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || DEFAULT_MODELS.openai,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    },
  ];
}

function envOverride(): LlmPreference | null {
  const v = process.env.LLM_PROVIDER?.trim().toLowerCase();
  return v === "anthropic" || v === "openai" || v === "none" || v === "off" ? (v === "none" ? "off" : v) : null;
}

export type ProviderPlan = {
  /** Ordered: primary first, then the fallback (if configured). Empty = command mode. */
  order: ProviderStatus[];
  reason: "env_off" | "workspace_off" | "no_keys" | "ok";
};

/**
 * Plan §2: LLM_PROVIDER wins, then the workspace preference, then Anthropic if its key is set, then OpenAI.
 * The other configured provider is kept as a one-shot fallback for 429/5xx.
 */
export function planProviders(workspacePref: LlmPreference | undefined): ProviderPlan {
  const status = providerStatus();
  const configured = status.filter((s) => s.configured);
  const env = envOverride();
  if (env === "off") return { order: [], reason: "env_off" };
  const pref = env ?? workspacePref ?? "auto";
  if (pref === "off") return { order: [], reason: "workspace_off" };
  if (!configured.length) return { order: [], reason: "no_keys" };
  const primary = (pref !== "auto" && configured.find((s) => s.id === pref)) || configured[0];
  return { order: [primary, ...configured.filter((s) => s.id !== primary.id)], reason: "ok" };
}

export function languageModel(p: ProviderStatus): LanguageModel {
  if (p.id === "anthropic") {
    return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: p.baseURL })(p.model);
  }
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: p.baseURL })(p.model);
}

/** USD per million tokens. Estimates only, used for the budget; unknown models use the most expensive row. */
const PRICES: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5-5": { in: 3, out: 15 },
  "claude-haiku-5-5": { in: 1, out: 5 },
  "claude-opus-5-5": { in: 15, out: 75 },
  "gpt-6-luna": { in: 1.25, out: 10 },
  "gpt-6-sol": { in: 5, out: 40 },
  "gpt-5.5": { in: 1.25, out: 10 },
};
const FALLBACK_PRICE = { in: 15, out: 75 };

export function estimateCostMicros(model: string, tokensIn: number, tokensOut: number) {
  const p = PRICES[model] ?? FALLBACK_PRICE;
  return Math.round(tokensIn * p.in + tokensOut * p.out);
}

/** 429 and 5xx (incl. Anthropic's 529 "overloaded") are worth one retry on the other provider. */
export function isRetryableProviderError(err: unknown) {
  type E = { statusCode?: number; isRetryable?: boolean; lastError?: unknown };
  const e = ((err as E | null)?.lastError ?? err) as E | null;
  if (typeof e?.statusCode === "number") return e.statusCode === 429 || e.statusCode >= 500;
  return e?.isRetryable === true;
}

export function providerErrorCode(err: unknown) {
  type E = { statusCode?: number; lastError?: unknown; name?: string };
  const e = ((err as E | null)?.lastError ?? err) as E | null;
  return e?.statusCode ? String(e.statusCode) : (e?.name ?? "error");
}
