import { FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { listWorks, STATUS_LABEL } from "@/lib/services/lyrics";
import { listProjects } from "@/lib/services/projects";
import { LyricFilters } from "./filters";

export const metadata: Metadata = { title: "Lyrics" };

export default async function LyricsPage(props: PageProps<"/lyrics">) {
  const { ctx } = await requireAppContext();
  const sp = await props.searchParams;
  const projectId = typeof sp.project === "string" && sp.project ? sp.project : undefined;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const [works, projects] = await Promise.all([listWorks(db, ctx, { projectId, q }), listProjects(db, ctx)]);
  const writable = projects.filter((p) => !p.archivedAt && (ctx.workspaceRole === "owner" || p.myRole === "lead" || p.myRole === "editor"));

  return (
    <>
      <PageHeader
        title="Lyrics"
        description="The authorship record: every version is timestamped by the server, hashed, and can't be edited or deleted."
        actions={
          writable.length > 0 && (
            <Button asChild>
              <Link href={`/lyrics/new${projectId ? `?project=${projectId}` : ""}`}>
                <Plus /> New lyric
              </Link>
            </Button>
          )
        }
      />
      <LyricFilters projects={projects.map((p) => ({ id: p.id, name: p.name }))} />
      {works.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          <FileText className="mx-auto mb-2 size-6" />
          {q || projectId ? "No lyrics match these filters." : "No lyrics yet. Start one, or enter an older poem with the date you wrote it."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Author</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Versions</TableHead>
                <TableHead className="text-right">Evidence</TableHead>
                <TableHead className="text-right">Generations</TableHead>
                <TableHead>Last recorded</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {works.map((w) => (
                <TableRow key={w.id} data-testid="lyric-row">
                  <TableCell>
                    <Link href={`/lyrics/${w.id}`} className="font-medium hover:underline">
                      {w.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{w.projectName}</TableCell>
                  <TableCell className="text-muted-foreground">{w.authorName ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={w.status === "draft" ? "outline" : "secondary"}>{STATUS_LABEL[w.status]}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{w.latestVersion ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.evidenceCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.generationCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {w.lastRecordedAt ? formatDateTime(w.lastRecordedAt) : "No lyrics yet"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
