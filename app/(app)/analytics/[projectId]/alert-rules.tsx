"use client";

import { Loader2, Save } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAlertRuleAction } from "../actions";

export type RuleView = {
  id: string;
  kind: string;
  label: string;
  source: string;
  description: string;
  enabled: boolean;
  params: { threshold?: number; days?: number; step?: number };
  fields: ("threshold" | "days" | "step")[];
  lastFiredAt: string | null;
  unavailable: string | null;
};

const FIELD_LABEL = { threshold: "Threshold", days: "Days", step: "Every" } as const;
const FIELD_UNIT: Record<string, Partial<Record<"threshold" | "days" | "step", string>>> = {
  streams_change: { threshold: "%" },
  popularity_change: { threshold: "points" },
  follower_milestone: { step: "followers" },
};

function RuleRow({ projectId, rule, canEdit }: { projectId: string; rule: RuleView; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [params, setParams] = useState(rule.params);
  const [pending, startTransition] = useTransition();
  const dirty = enabled !== rule.enabled || rule.fields.some((f) => params[f] !== rule.params[f]);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b py-3 last:border-0" data-testid="alert-rule" data-kind={rule.kind}>
      <div className="flex min-w-64 flex-1 items-start gap-2">
        <Checkbox
          id={`rule-${rule.id}`}
          checked={enabled}
          disabled={!canEdit}
          onCheckedChange={(v) => setEnabled(v === true)}
          aria-label={`${rule.label} enabled`}
        />
        <div className="grid gap-0.5">
          <Label htmlFor={`rule-${rule.id}`} className="font-medium">
            {rule.label} <Badge variant="outline" className="font-normal">{rule.source}</Badge>
          </Label>
          <p className="text-xs text-muted-foreground">{rule.description}</p>
          {rule.unavailable && <p className="text-xs text-amber-700 dark:text-amber-400">{rule.unavailable}</p>}
        </div>
      </div>
      {rule.fields.map((f) => (
        <div key={f} className="flex items-center gap-1.5 text-sm">
          <Label htmlFor={`${rule.id}-${f}`} className="text-muted-foreground">
            {FIELD_LABEL[f]}
          </Label>
          <Input
            id={`${rule.id}-${f}`}
            type="number"
            className="h-8 w-24"
            value={params[f] ?? ""}
            disabled={!canEdit}
            onChange={(e) => setParams({ ...params, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
          {FIELD_UNIT[rule.kind]?.[f] && <span className="text-muted-foreground">{FIELD_UNIT[rule.kind][f]}</span>}
        </div>
      ))}
      {canEdit && (
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || pending}
          onClick={() =>
            startTransition(async () => {
              const r = await updateAlertRuleAction(projectId, rule.id, { enabled, ...params });
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.data?.alerts ? `Alert saved. ${r.data.alerts} new notification(s).` : "Alert saved.");
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
      )}
    </div>
  );
}

export function AlertRules({ projectId, rules, canEdit }: { projectId: string; rules: RuleView[]; canEdit: boolean }) {
  return (
    <div>
      {rules.map((r) => (
        <RuleRow key={`${r.id}-${r.enabled}-${JSON.stringify(r.params)}`} projectId={projectId} rule={r} canEdit={canEdit} />
      ))}
    </div>
  );
}
