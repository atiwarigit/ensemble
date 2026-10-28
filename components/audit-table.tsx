import { Bot, Cog, User } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AGENT_LABEL } from "@/lib/agents/chat-types";
import { formatDateTime } from "@/lib/format";
import type { AuditRow } from "@/lib/services/audit";

function actionTone(action: string): "default" | "secondary" | "destructive" | "outline" {
  if (/(removed|revoked|archived|failed|reverted|deleted)/.test(action)) return "destructive";
  if (action.startsWith("auth.")) return "outline";
  return "secondary";
}

function agentLabel(agentId: string | null) {
  if (!agentId) return "Agent";
  const label = AGENT_LABEL[agentId as keyof typeof AGENT_LABEL];
  return label ? `${label} agent` : agentId;
}

function Details({ before, after }: { before: unknown; after: unknown }) {
  if (before == null && after == null) return <span className="text-muted-foreground">—</span>;
  return (
    <details className="group max-w-md">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">View change</summary>
      <div className="mt-2 grid gap-2 text-xs">
        {before != null && (
          <pre className="overflow-x-auto rounded bg-destructive/5 p-2 font-mono whitespace-pre-wrap">
            {JSON.stringify(before, null, 2)}
          </pre>
        )}
        {after != null && (
          <pre className="overflow-x-auto rounded bg-emerald-500/5 p-2 font-mono whitespace-pre-wrap">
            {JSON.stringify(after, null, 2)}
          </pre>
        )}
      </div>
    </details>
  );
}

export function AuditTable({ rows, showProject = true }: { rows: AuditRow[]; showProject?: boolean }) {
  if (!rows.length) {
    return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">#</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Action</TableHead>
            {showProject && <TableHead>Project</TableHead>}
            <TableHead>Details</TableHead>
            <TableHead className="text-right">Hash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ event: e, actorName, actorEmail, onBehalfOfName, projectName }) => (
            <TableRow key={e.id} data-testid="audit-row">
              <TableCell className="font-mono text-xs text-muted-foreground" data-testid="audit-id">
                {e.id}
              </TableCell>
              <TableCell className="text-xs whitespace-nowrap">{formatDateTime(e.createdAt)}</TableCell>
              <TableCell className="text-sm">
                <span className="inline-flex items-center gap-1.5" title={actorEmail ?? undefined}>
                  {e.actorType === "agent" ? (
                    <Bot className="size-3.5" />
                  ) : e.actorType === "system" ? (
                    <Cog className="size-3.5" />
                  ) : (
                    <User className="size-3.5" />
                  )}
                  {e.actorType === "agent"
                    ? `${agentLabel(e.agentId)}${onBehalfOfName ? ` for ${onBehalfOfName}` : ""}`
                    : (actorName ?? (e.actorType === "system" ? "System" : "Unknown"))}
                </span>
              </TableCell>
              <TableCell>
                <Badge variant={actionTone(e.action)} className="font-mono">
                  {e.action}
                </Badge>
              </TableCell>
              {showProject && (
                <TableCell className="text-sm">
                  {e.projectId && projectName ? (
                    <Link href={`/projects/${e.projectId}`} className="hover:underline">
                      {projectName}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Workspace</span>
                  )}
                </TableCell>
              )}
              <TableCell>
                <Details before={e.before} after={e.after} />
              </TableCell>
              <TableCell className="text-right font-mono text-xs text-muted-foreground" title={e.hash}>
                {e.hash.slice(0, 10)}…
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
