import { ArrowLeft, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PendingApprovalNotice } from "@/components/pending-approval-notice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { S4A_METRIC_LABEL } from "@/lib/csv/s4a-csv";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasProjectRole } from "@/lib/services/access";
import { listApprovals } from "@/lib/services/approvals";
import { getS4aPreview, s4aNeedsApproval } from "@/lib/services/s4a";
import { S4aBatchActions } from "./s4a-batch-actions";
import { S4aMappingForm } from "./s4a-mapping-form";

export const metadata: Metadata = { title: "Review Spotify for Artists import" };

const STATUS_LABEL = { new: "New", duplicate: "Already imported", changed: "Differs from stored (kept stored)" } as const;

export default async function S4aImportPage(props: PageProps<"/analytics/[projectId]/import/[batchId]">) {
  const { projectId, batchId } = await props.params;
  const { ctx } = await requireAppContext();
  const { batch, role, preview } = await orNotFound(getS4aPreview(db, ctx, batchId));
  if (batch.projectId !== projectId) notFound();
  const pendingApprovals = await listApprovals(db, ctx, { scope: "pending", entityType: "import_batch", entityId: batch.id });
  const canEdit = hasProjectRole(role, "editor");
  const toImport = preview?.totals.toImport ?? 0;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/analytics/${projectId}`} className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> Back to analytics
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {batch.filename}
            <Badge variant={batch.status === "reverted" ? "destructive" : batch.status === "committed" ? "secondary" : "outline"} className="capitalize">
              {batch.status === "previewed" ? "Preview" : batch.status}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            Spotify for Artists export · {batch.rowCount} rows · uploaded {formatDateTime(batch.createdAt)}
          </p>
        </div>
        <S4aBatchActions
          projectId={projectId}
          batchId={batch.id}
          status={batch.status}
          canEdit={canEdit}
          canCommit={!!preview && !preview.configError && toImport > 0}
          toImport={toImport}
          needsApproval={s4aNeedsApproval(batch)}
          hasPendingRequest={pendingApprovals.length > 0}
        />
      </div>
      <PendingApprovalNotice rows={pendingApprovals} />

      {batch.status !== "previewed" ? (
        <Card>
          <CardContent className="pt-6 text-sm">
            {batch.status === "committed"
              ? `Imported ${batch.inserted.toLocaleString("en-US")} data points on ${formatDateTime(batch.committedAt!)}; ${batch.skippedDupes.toLocaleString("en-US")} were already stored.`
              : `Reverted on ${formatDateTime(batch.revertedAt!)}. Its data points were removed from the charts.`}
            {batch.errors.length > 0 && ` ${batch.errors.length} rows couldn't be read.`}
          </CardContent>
        </Card>
      ) : (
        preview && (
          <>
            {canEdit && batch.s4aConfig && (
              <Card>
                <CardHeader>
                  <CardTitle>Columns</CardTitle>
                  <CardDescription>Detected from the header row. Check them before importing.</CardDescription>
                </CardHeader>
                <CardContent>
                  <S4aMappingForm projectId={projectId} batchId={batch.id} headers={batch.headers} config={batch.s4aConfig} tracks={preview.tracks} />
                </CardContent>
              </Card>
            )}
            {preview.configError ? (
              <Alert variant="destructive">
                <CircleAlert />
                <AlertTitle>Can&apos;t import yet</AlertTitle>
                <AlertDescription>{preview.configError}</AlertDescription>
              </Alert>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle data-testid="s4a-preview-summary">
                    {preview.totals.toImport.toLocaleString("en-US")} new data points
                    {preview.dateRange && ` from ${formatDate(preview.dateRange.from)} to ${formatDate(preview.dateRange.to)}`}
                  </CardTitle>
                  <CardDescription>
                    {preview.metrics.map((m) => S4A_METRIC_LABEL[m]).join(", ")} · {preview.totals.duplicates} already imported
                    {preview.totals.changed > 0 && ` · ${preview.totals.changed} differ from what's stored (the stored value is kept)`}
                    {preview.totals.errors > 0 && ` · ${preview.totals.errors} rows with problems`}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  {preview.unmatchedSongs.length > 0 && (
                    <Alert>
                      <CircleAlert />
                      <AlertTitle>Some songs aren&apos;t in the linked catalogue</AlertTitle>
                      <AlertDescription>
                        {preview.unmatchedSongs.slice(0, 8).join(", ")}
                        {preview.unmatchedSongs.length > 8 ? ", …" : ""}. They&apos;re imported by name and will show without a release or lyric link.
                      </AlertDescription>
                    </Alert>
                  )}
                  {preview.errors.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-destructive">
                      {preview.errors.slice(0, 10).map((e, i) => (
                        <li key={i}>
                          Line {e.line}: {e.message}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Song</TableHead>
                        <TableHead>Metric</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.points.slice(0, 60).map((p) => (
                        <TableRow key={`${p.date}-${p.trackKey}-${p.metric}`} data-testid="s4a-point" data-status={p.status}>
                          <TableCell>{p.date}</TableCell>
                          <TableCell>{p.trackName ?? <span className="text-muted-foreground">Artist total</span>}</TableCell>
                          <TableCell>{S4A_METRIC_LABEL[p.metric]}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {p.value.toLocaleString("en-US")}
                            {p.status === "changed" && <span className="ml-1 text-xs text-muted-foreground">(stored {p.storedValue?.toLocaleString("en-US")})</span>}
                          </TableCell>
                          <TableCell>
                            <Badge variant={p.status === "new" ? "secondary" : "outline"}>{STATUS_LABEL[p.status]}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {preview.points.length > 60 && <p className="text-xs text-muted-foreground">Showing 60 of {preview.points.length.toLocaleString("en-US")}.</p>}
                </CardContent>
              </Card>
            )}
          </>
        )
      )}
    </div>
  );
}
