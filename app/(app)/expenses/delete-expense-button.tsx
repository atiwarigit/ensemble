"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteExpenseAction } from "./actions";

export function DeleteExpenseButton({ id, description }: { id: string; description: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Delete ${description}`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${description}"? It stays in the audit log.`)) return;
        startTransition(async () => {
          const r = await deleteExpenseAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}
