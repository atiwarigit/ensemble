import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatDate, formatMoney } from "@/lib/format";
import type { BudgetStatus } from "@/lib/services/expenses";
import { cn } from "@/lib/utils";

const PERIOD_LABEL = { month: "Monthly", quarter: "Quarterly", total: "All-time" } as const;

export function BudgetList({
  budgets,
  showProject = true,
  actions,
}: {
  budgets: BudgetStatus[];
  showProject?: boolean;
  actions?: (b: BudgetStatus) => React.ReactNode;
}) {
  if (!budgets.length) return <p className="text-sm text-muted-foreground">No budgets set.</p>;
  return (
    <ul className="grid gap-4">
      {budgets.map((b) => (
        <li key={b.id} className="grid gap-2" data-testid="budget" data-state={b.state}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2">
              {showProject && <span className="font-medium">{b.projectName}</span>}
              <span className={showProject ? "text-muted-foreground" : "font-medium"}>{b.categoryName}</span>
              <Badge variant="outline">{PERIOD_LABEL[b.period]}</Badge>
              {b.state !== "ok" && (
                <Badge variant="destructive">
                  <AlertTriangle /> {b.state === "over" ? "Over budget" : `Above ${b.alertAtPct}%`}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="tabular-nums">
                {formatMoney(b.spentMinor)} <span className="text-muted-foreground">of {formatMoney(b.amountMinor)}</span>{" "}
                <span className={cn("font-medium", b.state !== "ok" && "text-destructive")}>({b.pct}%)</span>
              </span>
              {actions?.(b)}
            </div>
          </div>
          <Progress
            value={Math.min(b.pct, 100)}
            className={cn(b.state === "over" && "[&>*]:bg-destructive", b.state === "warning" && "[&>*]:bg-amber-500")}
            aria-label={`${b.categoryName} budget used`}
          />
          {b.period !== "total" && (
            <p className="text-xs text-muted-foreground">
              {formatDate(b.range.start)} – {formatDate(new Date(new Date(b.range.end).getTime() - 86_400_000))}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
