import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { auditEvents } from "@/db/schema/audit";
import { chatMessages, llmCalls, lyricSuggestions } from "@/db/schema/chat";
import { workspaces } from "@/db/schema/tenancy";
import type { ChatUIMessage } from "@/lib/agents/chat-types";
import { runChatTurn } from "@/lib/agents/coordinator";
import { createThread, loadMessages, saveMessage } from "@/lib/services/chat";
import type { ServiceContext } from "@/lib/services/context";
import { createExpense, listCategories, seedDefaultCategories } from "@/lib/services/expenses";
import { addVersion, createWork, listVersions } from "@/lib/services/lyrics";
import { createProject, setAllowLlmOnLyricsTx, setProjectMember } from "@/lib/services/projects";
import { acceptSuggestion, dismissSuggestion } from "@/lib/services/suggestions";
import { createMockLlmServer } from "../mocks/llm-server.mjs";
import { createMember, createWorkspace } from "./fixtures";

// Real keys from the environment are kept for the optional live test at the bottom; every other test
// talks to the local mock, which speaks the Anthropic and OpenAI streaming protocols.
const LIVE = { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY };
const LLM_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "LLM_PROVIDER"];

const server = createMockLlmServer();
let mockUrl = "";
const control = (body: unknown) => fetch(`${mockUrl}/__control`, { method: "POST", body: JSON.stringify(body) });

function useProviders(which: { anthropic?: boolean; openai?: boolean }) {
  for (const k of LLM_ENV) delete process.env[k];
  if (which.anthropic) {
    process.env.ANTHROPIC_API_KEY = "mock-anthropic";
    process.env.ANTHROPIC_BASE_URL = `${mockUrl}/anthropic/v1`;
  }
  if (which.openai) {
    process.env.OPENAI_API_KEY = "mock-openai";
    process.env.OPENAI_BASE_URL = `${mockUrl}/openai/v1`;
  }
}

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, r));
  mockUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
});
beforeEach(async () => {
  await fetch(`${mockUrl}/__reset`, { method: "POST" });
});

async function setup() {
  const ws = await createWorkspace();
  await seedDefaultCategories(db, ws.id);
  const owner = await createMember(ws.id, "owner", "Romel");
  const nikki = await createMember(ws.id, "member", "Nikki");
  const project = await createProject(owner, { name: "Xania", type: "artist" });
  await setProjectMember(owner, project.id, { userId: nikki.userId, role: "editor" });
  const cats = await listCategories(db, owner);
  const suno = cats.find((c) => c.name === "Suno")!;
  await createExpense(owner, { date: new Date().toISOString().slice(0, 10), amount: "30.00", description: "Suno Pro", categoryId: suno.id, projectId: project.id });
  const { work } = await createWork(nikki, { projectId: project.id, title: "Glass Rivers", body: "Under the bridge\nwe kept the light" });
  return { ws, owner, nikki, project, work };
}

type Ctx = ServiceContext;
async function turn(ctx: Ctx, threadId: string, text: string, projectId: string | null = null) {
  const history = (await loadMessages(db, threadId)).map((r) => ({ id: r.id, role: r.role, parts: r.parts }) as ChatUIMessage);
  const message: ChatUIMessage = { id: randomUUID(), role: "user", parts: [{ type: "text", text }] };
  await saveMessage(db, { id: message.id, threadId, role: "user", parts: message.parts });
  const stream = await runChatTurn({
    ctx,
    userName: "Tester",
    workspaceName: "Test",
    thread: { id: threadId, projectId, projectName: projectId ? "Xania" : null },
    history,
    message,
  });
  const chunks: { type: string; [k: string]: unknown }[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as never);
  }
  const text_ = chunks.filter((c) => c.type === "text-delta").map((c) => c.delta).join("");
  const finish = chunks.find((c) => c.type === "finish") as { messageMetadata?: Record<string, unknown> } | undefined;
  const tools = chunks.filter((c) => c.type === "tool-input-available").map((c) => c.toolName as string);
  // onEnd (saving the answer, audit) runs after the stream closes.
  let saved;
  for (let i = 0; i < 50 && !saved; i++) {
    [saved] = await db.select().from(chatMessages).where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.role, "assistant")));
    if (!saved) await new Promise((r) => setTimeout(r, 20));
  }
  return { text: text_, meta: finish?.messageMetadata ?? {}, tools, chunks };
}

const calls = (workspaceId: string) => db.select().from(llmCalls).where(eq(llmCalls.workspaceId, workspaceId)).orderBy(llmCalls.createdAt);

describe("coordinator chat", () => {
  it("answers with commands when no provider key is set", async () => {
    useProviders({});
    const { ws, owner } = await setup();
    const thread = await createThread(owner, {});
    const r = await turn(owner, thread.id, "What did we spend this month, and which songs still lack final rights docs?");
    expect(r.meta).toMatchObject({ mode: "commands", provider: null });
    expect(r.tools).toEqual(["finance_summarizeSpend", "lyrics_listWorks"]);
    expect(r.text).toContain("$30.00");
    expect(r.text).toContain("Glass Rivers");
    expect(await calls(ws.id)).toHaveLength(0);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, ws.id));
    const toolEvents = audit.filter((e) => e.action === "agent.tool.called");
    expect(toolEvents.map((e) => e.agentId).sort()).toEqual(["finance", "lyrics"]);
    expect(toolEvents.every((e) => e.actorType === "agent" && e.onBehalfOfUserId === owner.userId)).toBe(true);
    expect(audit.some((e) => e.action === "agent.coordinator.turn" && e.agentId === "coordinator")).toBe(true);
  });

  it.each(["anthropic", "openai"] as const)("routes through %s when only its key is set", async (provider) => {
    useProviders({ [provider]: true });
    const { ws, owner } = await setup();
    const thread = await createThread(owner, {});
    const r = await turn(owner, thread.id, "How much did we spend this month? Also, which songs are missing final rights packages?");
    expect(r.meta).toMatchObject({ mode: "llm", provider, notice: null });
    expect(r.tools.sort()).toEqual(["finance_summarizeSpend", "lyrics_listWorks"]);
    expect(r.text).toContain("Here's what I found");
    expect(r.text).toContain("$30.00");
    const logged = await calls(ws.id);
    // One row per turn; tokens cover every step of the tool loop.
    expect(logged.length).toBe(1);
    expect(logged.every((c) => c.provider === provider && c.status === "ok" && c.tokensIn > 0 && c.costUsdMicros > 0)).toBe(true);
  });

  it("falls back to OpenAI once when Anthropic is overloaded", async () => {
    useProviders({ anthropic: true, openai: true });
    const { ws, owner } = await setup();
    await control({ fail: { provider: "anthropic", status: 529 } });
    const thread = await createThread(owner, {});
    const r = await turn(owner, thread.id, "What's our budget status?");
    expect(r.meta).toMatchObject({ mode: "llm", provider: "openai" });
    expect(r.meta.notice).toMatch(/Anthropic was unavailable/);
    const logged = await calls(ws.id);
    expect(logged[0]).toMatchObject({ provider: "anthropic", status: "error", errorCode: "529" });
    expect(logged.slice(1).every((c) => c.provider === "openai" && c.status === "ok" && c.fallbackFrom === "anthropic")).toBe(true);
  });

  it("uses commands when every provider fails, and doesn't retry a bad request", async () => {
    useProviders({ anthropic: true, openai: true });
    const { owner } = await setup();
    await control({ fail: { provider: "anthropic", status: 503 } });
    await control({ fail: { provider: "openai", status: 500 } });
    const thread = await createThread(owner, {});
    const r = await turn(owner, thread.id, "How much did we spend this month?");
    expect(r.meta).toMatchObject({ mode: "commands" });
    expect(r.meta.notice).toMatch(/OpenAI returned an error \(500\)/);
    expect(r.text).toContain("$30.00");

    await fetch(`${mockUrl}/__reset`, { method: "POST" });
    await control({ fail: { provider: "anthropic", status: 400 } });
    const r2 = await turn(owner, thread.id, "How much did we spend this month?");
    expect(r2.meta).toMatchObject({ mode: "commands" });
    expect(await (await fetch(`${mockUrl}/__calls`)).json()).toEqual({ anthropic: 1, openai: 0 });
  });

  it("runs slash commands without the model, and stops at the monthly budget", async () => {
    useProviders({ anthropic: true });
    const { ws, owner } = await setup();
    const thread = await createThread(owner, {});
    const r = await turn(owner, thread.id, "/budget");
    expect(r.meta).toMatchObject({ mode: "commands" });
    expect(await (await fetch(`${mockUrl}/__calls`)).json()).toEqual({ anthropic: 0, openai: 0 });

    await db.update(workspaces).set({ settings: { llm_monthly_budget_usd: 0 } }).where(eq(workspaces.id, ws.id));
    const r2 = await turn(owner, thread.id, "What did we spend this month?");
    expect(r2.meta).toMatchObject({ mode: "commands" });
    expect(r2.meta.notice).toMatch(/budget/);
    expect((await calls(ws.id)).map((c) => c.status)).toEqual(["blocked"]);

    await db.update(workspaces).set({ settings: { llm_provider: "off" } }).where(eq(workspaces.id, ws.id));
    const r3 = await turn(owner, thread.id, "What did we spend this month?");
    expect(r3.meta).toMatchObject({ mode: "commands", notice: null });
  });

  it("keeps lyrics private unless the project allows AI access, and suggestions need a person to accept", async () => {
    useProviders({ anthropic: true });
    const { ws, owner, nikki, project, work } = await setup();
    const thread = await createThread(nikki, { projectId: project.id });
    const r = await turn(nikki, thread.id, 'Can you suggest a stronger ending for "Glass Rivers"?', project.id);
    expect(r.tools).toEqual(["lyrics_readLyricText"]);
    expect(r.text).toMatch(/private/);
    expect(await db.select().from(lyricSuggestions).where(eq(lyricSuggestions.workId, work.id))).toHaveLength(0);

    await db.transaction((tx) => setAllowLlmOnLyricsTx(tx, owner, project.id, true));
    const r2 = await turn(nikki, thread.id, 'Can you suggest a stronger ending for "Glass Rivers"?', project.id);
    expect(r2.tools).toEqual(["lyrics_readLyricText", "lyrics_proposeLyricEdit"]);
    const [s] = await db.select().from(lyricSuggestions).where(eq(lyricSuggestions.workId, work.id));
    expect(s).toMatchObject({ status: "open", provider: "anthropic", kind: "structure", requestedBy: nikki.userId });
    expect((await listVersions(db, nikki, work.id)).length).toBe(1);

    const edited = `${s.suggestion}!`;
    const v = await acceptSuggestion(nikki, s.id, { body: edited });
    expect(v).toMatchObject({ versionNo: 2, origin: "human_edit_of_ai_suggestion", body: edited });
    await expect(acceptSuggestion(nikki, s.id, { body: edited })).rejects.toThrow(/already accepted/);
    await expect(db.delete(lyricSuggestions).where(eq(lyricSuggestions.id, s.id))).rejects.toThrow();

    // A suggestion made against an older version can't be accepted.
    await turn(nikki, thread.id, 'Can you suggest a stronger ending for "Glass Rivers"?', project.id);
    const open = (await db.select().from(lyricSuggestions).where(eq(lyricSuggestions.workId, work.id))).find((x) => x.status === "open")!;
    await addVersion(nikki, work.id, { body: "Something new", baseVersionNo: 2 });
    await expect(acceptSuggestion(nikki, open.id, { body: open.suggestion })).rejects.toThrow(/changed after/);
    await dismissSuggestion(nikki, open.id);

    const audit = await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, ws.id));
    expect(audit.filter((e) => e.action === "lyric.suggestion.created").every((e) => e.actorType === "agent")).toBe(true);
    expect(audit.find((e) => e.action === "lyric.suggestion.accepted")).toMatchObject({ actorType: "user", actorUserId: nikki.userId });
  });

  it("doesn't let the agent touch another person's personal expense", async () => {
    useProviders({});
    const { owner, nikki } = await setup();
    const cats = await listCategories(db, owner);
    const mine = await createExpense(nikki, { date: "2026-10-01", amount: "5", description: "Coffee" });
    const thread = await createThread(owner, {});
    const { runTool, resolveTool } = await import("@/lib/agents/registry");
    const agentCtx = { ...owner, actorType: "agent" as const, onBehalfOfUserId: owner.userId };
    const run = await runTool(
      { ctx: agentCtx, projectId: null, threadId: thread.id, mode: "commands", llm: null },
      resolveTool("finance_categorizeExpense")!,
      { expenseId: mine.id, category: cats[0].name },
    );
    expect(run.ok).toBe(false);
  });
});

describe.runIf(LIVE.anthropic || LIVE.openai)("live provider (keys found in the environment)", () => {
  it("answers a spend question with a real model", { timeout: 60_000 }, async () => {
    for (const k of LLM_ENV) delete process.env[k];
    if (LIVE.anthropic) process.env.ANTHROPIC_API_KEY = LIVE.anthropic;
    else process.env.OPENAI_API_KEY = LIVE.openai;
    const { owner } = await setup();
    const thread = await createThread(owner, {});
    const r = await turn(owner, thread.id, "How much did we spend this month?");
    expect(r.meta.mode).toBe("llm");
    expect(r.tools).toContain("finance_summarizeSpend");
  });
});
