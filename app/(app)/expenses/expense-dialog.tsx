"use client";

import { Loader2, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Option } from "./data";
import { saveExpenseAction } from "./actions";

export type ExpenseFormValues = {
  id: string;
  date: string;
  amount: string;
  merchant: string | null;
  description: string;
  categoryId: string | null;
  projectId: string | null;
  paymentAccount: string | null;
  notes: string | null;
};

export function ExpenseDialog({
  projects,
  categories,
  expense,
  defaultProjectId,
}: {
  projects: Option[];
  categories: Option[];
  expense?: ExpenseFormValues;
  defaultProjectId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {expense ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${expense.description}`}>
            <Pencil />
          </Button>
        ) : (
          <Button>
            <Plus /> Add expense
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          className="grid gap-5"
          action={(form) =>
            startTransition(async () => {
              const r = await saveExpenseAction(expense?.id ?? null, form);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              setOpen(false);
            })
          }
        >
          <DialogHeader>
            <DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
            <DialogDescription>Amounts are in USD.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="exp-date">Date</Label>
              <Input id="exp-date" name="date" type="date" required defaultValue={expense?.date ?? today} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exp-amount">Amount (USD)</Label>
              <Input
                id="exp-amount"
                name="amount"
                inputMode="decimal"
                required
                placeholder="29.99"
                defaultValue={expense?.amount}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="exp-description">Description</Label>
              <Input id="exp-description" name="description" required maxLength={300} defaultValue={expense?.description} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exp-merchant">Merchant</Label>
              <Input id="exp-merchant" name="merchant" maxLength={120} defaultValue={expense?.merchant ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exp-account">Paid with</Label>
              <Input
                id="exp-account"
                name="paymentAccount"
                maxLength={40}
                placeholder="Amex ••1007"
                defaultValue={expense?.paymentAccount ?? ""}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exp-project">Project</Label>
              <Select name="projectId" defaultValue={expense ? (expense.projectId ?? "personal") : (defaultProjectId ?? "personal")}>
                <SelectTrigger id="exp-project" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal / unallocated</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="exp-category">Category</Label>
              <Select name="categoryId" defaultValue={expense?.categoryId ?? "__none"}>
                <SelectTrigger id="exp-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Uncategorized</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="exp-notes">Notes</Label>
              <Textarea id="exp-notes" name="notes" rows={2} maxLength={2000} defaultValue={expense?.notes ?? ""} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {expense ? "Save" : "Add expense"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
