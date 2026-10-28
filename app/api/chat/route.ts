import { createUIMessageStreamResponse } from "ai";
import { z } from "zod";
import { db } from "@/db";
import { runChatTurn, textOf } from "@/lib/agents/coordinator";
import type { ChatUIMessage } from "@/lib/agents/chat-types";
import { getApiContext } from "@/lib/authz";
import { hitRateLimit, LIMITS, retryText } from "@/lib/rate-limit";
import { getThread, loadMessages, saveMessage, setThreadTitleIfNew } from "@/lib/services/chat";
import { ServiceError } from "@/lib/services/context";
import { getWorkspace } from "@/lib/services/workspace";

export const maxDuration = 60;

const body = z.object({
  id: z.string().uuid(),
  message: z.object({
    id: z.string().min(1).max(100),
    role: z.literal("user"),
    parts: z.array(z.object({ type: z.literal("text"), text: z.string().max(4000) })).min(1),
  }),
});

export async function POST(request: Request) {
  const app = await getApiContext();
  if (!app) return Response.json({ error: "Sign in again." }, { status: 401 });
  const limit = await hitRateLimit(`chat:${app.ctx.userId}`, LIMITS.chatPerUser);
  if (!limit.ok) {
    return Response.json(
      { error: `You've sent a lot of messages in a short time. Try again ${retryText(limit.retryAfter)}.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid message." }, { status: 400 });
  const { id: threadId, message } = parsed.data;
  if (!textOf(message)) return Response.json({ error: "Type a message." }, { status: 400 });

  let thread;
  try {
    thread = await getThread(db, app.ctx, threadId);
  } catch (err) {
    if (err instanceof ServiceError) return Response.json({ error: "Chat not found." }, { status: 404 });
    throw err;
  }

  const [rows, workspace] = await Promise.all([loadMessages(db, threadId), getWorkspace(db, app.ctx)]);
  const history: ChatUIMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    parts: r.parts as ChatUIMessage["parts"],
  }));
  const userMessage: ChatUIMessage = { id: message.id, role: "user", parts: message.parts };
  await saveMessage(db, { id: message.id, threadId, role: "user", parts: message.parts });
  await setThreadTitleIfNew(db, threadId, textOf(userMessage));

  const stream = await runChatTurn({
    ctx: app.ctx,
    userName: app.user.name,
    workspaceName: workspace?.name ?? "the workspace",
    thread: { id: threadId, projectId: thread.thread.projectId, projectName: thread.projectName },
    history,
    message: userMessage,
  });
  return createUIMessageStreamResponse({ stream });
}
