"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { decideApprovalAction } from "./actions";

export function DecisionControls({
  requestId,
  canApprove,
  canReject,
  isRequester,
  selfApproval,
}: {
  requestId: string;
  canApprove: boolean;
  canReject: boolean;
  isRequester: boolean;
  selfApproval: boolean;
}) {
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  if (!canApprove && !canReject) return null;

  const decide = (decision: "approve" | "reject") => {
    setBusy(decision);
    startTransition(async () => {
      const r = await decideApprovalAction(requestId, decision, note);
      setBusy(null);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
    });
  };

  return (
    <div className="grid gap-2 border-t pt-3">
      {canApprove && (
        <Textarea
          aria-label="Decision note"
          placeholder="Note for the record (optional)"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      {selfApproval && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          This is your own request. As a workspace owner you can approve it, and the audit log will mark it as self-approved.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <Button size="sm" disabled={pending} onClick={() => decide("approve")}>
            {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
            Approve
          </Button>
        )}
        {canReject && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("reject")}>
            {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />}
            {isRequester && !canApprove ? "Withdraw" : "Reject"}
          </Button>
        )}
      </div>
    </div>
  );
}
