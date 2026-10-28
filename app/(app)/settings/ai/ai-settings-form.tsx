"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RequestApprovalButton } from "@/components/request-approval-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { LlmPreference } from "@/db/schema/tenancy";
import { lowerBudgetAction, setPreferenceAction } from "./actions";

const OPTIONS: { value: LlmPreference; label: string }[] = [
  { value: "auto", label: "Automatic (Anthropic, then OpenAI)" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai", label: "OpenAI" },
  { value: "off", label: "Off — commands only" },
];

export function PreferenceForm({ pref, configured }: { pref: LlmPreference; configured: { anthropic: boolean; openai: boolean } }) {
  const [value, setValue] = useState(pref);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="llm-pref">Provider</Label>
        <Select value={value} onValueChange={(v) => setValue(v as LlmPreference)}>
          <SelectTrigger id="llm-pref" className="w-72" aria-label="Provider">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} disabled={(o.value === "anthropic" || o.value === "openai") && !configured[o.value]}>
                {o.label}
                {(o.value === "anthropic" || o.value === "openai") && !configured[o.value] ? " (no key)" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        disabled={pending || value === pref}
        onClick={() =>
          start(async () => {
            const r = await setPreferenceAction(value);
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            router.refresh();
          })
        }
      >
        {pending && <Loader2 className="animate-spin" />}
        Save provider
      </Button>
    </div>
  );
}

export function BudgetForm({ budgetUsd, canLower }: { budgetUsd: number; canLower: boolean }) {
  const [value, setValue] = useState(String(budgetUsd));
  const [pending, start] = useTransition();
  const router = useRouter();
  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="llm-budget">Monthly budget (USD)</Label>
        <Input id="llm-budget" inputMode="decimal" className="w-40" value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      {valid && n > budgetUsd ? (
        <RequestApprovalButton
          actionType="llm.budget.raise"
          payload={{ usd: n }}
          title={`Raise the AI budget to $${n}?`}
          description="Raising the budget needs a workspace owner's approval. It takes effect once approved."
        >
          Request increase
        </RequestApprovalButton>
      ) : (
        <Button
          variant="outline"
          disabled={!canLower || pending || !valid || n === budgetUsd}
          onClick={() =>
            start(async () => {
              const r = await lowerBudgetAction(n);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              router.refresh();
            })
          }
        >
          Lower budget
        </Button>
      )}
    </div>
  );
}
