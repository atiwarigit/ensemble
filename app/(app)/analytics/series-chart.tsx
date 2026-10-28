"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const COLORS = ["oklch(0.62 0.19 259)", "oklch(0.70 0.17 162)", "oklch(0.77 0.16 70)", "oklch(0.64 0.21 25)"];
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function SeriesChart({
  data,
  series,
  markers = [],
}: {
  data: Record<string, string | number | null>[];
  series: { key: string; label: string; axis?: "left" | "right" }[];
  /** Release dates etc.; shown under the chart rather than drawn, so they stay readable on small screens. */
  markers?: { date: string; label: string }[];
}) {
  const config: ChartConfig = Object.fromEntries(series.map((s, i) => [s.key, { label: s.label, color: COLORS[i % COLORS.length] }]));
  const right = series.some((s) => s.axis === "right");
  return (
    <div className="grid gap-2">
      <ChartContainer config={config} className="h-64 w-full">
        <LineChart data={data} accessibilityLayer margin={{ left: 4, right: 4 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickFormatter={shortDay} minTickGap={24} />
          <YAxis yAxisId="left" tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compact.format(Number(v))} />
          {right && <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={48} tickFormatter={(v) => compact.format(Number(v))} />}
          <ChartTooltip content={<ChartTooltipContent labelFormatter={(l) => shortDay(String(l))} />} />
          <ChartLegend content={<ChartLegendContent />} />
          {series.map((s) => (
            <Line
              key={s.key}
              yAxisId={s.axis ?? "left"}
              dataKey={s.key}
              type="monotone"
              stroke={`var(--color-${s.key})`}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ChartContainer>
      {markers.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {markers.map((m) => `${shortDay(m.date)}: ${m.label}`).join(" · ")}
        </p>
      )}
    </div>
  );
}
