import { MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { getAiSettings } from "@/lib/services/ai-settings";
import { listThreads } from "@/lib/services/chat";
import { listProjects } from "@/lib/services/projects";
import { AssistantStatus } from "./assistant-status";
import { createThreadAction } from "./actions";

export default async function ChatIndexPage() {
  const { ctx } = await requireAppContext();
  const [threads, projects, ai] = await Promise.all([listThreads(db, ctx), listProjects(db, ctx), getAiSettings(db, ctx)]);

  return (
    <>
      <PageHeader title="Chat" description="Ask the coordinator about expenses and lyrics. Every step it takes is in the audit log." />
      <AssistantStatus plan={ai.plan} overBudget={ai.overBudget} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="grid gap-2">
          {threads.length === 0 && (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No chats yet.</p>
          )}
          {threads.map(({ thread, projectName }) => (
            <Link
              key={thread.id}
              href={`/chat/${thread.id}`}
              className="flex items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/50"
              data-testid="chat-thread"
            >
              <span className="flex min-w-0 items-center gap-2">
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-medium">{thread.title}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {projectName ?? "All projects"} · {formatDateTime(thread.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>New chat</CardTitle>
            <CardDescription>Tools only see the projects you choose here.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createThreadAction} className="grid gap-3">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Scope</span>
                <select
                  name="projectId"
                  aria-label="Scope"
                  defaultValue="all"
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                >
                  <option value="all">All my projects</option>
                  {projects
                    .filter((p) => !p.archivedAt)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </label>
              <Button type="submit">
                <Plus /> Start chat
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
