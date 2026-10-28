"use client";

import { Check, Loader2, Send, Trash2, Undo2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { RequestApprovalButton } from "@/components/request-approval-button";
import { Button } from "@/components/ui/button";
import { commitS4aAction, discardS4aAction } from "../../../actions";

export function S4aBatchActions({
  projectId,
  batchId,
  status,
  canEdit,
  canCommit,
  toImport,
  needsApproval,
  hasPendingRequest,
}: {
  projectId: string;
  batchId: string;
  status: "previewed" | "committed" | "reverted";
  canEdit: boolean;
  canCommit: boolean;
  toImport: number;
  needsApproval: boolean;
  hasPendingRequest: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const label = `${toImport.toLocaleString("en-US")} data point${toImport === 1 ? "" : "s"}`;
  if (!canEdit) return null;

  if (status === "previewed") {
    return (
      <div className="flex gap-2">
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await discardS4aAction(projectId, batchId);
              if (r && !r.ok) toast.error(r.error);
            })
          }
        >
          <Trash2 /> Discard
        </Button>
        {needsApproval ? (
          <RequestApprovalButton
            actionType="import.commit_large"
            payload={{ batchId }}
            disabled={!canCommit || hasPendingRequest}
            title={`Request approval to import ${label}`}
            description="Files over 500 rows need a project lead or workspace owner to approve them."
          >
            <Send /> {hasPendingRequest ? "Approval requested" : "Request approval to import"}
          </RequestApprovalButton>
        ) : (
          <Button
            disabled={!canCommit || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await commitS4aAction(projectId, batchId);
                if (!r.ok) return void toast.error(r.error);
                const d = r.data!;
                toast.success(
                  `Imported ${d.inserted.toLocaleString("en-US")} data points. ${d.skipped ? `${d.skipped} were already there. ` : ""}${d.alerts ? `${d.alerts} new alert${d.alerts === 1 ? "" : "s"}.` : ""}`,
                );
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Check />}
            Import {label}
          </Button>
        )}
      </div>
    );
  }
  if (status === "committed") {
    return (
      <RequestApprovalButton
        actionType="import.revert"
        payload={{ batchId }}
        variant="destructive"
        disabled={hasPendingRequest}
        title="Request a revert"
        description="Reverting removes every data point this import added. A project lead or workspace owner has to approve it."
      >
        <Undo2 /> {hasPendingRequest ? "Revert requested" : "Request revert"}
      </RequestApprovalButton>
    );
  }
  return null;
}
