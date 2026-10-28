import { FolderKanban, Lock, Plus, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuditTable } from "@/components/audit-table";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { listAuditEvents } from "@/lib/services/audit";
import { canCreateProjects, listProjects } from "@/lib/services/projects";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { user, ctx } = await requireAppContext();
  const [projects, activity] = await Promise.all([
    listProjects(db, ctx),
    listAuditEvents(db, ctx, { limit: 8 }),
  ]);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description="Your projects and recent activity."
        actions={
          canCreateProjects(ctx) && (
            <Button asChild>
              <Link href="/projects?new=1">
                <Plus /> New project
              </Link>
            </Button>
          )
        }
      />

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <FolderKanban className="size-4" /> Your projects
        </h2>
        {projects.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {projects.slice(0, 6).map((p) => (
              <Link key={p.id} href={`/projects/${p.id}`}>
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      <span className="truncate">{p.name}</span>
                      <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Private" />
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {p.type}
                      </Badge>
                      {p.artistName && <span className="truncate">{p.artistName}</span>}
                      <span className="ml-auto text-xs">
                        {p.memberCount} member{p.memberCount === 1 ? "" : "s"}
                      </span>
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            You aren&apos;t on any projects yet.
            {canCreateProjects(ctx) ? " Create one to get started." : " Ask a project lead to add you."}
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ScrollText className="size-4" /> Recent activity
          </h2>
          <Button variant="link" size="sm" asChild>
            <Link href="/audit">View audit log</Link>
          </Button>
        </div>
        <AuditTable rows={activity} />
      </section>
    </>
  );
}
