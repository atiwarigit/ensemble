"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { runSnapshotAction } from "../actions";

export function SnapshotButton({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const r = await runSnapshotAction(projectId);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run snapshot now
    </Button>
  );
}
