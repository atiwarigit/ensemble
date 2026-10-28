import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PendingApprovalNotice } from "@/components/pending-approval-notice";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/db";
import { orNotFound, requireAppContext } from "@/lib/authz";
import { formatDateTime, formatMoney } from "@/lib/format";
import { listCategories } from "@/lib/services/expenses";
import { listApprovals } from "@/lib/services/approvals";
import { getImportPreview, LARGE_IMPORT_ROWS } from "@/lib/services/imports";
import { getProjectAccess } from "@/lib/services/access";
import { BatchActions } from "./batch-actions";
import { MappingForm } from "./mapping-form";
import { PreviewTable } from "./preview-table";

export const metadata: Metadata = { title: "Review import" };

export default async function ImportBatchPage(props: PageProps<"/expenses/import/[batchId]">) {
  const { batchId } = await props.params;
  const { ctx } = await requireAppContext();
  const [{ batch, mapping, preview }, categories] = await Promise.all([
    orNotFound(getImportPreview(db, ctx, batchId)),
    listCategories(db, ctx),
  ]);
  const [project, pendingApprovals] = await Promise.all([
    batch.projectId ? getProjectAccess(db, ctx, batch.projectId) : null,
    listApprovals(db, ctx, { scope: "pending", entityType: "import_batch", entityId: batch.id }),
  ]);
  const canRequest = batch.projectId
    ? project?.role === "lead" || project?.role === "editor"
    : batch.createdBy === ctx.userId || ctx.workspaceRole === "owner";
  const toImport = preview?.totals.toImport ?? 0;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/expenses/import" className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> All imports
          </Link>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            {batch.filename}
            <Badge variant={batch.status === "reverted" ? "destructive" : batch.status === "committed" ? "secondary" : "outline"} className="capitalize">
              {batch.status === "previewed" ? "Preview" : batch.status}
            </Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            {batch.rowCount} rows · into {project?.project.name ?? "Personal / unallocated"} · uploaded {formatDateTime(batch.createdAt)}
          </p>
        </div>
        <BatchActions
          batchId={batch.id}
          status={batch.status}
          canCommit={!!preview && !preview.mappingError && toImport > 0}
          toImport={toImport}
          needsApproval={toImport > LARGE_IMPORT_ROWS}
          canRequest={canRequest}
          hasPendingRequest={pendingApprovals.length > 0}
          where={project?.project.name ?? "personal expenses"}
        />
      </div>
      <PendingApprovalNotice rows={pendingApprovals} />

      {batch.status !== "previewed" ? (
        <Card>
          <CardHeader>
            <CardTitle>{batch.status === "reverted" ? "Import reverted" : "Import complete"}</CardTitle>
            <CardDescription>
              {batch.status === "reverted"
                ? `Reverted ${batch.revertedAt ? formatDateTime(batch.revertedAt) : ""}. The ${batch.inserted} imported expenses were removed; re-importing the file will add them again.`
                : `Committed ${batch.committedAt ? formatDateTime(batch.committedAt) : ""}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="batch-summary">
              <Stat label="Imported" value={String(batch.inserted)} />
              <Stat label="Skipped duplicates" value={String(batch.skippedDupes)} />
              <Stat label="Excluded (credits/transfers)" value={String(batch.excluded)} />
              <Stat label="Total imported" value={formatMoney(batch.totalMinor)} />
            </dl>
            {batch.errors.length > 0 && (
              <div className="mt-4 text-sm">
                <p className="font-medium">Rows with errors (not imported)</p>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {batch.errors.slice(0, 20).map((e) => (
                    <li key={e.line}>
                      Line {e.line}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {batch.status === "committed" && (
              <Link href={`/expenses?batch=${batch.id}`} className="mt-4 inline-block text-sm underline underline-offset-4">
                View imported expenses
              </Link>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>1. Map columns</CardTitle>
              <CardDescription>
                {batch.mappingId ? "A saved mapping matched this file's headers and was applied." : "We guessed the mapping from the headers. Check it, then update the preview."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MappingForm batchId={batch.id} headers={batch.headers} mapping={mapping!} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>2. Review</CardTitle>
              <CardDescription>
                Nothing is saved until you click Import. Categories come from your rules first, then from the file&apos;s category column.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {preview?.mappingError ? (
                <p className="text-sm text-destructive">{preview.mappingError}</p>
              ) : preview ? (
                <>
                  <dl className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-5" data-testid="preview-totals">
                    <Stat label="Will import" value={String(preview.totals.toImport)} />
                    <Stat label="Duplicates (skipped)" value={String(preview.totals.duplicates)} />
                    <Stat label="Credits/transfers (excluded)" value={String(preview.totals.excluded)} />
                    <Stat label="Errors" value={String(preview.totals.errors)} />
                    <Stat label="Total to import" value={formatMoney(preview.totals.totalMinor)} />
                  </dl>
                  <PreviewTable
                    rows={preview.rows.map((r) => ({
                      line: r.line,
                      status: r.duplicate ? "duplicate" : r.status,
                      errors: r.errors,
                      date: r.date,
                      amountMinor: r.amountMinor,
                      description: r.description,
                      account: r.account,
                      category: r.categoryId ? (categories.find((c) => c.id === r.categoryId)?.fullName ?? null) : null,
                      categorySource: r.categorySource,
                    }))}
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
