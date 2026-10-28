import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import type { ChatUIMessage } from "@/lib/agents/chat-types";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { getAiSettings } from "@/lib/services/ai-settings";
import { getThread, loadMessages } from "@/lib/services/chat";
import { AssistantStatus } from "../assistant-status";
import { ChatView } from "./chat-view";

export default async function ChatThreadPage(props: PageProps<"/chat/[threadId]">) {
  const { threadId } = await props.params;
  const { ctx } = await requireAppContext();
  const { thread, projectName } = await orNotFound(getThread(db, ctx, threadId));
  const [rows, ai] = await Promise.all([loadMessages(db, threadId), getAiSettings(db, ctx)]);
  const messages: ChatUIMessage[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    parts: r.parts as ChatUIMessage["parts"],
    metadata:
      r.role === "assistant"
        ? { mode: r.mode ?? undefined, provider: r.provider, model: r.model, agents: r.agents ?? [], notice: r.notice, costUsdMicros: r.costUsdMicros ?? 0 }
        : undefined,
  }));

  return (
    <>
      <PageHeader
        title={thread.title}
        description={`Scope: ${projectName ?? "all my projects"}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/chat">All chats</Link>
          </Button>
        }
      />
      <AssistantStatus plan={ai.plan} overBudget={ai.overBudget} />
      <ChatView threadId={thread.id} initialMessages={messages} commandMode={ai.plan.reason !== "ok"} />
    </>
  );
}
