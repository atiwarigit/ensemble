"use client";

import { Loader2, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { requestApprovalAction } from "@/app/(app)/approvals/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApprovalActionType } from "@/lib/services/approvals";

export function RequestApprovalButton({
  actionType,
  payload,
  title,
  description,
  children,
  variant = "default",
  size,
  disabled,
  onRequested,
}: {
  actionType: ApprovalActionType;
  payload: unknown;
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  disabled?: boolean;
  onRequested?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size={size} disabled={disabled}>
          {children}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="approval-reason">Reason (optional)</Label>
          <Textarea id="approval-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} />
          <p className="text-xs text-muted-foreground">Requests expire after 7 days if nobody decides.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await requestApprovalAction(actionType, payload, reason);
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message);
                setOpen(false);
                setReason("");
                onRequested?.();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
