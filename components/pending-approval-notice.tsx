import { Clock } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ApprovalRow } from "@/lib/services/approvals";
import { formatDateTime } from "@/lib/format";

export function PendingApprovalNotice({ rows }: { rows: ApprovalRow[] }) {
  if (!rows.length) return null;
  return (
    <div className="grid gap-2">
      {rows.map(({ req, requesterName, canApprove }) => (
        <Alert key={req.id} data-testid="pending-approval">
          <Clock />
          <AlertTitle>Waiting for approval</AlertTitle>
          <AlertDescription>
            <span>
              {req.summary}. Requested by {requesterName} on {formatDateTime(req.createdAt)}.{" "}
              <Link href={`/approvals#${req.id}`} className="font-medium underline underline-offset-2">
                {canApprove ? "Review it in Approvals" : "View in Approvals"}
              </Link>
            </span>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
