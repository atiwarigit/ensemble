import { CircleCheck, CircleX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuditTable } from "@/components/audit-table";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { listAuditEvents, verifyAuditChain } from "@/lib/services/audit";
import { listProjects } from "@/lib/services/projects";
import { AuditFilters } from "./filters";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

export default async function AuditPage(props: PageProps<"/audit">) {
  const { ctx } = await requireAppContext();
  const sp = await props.searchParams;
  const projectId = typeof sp.project === "string" && sp.project ? sp.project : undefined;
  const action = typeof sp.action === "string" && sp.action ? sp.action : undefined;
  const beforeId = typeof sp.before === "string" ? Number(sp.before) || undefined : undefined;

  const [rows, projects, chain] = await Promise.all([
    listAuditEvents(db, ctx, { projectId, action, beforeId, limit: PAGE_SIZE }),
    listProjects(db, ctx, { includeArchived: true }),
    ctx.workspaceRole === "owner" ? verifyAuditChain(db) : Promise.resolve(null),
  ]);

  const nextParams = new URLSearchParams();
  if (projectId) nextParams.set("project", projectId);
  if (action) nextParams.set("action", action);
  if (rows.length === PAGE_SIZE) nextParams.set("before", String(rows[rows.length - 1].event.id));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only record of every change. Each entry is hash-chained to the one before it."
      />
      {chain && (
        <Alert className="mb-4" variant={chain.ok ? "default" : "destructive"} data-testid="chain-status">
          {chain.ok ? <CircleCheck className="text-emerald-600" /> : <CircleX />}
          <AlertTitle>{chain.ok ? "Hash chain verified" : "Hash chain broken"}</AlertTitle>
          <AlertDescription>
            {chain.ok
              ? `${chain.count} events checked. Chain head #${chain.head?.id ?? "—"} · ${chain.head?.hash.slice(0, 16) ?? ""}…`
              : `Breaks at event(s): ${chain.breaks.map((b) => `#${b.id} (${b.reason})`).join(", ")}`}
          </AlertDescription>
        </Alert>
      )}
      <AuditFilters projects={projects.map((p) => ({ id: p.id, name: p.name }))} projectId={projectId} action={action} />
      <AuditTable rows={rows} />
      {rows.length === PAGE_SIZE && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" asChild>
            <Link href={`/audit?${nextParams}`}>Older events</Link>
          </Button>
        </div>
      )}
    </>
  );
}
