"use client";

import { Check, Loader2, Trash2, Undo2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { commitImportAction, discardImportAction, revertImportAction } from "../../actions";

export function BatchActions({
  batchId,
  status,
  canCommit,
  toImport,
  canRevert,
}: {
  batchId: string;
  status: "previewed" | "committed" | "reverted";
  canCommit: boolean;
  toImport: number;
  canRevert: boolean;
}) {
  const [pending, startTransition] = useTransition();

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
          Import {toImport} expense{toImport === 1 ? "" : "s"}
        </Button>
      </div>
    );
  }
  if (status === "committed" && canRevert) {
    return (
      <Button
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (!confirm("Revert this import? Every expense it added will be removed. This is recorded in the audit log.")) return;
          startTransition(async () => {
            const r = await revertImportAction(batchId);
            if (!r.ok) return void toast.error(r.error);
            toast.success(`Reverted. Removed ${r.data!.removed} expenses.`);
          });
        }}
      >
        {pending ? <Loader2 className="animate-spin" /> : <Undo2 />}
        Revert import
      </Button>
    );
  }
  return null;
}
