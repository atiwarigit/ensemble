import { afterEach, describe, expect, it } from "vitest";
import { planCommand } from "@/lib/agents/commands";
import { parseMonth } from "@/lib/agents/dates";
import { estimateCostMicros, isRetryableProviderError, planProviders } from "@/lib/llm/providers";

const now = new Date(Date.UTC(2026, 9, 28));

describe("parseMonth", () => {
  it("reads names, relative months and YYYY-MM", () => {
    expect(parseMonth("2026-03", now)).toBe("2026-03");
    expect(parseMonth("this month", now)).toBe("2026-10");
    expect(parseMonth("last month", now)).toBe("2026-09");
    expect(parseMonth("how much in october?", now)).toBe("2026-10");
    // A bare month name means the most recent one that has started.
    expect(parseMonth("december", now)).toBe("2025-12");
    expect(parseMonth("the weather", now)).toBeNull();
  });
});

describe("planCommand", () => {
  it("parses slash commands", () => {
    expect(planCommand("/expenses summary october")).toMatchObject({
      kind: "calls",
      calls: [{ tool: "finance_summarizeSpend", input: { month: expect.stringMatching(/^\d{4}-10$/) } }],
    });
    expect(planCommand('/lyric history "Glass Rivers"')).toMatchObject({
      calls: [{ tool: "lyrics_lyricHistory", input: { title: "Glass Rivers" } }],
    });
    expect(planCommand("/lyric list missing")).toMatchObject({ calls: [{ tool: "lyrics_listWorks", input: { missingFinalPackage: true } }] });
    expect(planCommand("/finalize “Neon Saints”")).toMatchObject({ calls: [{ tool: "lyrics_requestFinalization" }] });
    expect(planCommand("/help")).toEqual({ kind: "help" });
    expect(planCommand("/dance")).toEqual({ kind: "unknown" });
  });

  it("asks for a missing title with a form", () => {
    expect(planCommand("/export rights")).toMatchObject({ kind: "form", command: "/export rights", field: { options: "works" } });
    expect(planCommand("/expenses summary blorp")).toMatchObject({ kind: "form", field: { name: "month" } });
  });

  it("fans free text out to several agents", () => {
    const plan = planCommand("What did we spend in October, and which songs still lack final rights docs?");
    expect(plan).toMatchObject({ kind: "calls", via: "intent" });
    if (plan.kind !== "calls") throw new Error();
    expect(plan.calls.map((c) => c.tool)).toEqual(["finance_summarizeSpend", "lyrics_listWorks"]);
    expect(planCommand("tell me a joke")).toEqual({ kind: "unknown" });
  });
});

describe("provider planning", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLM_PROVIDER"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const keys = (a: boolean, o: boolean, env?: string) => {
    if (a) process.env.ANTHROPIC_API_KEY = "a";
    else delete process.env.ANTHROPIC_API_KEY;
    if (o) process.env.OPENAI_API_KEY = "o";
    else delete process.env.OPENAI_API_KEY;
    if (env) process.env.LLM_PROVIDER = env;
    else delete process.env.LLM_PROVIDER;
  };
  const ids = (p: ReturnType<typeof planProviders>) => p.order.map((s) => s.id);

  it("falls back to commands with no keys", () => {
    keys(false, false);
    expect(planProviders("auto")).toEqual({ order: [], reason: "no_keys" });
  });
  it("prefers Anthropic, keeps the other as fallback, honours the workspace and env", () => {
    keys(true, true);
    expect(ids(planProviders(undefined))).toEqual(["anthropic", "openai"]);
    expect(ids(planProviders("openai"))).toEqual(["openai", "anthropic"]);
    expect(planProviders("off").reason).toBe("workspace_off");
    keys(true, true, "openai");
    expect(ids(planProviders("anthropic"))).toEqual(["openai", "anthropic"]);
    keys(true, true, "none");
    expect(planProviders("anthropic").reason).toBe("env_off");
  });
  it("uses whichever single key is set", () => {
    keys(false, true);
    expect(ids(planProviders("anthropic"))).toEqual(["openai"]);
    keys(true, false);
    expect(ids(planProviders("auto"))).toEqual(["anthropic"]);
  });
  it("classifies errors and estimates cost", () => {
    expect(isRetryableProviderError({ statusCode: 529 })).toBe(true);
    expect(isRetryableProviderError({ statusCode: 429 })).toBe(true);
    expect(isRetryableProviderError({ lastError: { statusCode: 503 } })).toBe(true);
    expect(isRetryableProviderError({ statusCode: 400 })).toBe(false);
    expect(estimateCostMicros("claude-sonnet-5-5", 1_000_000, 0)).toBe(3_000_000);
    expect(estimateCostMicros("unknown-model", 1, 1)).toBe(90);
  });
});
