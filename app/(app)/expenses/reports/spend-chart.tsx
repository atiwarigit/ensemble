"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// Categorical palette: the theme's --chart-* tokens are grayscale, which makes stacked categories unreadable.
const COLORS = [
  "oklch(0.62 0.19 259)",
  "oklch(0.70 0.17 162)",
  "oklch(0.77 0.16 70)",
  "oklch(0.64 0.21 25)",
  "oklch(0.60 0.22 300)",
  "oklch(0.72 0.12 210)",
  "oklch(0.66 0.15 130)",
  "oklch(0.70 0.02 260)",
];

export function SpendChart({
  data,
  series,
}: {
  data: Record<string, string | number>[];
  series: { key: string; label: string }[];
}) {
  const config: ChartConfig = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: COLORS[i % COLORS.length] }]),
  );
  return (
    <ChartContainer config={config} className="h-72 w-full">
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={60} tickFormatter={(v) => `$${Math.round(Number(v))}`} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{config[name as string]?.label ?? name}</span>
                  <span className="font-mono tabular-nums">${Number(value).toFixed(2)}</span>
                </div>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="spend"
            fill={`var(--color-${s.key})`}
            radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
          />
        ))}
      </BarChart>
    </ChartContainer>
  );
}
