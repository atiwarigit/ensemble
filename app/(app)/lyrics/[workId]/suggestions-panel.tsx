"use client";

import { diffLines } from "diff";
import { Check, Loader2, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { acceptSuggestionAction, dismissSuggestionAction } from "../actions";

export type SuggestionRow = {
  id: string;
  kind: string;
  kindLabel: string;
  status: "open" | "accepted" | "dismissed";
  suggestion: string;
  rationale: string | null;
  provider: string;
  model: string;
  baseVersionNo: number;
  baseBody: string;
  requestedByName: string | null;
  createdAt: string;
  stale: boolean;
};

function Diff({ from, to }: { from: string; to: string }) {
  const parts = diffLines(`${from}\n`, `${to}\n`);
  return (
    <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap" data-testid="suggestion-diff">
      {parts.map((p, i) => (
        <span
          key={i}
          data-change={p.added ? "added" : p.removed ? "removed" : undefined}
          className={cn(
            "block border-l-2 pl-2",
            p.added && "border-emerald-500 bg-emerald-500/10",
            p.removed && "border-red-500 bg-red-500/10 text-muted-foreground line-through",
            !p.added && !p.removed && "border-transparent",
          )}
        >
          {p.value.replace(/\n$/, "")}
        </span>
      ))}
    </pre>
  );
}

function OpenSuggestion({ workId, row, canEdit }: { workId: string; row: SuggestionRow; canEdit: boolean }) {
  const [body, setBody] = useState(row.suggestion);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const editable = canEdit && !row.stale;
  return (
    <div className="grid gap-3">
      <Diff from={row.baseBody} to={body} />
      {row.stale && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          The lyrics changed after this suggestion was made, so it can only be dismissed.
        </p>
      )}
      {editable && (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={`suggestion-body-${row.id}`}>Edit before accepting</Label>
            <Textarea
              id={`suggestion-body-${row.id}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={Math.min(16, body.split("\n").length + 1)}
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`suggestion-note-${row.id}`}>Change note (optional)</Label>
            <Input id={`suggestion-note-${row.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
        </>
      )}
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {editable && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await acceptSuggestionAction(row.id, workId, body, note);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Accept as v{row.baseVersionNo + 1}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await dismissSuggestionAction(row.id, workId);
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message);
              })
            }
          >
            <X /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

const STATUS_VARIANT = { open: "default", accepted: "secondary", dismissed: "outline" } as const;

export function SuggestionsPanel({ workId, rows, canEdit }: { workId: string; rows: SuggestionRow[]; canEdit: boolean }) {
  return (
    <ul className="grid gap-4">
      {rows.map((row) => (
        <li key={row.id} className="grid gap-3 rounded-md border p-4" data-testid="suggestion" data-status={row.status}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{row.kindLabel}</Badge>
              <span className="text-sm text-muted-foreground">
                Based on v{row.baseVersionNo} · {row.provider} ({row.model}) · asked by {row.requestedByName ?? "—"} ·{" "}
                {row.createdAt}
              </span>
            </div>
            <Badge variant={STATUS_VARIANT[row.status]} className="capitalize">
              {row.status}
            </Badge>
          </div>
          {row.rationale && <p className="text-sm">{row.rationale}</p>}
          {row.status === "open" ? (
            <OpenSuggestion workId={workId} row={row} canEdit={canEdit} />
          ) : (
            <details>
              <summary className="cursor-pointer text-sm text-muted-foreground">Show suggested text</summary>
              <div className="mt-2">
                <Diff from={row.baseBody} to={row.suggestion} />
              </div>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
