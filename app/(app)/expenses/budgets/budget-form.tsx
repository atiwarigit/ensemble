"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deleteBudgetAction, saveBudgetAction } from "../actions";
import type { Option } from "../data";

export function BudgetForm({ projects, categories }: { projects: Option[]; categories: Option[] }) {
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="grid gap-4"
      action={(form) =>
        startTransition(async () => {
          const r = await saveBudgetAction(form);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
        })
      }
    >
      <div className="grid gap-2">
        <Label htmlFor="budget-project">Project</Label>
        <Select name="projectId" defaultValue={projects[0]?.id}>
          <SelectTrigger id="budget-project" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="budget-category">Category</Label>
        <Select name="categoryId" defaultValue="__all">
          <SelectTrigger id="budget-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All spending</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-2">
          <Label htmlFor="budget-period">Period</Label>
          <Select name="period" defaultValue="month">
            <SelectTrigger id="budget-period" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="quarter">Quarterly</SelectItem>
              <SelectItem value="total">All-time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="budget-amount">Amount (USD)</Label>
          <Input id="budget-amount" name="amount" inputMode="decimal" required placeholder="500" />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="budget-alert">Alert at (% used)</Label>
        <Input id="budget-alert" name="alertAtPct" type="number" min={1} max={200} defaultValue={80} className="w-28" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Save budget
      </Button>
    </form>
  );
}

export function DeleteBudgetButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Delete budget"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await deleteBudgetAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      <Trash2 />
    </Button>
  );
}
