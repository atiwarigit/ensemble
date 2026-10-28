import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db";
import { chatMessages, chatThreads, projectContext } from "@/db/schema/chat";
import { projects } from "@/db/schema/tenancy";
import { requireProjectRole } from "./access";
import { notFound, type ServiceContext } from "./context";

export const threadInput = z.object({
  projectId: z
    .string()
    .uuid()
    .nullish()
    .or(z.literal("").transform(() => null)),
});

export async function createThread(ctx: ServiceContext, input: z.input<typeof threadInput>) {
  const { projectId } = threadInput.parse(input);
  if (projectId) await requireProjectRole(db, ctx, projectId, "viewer");
  const [t] = await db
    .insert(chatThreads)
    .values({ workspaceId: ctx.workspaceId, projectId: projectId ?? null, userId: ctx.userId, title: "New chat" })
    .returning();
  return t;
}

/** Chats are private to the person who started them, owners included. */
export async function getThread(exec: Executor, ctx: ServiceContext, threadId: string) {
  const [row] = await exec
    .select({ thread: chatThreads, projectName: projects.name })
    .from(chatThreads)
    .leftJoin(projects, eq(projects.id, chatThreads.projectId))
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.userId, ctx.userId), eq(chatThreads.workspaceId, ctx.workspaceId)));
  if (!row) throw notFound("Chat not found.");
  if (row.thread.projectId) await requireProjectRole(exec, ctx, row.thread.projectId, "viewer");
  return row;
}

export async function listThreads(exec: Executor, ctx: ServiceContext, limit = 30) {
  return exec
    .select({ thread: chatThreads, projectName: projects.name })
    .from(chatThreads)
    .leftJoin(projects, eq(projects.id, chatThreads.projectId))
    .where(and(eq(chatThreads.userId, ctx.userId), eq(chatThreads.workspaceId, ctx.workspaceId)))
    .orderBy(desc(chatThreads.updatedAt))
    .limit(limit);
}

export async function loadMessages(exec: Executor, threadId: string) {
  return exec.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(asc(chatMessages.createdAt));
}

export type SavedMessage = typeof chatMessages.$inferInsert;

export async function saveMessage(exec: Executor, row: SavedMessage) {
  await exec.insert(chatMessages).values(row).onConflictDoNothing();
  await exec.update(chatThreads).set({ updatedAt: new Date() }).where(eq(chatThreads.id, row.threadId));
}

export async function setThreadTitleIfNew(exec: Executor, threadId: string, firstMessage: string) {
  const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
  await exec
    .update(chatThreads)
    .set({ title })
    .where(and(eq(chatThreads.id, threadId), eq(chatThreads.title, "New chat")));
}

export async function getProjectContext(exec: Executor, projectId: string | null) {
  if (!projectId) return null;
  const [row] = await exec.select().from(projectContext).where(eq(projectContext.projectId, projectId));
  return row?.summary ?? null;
}

const CONTEXT_LINES = 8;

/** Keeps the last few tool outcomes per project; built from tool summaries, never from what users typed. */
export async function appendProjectContext(exec: Executor, projectId: string | null, lines: string[]) {
  if (!projectId || !lines.length) return;
  const prev = (await getProjectContext(exec, projectId))?.split("\n").filter(Boolean) ?? [];
  const day = new Date().toISOString().slice(0, 10);
  const summary = [...prev, ...lines.map((l) => `${day}: ${l.slice(0, 240)}`)].slice(-CONTEXT_LINES).join("\n");
  await exec
    .insert(projectContext)
    .values({ projectId, summary })
    .onConflictDoUpdate({ target: projectContext.projectId, set: { summary, updatedAt: new Date() } });
}
