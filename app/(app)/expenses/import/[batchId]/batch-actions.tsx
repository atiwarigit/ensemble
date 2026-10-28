"use client";

import { Check, Loader2, Send, Trash2, Undo2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { RequestApprovalButton } from "@/components/request-approval-button";
import { Button } from "@/components/ui/button";
import { commitImportAction, discardImportAction } from "../../actions";

export function BatchActions({
  batchId,
  status,
  canCommit,
  toImport,
  needsApproval,
  canRequest,
  hasPendingRequest,
  where,
}: {
  batchId: string;
  status: "previewed" | "committed" | "reverted";
  canCommit: boolean;
  toImport: number;
  needsApproval: boolean;
  canRequest: boolean;
  hasPendingRequest: boolean;
  where: string;
}) {
  const [pending, startTransition] = useTransition();
  const label = `${toImport} expense${toImport === 1 ? "" : "s"}`;

  if (status === "previewed") {
    return (
      <div className="flex gap-2">
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await discardImportAction(batchId);
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
            description={`Imports over 500 rows need a project lead or workspace owner to approve them. Once approved, the ${label} are added to ${where}.`}
          >
            <Send /> {hasPendingRequest ? "Approval requested" : `Request approval to import ${label}`}
          </RequestApprovalButton>
        ) : (
          <Button
            disabled={!canCommit || pending}
            onClick={() =>
              startTransition(async () => {
                const r = await commitImportAction(batchId);
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Imported ${r.data!.inserted} expenses. Skipped ${r.data!.skipped} duplicates.`);
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
  if (status === "committed" && canRequest) {
    return (
      <RequestApprovalButton
        actionType="import.revert"
        payload={{ batchId }}
        variant="destructive"
        disabled={hasPendingRequest}
        title="Request a revert"
        description="Reverting removes every expense this import added. A project lead or workspace owner has to approve it, and both the request and the decision are recorded in the audit log."
      >
        <Undo2 /> {hasPendingRequest ? "Revert requested" : "Request revert"}
      </RequestApprovalButton>
    );
  }
  return null;
}
