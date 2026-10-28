"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";

type Row = {
  line: number;
  status: "ok" | "duplicate" | "credit" | "transfer" | "error";
  errors: string[];
  date: string | null;
  amountMinor: number | null;
  description: string;
  account: string | null;
  category: string | null;
  categorySource: "rule" | "file" | null;
};

const STATUS: Record<Row["status"], { label: string; variant: "secondary" | "outline" | "destructive" | "default" }> = {
  ok: { label: "New", variant: "default" },
  duplicate: { label: "Duplicate", variant: "outline" },
  credit: { label: "Credit / refund", variant: "outline" },
  transfer: { label: "Transfer", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
};

const PAGE = 50;

export function PreviewTable({ rows }: { rows: Row[] }) {
  const [filter, setFilter] = useState<"all" | Row["status"]>("all");
  const [limit, setLimit] = useState(PAGE);
  const visible = rows.filter((r) => filter === "all" || r.status === filter);
  const counts = rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {(["all", "ok", "duplicate", "credit", "transfer", "error"] as const).map((s) =>
          s === "all" || counts[s] ? (
            <Button key={s} size="xs" variant={filter === s ? "secondary" : "ghost"} onClick={() => setFilter(s)}>
              {s === "all" ? `All (${rows.length})` : `${STATUS[s].label} (${counts[s]})`}
            </Button>
          ) : null,
        )}
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-14">Line</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.slice(0, limit).map((r) => (
              <TableRow key={r.line} data-testid="preview-row" data-status={r.status} className={r.status !== "ok" ? "text-muted-foreground" : undefined}>
                <TableCell className="font-mono text-xs">{r.line}</TableCell>
                <TableCell>
                  <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
                  {r.errors.length > 0 && <div className="mt-1 text-xs text-destructive">{r.errors.join("; ")}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap">{r.date ? formatDate(r.date) : "—"}</TableCell>
                <TableCell>
                  {r.description || "—"}
                  {r.account && <div className="text-xs text-muted-foreground">{r.account}</div>}
                </TableCell>
                <TableCell>
                  {r.category ? (
                    <span className="inline-flex items-center gap-1">
                      {r.category}
                      <span className="text-[10px] text-muted-foreground uppercase">{r.categorySource}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Uncategorized</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.amountMinor !== null ? formatMoney(r.amountMinor) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {visible.length > limit && (
        <Button variant="outline" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({visible.length - limit} remaining)
        </Button>
      )}
    </div>
  );
}
