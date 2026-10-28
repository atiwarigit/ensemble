"use client";

import { CheckCheck, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markReadAction } from "../analytics/actions";

export function MarkReadButton({ ids, label = "Mark all read" }: { ids: string[] | "all"; label?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant={ids === "all" ? "outline" : "ghost"}
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await markReadAction(ids);
          if (!r.ok) toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} {label}
    </Button>
  );
}
