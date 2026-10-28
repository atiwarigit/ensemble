import { CheckCircle2, Inbox } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { db } from "@/db";
import type { ApprovalStatus } from "@/db/schema/approvals";
import { requireAppContext } from "@/lib/authz";
import { formatDateTime } from "@/lib/format";
import { listApprovals, type ApprovalRow } from "@/lib/services/approvals";
import { DecisionControls } from "./decision-controls";

export const metadata: Metadata = { title: "Approvals" };

const STATUS_VARIANT: Record<ApprovalStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  approved: "secondary",
  executed: "default",
  rejected: "destructive",
  expired: "outline",
  failed: "destructive",
};
const STATUS_LABEL: Record<ApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  executed: "Approved · done",
  rejected: "Rejected",
  expired: "Expired",
  failed: "Approved · failed",
};

function entityHref(r: ApprovalRow["req"]) {
  if (r.entityType === "lyric_work") return `/lyrics/${r.entityId}`;
  if (r.entityType === "import_batch") return `/expenses/import/${r.entityId}`;
  if (r.entityType === "project") return `/projects/${r.entityId}`;
  return null;
}

function RequestCard({ row }: { row: ApprovalRow }) {
  const { req, requesterName, projectName, canApprove, canReject, isRequester, label } = row;
  const href = entityHref(req);
  return (
    <Card id={req.id} data-testid="approval-request" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{label}</Badge>
          <span className="text-xs text-muted-foreground">{projectName ?? "Personal"}</span>
        </div>
        <CardTitle className="text-base leading-snug">{req.summary}</CardTitle>
        <CardDescription>
          Requested by {isRequester ? "you" : requesterName} · {formatDateTime(req.createdAt)} · expires {formatDateTime(req.expiresAt)}
          <br />
          Needs {req.requiredRole === "owner" ? "a workspace owner" : "a project lead or workspace owner"}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {req.reason && <blockquote className="border-l-2 pl-3 text-sm">{req.reason}</blockquote>}
        {href && (
          <Link href={href} className="text-sm underline underline-offset-2">
            Open what this changes
          </Link>
        )}
        <DecisionControls
          requestId={req.id}
          canApprove={canApprove}
          canReject={canReject}
          isRequester={isRequester}
          selfApproval={isRequester && canApprove}
        />
      </CardContent>
    </Card>
  );
}

export default async function ApprovalsPage() {
  const { ctx } = await requireAppContext();
  const [pending, decided] = await Promise.all([
    listApprovals(db, ctx, { scope: "pending" }),
    listApprovals(db, ctx, { scope: "decided", limit: 50 }),
  ]);
  const mine = pending.filter((r) => r.canApprove);
  const others = pending.filter((r) => !r.canApprove);

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Approvals"
        description="Finalizing lyrics, changing a final split, large imports, reverts, archiving and AI access to lyrics all wait here for a second person. Approved requests run under the approver's name."
      />

      <section className="grid gap-3" aria-labelledby="awaiting-heading">
        <h2 id="awaiting-heading" className="text-sm font-medium">
          Waiting for your decision ({mine.length})
        </h2>
        {mine.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" /> Nothing needs your approval.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">{mine.map((r) => <RequestCard key={r.req.id} row={r} />)}</div>
        )}
      </section>

      {others.length > 0 && (
        <section className="grid gap-3" aria-labelledby="others-heading">
          <h2 id="others-heading" className="text-sm font-medium">
            Waiting on someone else ({others.length})
          </h2>
          <div className="grid gap-3 lg:grid-cols-2">{others.map((r) => <RequestCard key={r.req.id} row={r} />)}</div>
        </section>
      )}

      <section className="grid gap-3" aria-labelledby="history-heading">
        <h2 id="history-heading" className="text-sm font-medium">
          History
        </h2>
        {decided.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            <Inbox className="size-4" /> No decisions yet.
          </div>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Requested by</TableHead>
                  <TableHead>Decided by</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decided.map(({ req, requesterName, deciderName }) => (
                  <TableRow key={req.id} data-testid="approval-history-row">
                    <TableCell className="max-w-md">
                      <div className="truncate text-sm" title={req.summary}>
                        {req.summary}
                      </div>
                      {(req.decisionNote || req.error) && (
                        <div className="truncate text-xs text-muted-foreground">{req.error ?? req.decisionNote}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{requesterName}</TableCell>
                    <TableCell className="text-sm">
                      {deciderName ?? "—"}
                      {req.decidedBy && req.decidedBy === req.requestedBy && req.status !== "rejected" && (
                        <Badge variant="outline" className="ml-1">
                          Self-approved
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[req.status]}>{STATUS_LABEL[req.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(req.decidedAt ?? req.expiresAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
