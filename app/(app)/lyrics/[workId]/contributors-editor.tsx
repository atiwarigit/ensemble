"use client";

import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { saveContributorsAction } from "../actions";
import { ROLE_LABEL } from "./labels";

type Role = keyof typeof ROLE_LABEL;
type Row = { name: string; userId: string | null; role: Role; sharePct: number; human: boolean };

export function ContributorsEditor({
  workId,
  editable,
  initial,
  members,
}: {
  workId: string;
  editable: boolean;
  initial: Row[];
  members: { id: string; name: string }[];
}) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [pending, startTransition] = useTransition();
  const total = Math.round(rows.reduce((s, r) => s + (Number(r.sharePct) || 0), 0) * 100) / 100;
  const normalize = (rs: Row[]) => JSON.stringify(rs.map((r) => ({ ...r, sharePct: Number(r.sharePct) })));
  const dirty = normalize(rows) !== normalize(initial);
  const unlisted = members.filter((m) => !rows.some((r) => r.userId === m.id));

  if (!editable) {
    return (
      <ul className="grid gap-2 text-sm" data-testid="contributors">
        {initial.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-2">
            <span>
              {r.name} <span className="text-muted-foreground">· {ROLE_LABEL[r.role]}</span>
              {!r.human && <Badge variant="outline" className="ml-1">Not human</Badge>}
            </span>
            <span className="tabular-nums">{r.sharePct}%</span>
          </li>
        ))}
      </ul>
    );
  }

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="grid gap-3" data-testid="contributors">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-md border p-2">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Contributor ${i + 1} name`}
              value={r.name}
              onChange={(e) => update(i, { name: e.target.value })}
              disabled={!!r.userId}
              className="h-8"
            />
            <Button variant="ghost" size="icon-xs" aria-label={`Remove ${r.name || "contributor"}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              <Trash2 />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Select value={r.role} onValueChange={(v) => update(i, { role: v as Role })}>
              <SelectTrigger size="sm" className="w-28" aria-label={`Contributor ${i + 1} role`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ROLE_LABEL).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-20">
              <Input
                aria-label={`Contributor ${i + 1} share`}
                inputMode="decimal"
                value={String(r.sharePct)}
                onChange={(e) => update(i, { sharePct: e.target.value as unknown as number })}
                className="h-8 pr-6 text-right tabular-nums"
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
            </div>
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={r.human} onCheckedChange={(v) => update(i, { human: v === true })} />
              Human
            </label>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {unlisted.length > 0 && (
          <Select
            value=""
            onValueChange={(id) => {
              const m = members.find((x) => x.id === id);
              if (m) setRows((rs) => [...rs, { name: m.name, userId: m.id, role: "co-writer", sharePct: 0, human: true }]);
            }}
          >
            <SelectTrigger size="sm" className="w-auto" aria-label="Add a project member">
              <SelectValue placeholder="Add a member" />
            </SelectTrigger>
            <SelectContent>
              {unlisted.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows((rs) => [...rs, { name: "", userId: null, role: "co-writer", sharePct: 0, human: true }])}
        >
          <Plus /> Outside writer
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2 border-t pt-3">
        <span className={cn("text-sm tabular-nums", total !== 100 && "text-destructive")} data-testid="share-total">
          Total {total}%
        </span>
        <Button
          size="sm"
          disabled={!dirty || pending}
          onClick={() =>
            startTransition(async () => {
              const r = await saveContributorsAction(workId, rows);
              if (r.ok) toast.success(r.message);
              else toast.error(r.error);
            })
          }
        >
          {pending && <Loader2 className="animate-spin" />}
          Save split
        </Button>
      </div>
    </div>
  );
}
