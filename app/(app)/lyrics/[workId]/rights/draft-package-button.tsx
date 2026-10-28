"use client";

import { FilePlus2, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { generateDraftPackageAction } from "../../actions";

export function DraftPackageButton({ workId }: { workId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await generateDraftPackageAction(workId);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <FilePlus2 />}
      Generate draft package
    </Button>
  );
}
