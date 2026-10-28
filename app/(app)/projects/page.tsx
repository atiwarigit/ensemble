import { Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDate } from "@/lib/format";
import { canCreateProjects, listProjects } from "@/lib/services/projects";
import { NewProjectDialog } from "./new-project-dialog";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage(props: PageProps<"/projects">) {
  const { ctx } = await requireAppContext();
  const sp = await props.searchParams;
  const projects = await listProjects(db, ctx, { includeArchived: true });

  return (
    <>
      <PageHeader
        title="Projects"
        description={
          ctx.workspaceRole === "owner"
            ? "As a workspace owner you can see every project."
            : "Projects you're a member of."
        }
        actions={canCreateProjects(ctx) && <NewProjectDialog defaultOpen={sp.new === "1"} />}
      />
      {projects.length ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Your role</TableHead>
                <TableHead className="text-right">Members</TableHead>
                <TableHead className="text-right">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.id} className={p.archivedAt ? "opacity-60" : undefined}>
                  <TableCell className="font-medium">
                    <Link href={`/projects/${p.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                      <Lock className="size-3 text-muted-foreground" />
                      {p.name}
                    </Link>
                    {p.archivedAt && (
                      <Badge variant="outline" className="ml-2">
                        Archived
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="capitalize">{p.type}</TableCell>
                  <TableCell>{p.artistName ?? "—"}</TableCell>
                  <TableCell className="capitalize">
                    {p.myRole ?? (ctx.workspaceRole === "owner" ? "owner (workspace)" : "—")}
                  </TableCell>
                  <TableCell className="text-right">{p.memberCount}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatDate(p.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No projects yet.
        </p>
      )}
    </>
  );
}
