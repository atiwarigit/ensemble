"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useRef, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createCategoryAction, createRuleAction, deleteRuleAction } from "../actions";
import type { Option } from "../data";

export function RuleForm({ categories }: { categories: Option[] }) {
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3"
      action={(form) =>
        startTransition(async () => {
          const r = await createRuleAction(form);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          ref.current?.reset();
        })
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="rule-field" className="text-xs">
          If
        </Label>
        <Select name="matchField" defaultValue="description">
          <SelectTrigger id="rule-field" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="description">Description</SelectItem>
            <SelectItem value="merchant">Merchant</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rule-pattern" className="text-xs">
          contains
        </Label>
        <Input id="rule-pattern" name="pattern" required minLength={2} placeholder="e.g. suno" className="w-40" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rule-category" className="text-xs">
          categorize as
        </Label>
        <Select name="categoryId">
          <SelectTrigger id="rule-category" className="w-48">
            <SelectValue placeholder="Choose category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="rule-priority" className="text-xs">
          Priority
        </Label>
        <Input id="rule-priority" name="priority" type="number" min={0} max={1000} defaultValue={100} className="w-20" />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        Add rule
      </Button>
    </form>
  );
}

export function DeleteRuleButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Delete rule"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await deleteRuleAction(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.error);
        })
      }
    >
      <Trash2 />
    </Button>
  );
}

export function CategoryForm({ parents }: { parents: Option[] }) {
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      className="grid gap-3 border-t pt-4"
      action={(form) =>
        startTransition(async () => {
          const r = await createCategoryAction(form);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          ref.current?.reset();
        })
      }
    >
      <div className="grid gap-1.5">
        <Label htmlFor="cat-name">New category</Label>
        <Input id="cat-name" name="name" required maxLength={60} placeholder="e.g. Merch" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="cat-parent">Inside</Label>
        <Select name="parentId" defaultValue="__none">
          <SelectTrigger id="cat-parent" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Top level</SelectItem>
            {parents.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox name="isGenerationCost" /> Counts as a generation cost
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Add category
      </Button>
    </form>
  );
}
