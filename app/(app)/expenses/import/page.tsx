import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { requireAppContext } from "@/lib/authz";
import { formatDateTime, formatMoney } from "@/lib/format";
import { listImportBatches, listMappingPresets } from "@/lib/services/imports";
import { listProjects } from "@/lib/services/projects";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Import CSV" };

const STATUS_VARIANT = { previewed: "outline", committed: "secondary", reverted: "destructive" } as const;

export default async function ImportPage(props: PageProps<"/expenses/import">) {
  const { ctx } = await requireAppContext();
  const sp = await props.searchParams;
  const [projects, batches, presets] = await Promise.all([
    listProjects(db, ctx),
    listImportBatches(db, ctx),
    listMappingPresets(db, ctx),
  ]);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Import a bank or card export</CardTitle>
          <CardDescription>
            Upload a CSV (up to 10 MB). You&apos;ll map the columns and preview every row before anything is saved.
            Rows already imported are skipped, and refunds, credits, and transfers are left out.
            {presets.length > 0 && ` Saved mappings: ${presets.map((p) => p.name).join(", ")}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm
            projects={projects.filter((p) => p.myRole !== "viewer").map((p) => ({ id: p.id, name: p.name }))}
            defaultProjectId={typeof sp.project === "string" ? sp.project : undefined}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Import history</CardTitle>
        </CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Imported</TableHead>
                  <TableHead className="text-right">Skipped dupes</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id} data-testid="import-batch">
                    <TableCell>
                      <Link href={`/expenses/import/${b.id}`} className="font-medium hover:underline">
                        {b.filename}
                      </Link>
                      <div className="text-xs text-muted-foreground">by {b.createdByName}</div>
                    </TableCell>
                    <TableCell>{b.projectName ?? <span className="text-muted-foreground">Personal</span>}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[b.status]} className="capitalize">
                        {b.status === "previewed" ? "Not imported yet" : b.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{b.status === "previewed" ? "—" : b.inserted}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.status === "previewed" ? "—" : b.skippedDupes}</TableCell>
                    <TableCell className="text-right tabular-nums">{b.status === "previewed" ? "—" : formatMoney(b.totalMinor)}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(b.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
