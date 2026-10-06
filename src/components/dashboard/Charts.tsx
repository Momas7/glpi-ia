"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { CategoryRow, TeamSlaRow, TrendRow, WeeklyRow } from "@/modules/dashboard/queries";

const EMPTY = "Sem dados no período";

export function Frame({ title, label, empty, emptyText = EMPTY, children }: { title: string; label: string; empty: boolean; emptyText?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-white/10 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {empty ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <div role="img" aria-label={label}>
          {children}
        </div>
      )}
    </section>
  );
}

const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;

export function WeeklyChart({ data }: { data: WeeklyRow[] }) {
  const animate = !usePrefersReducedMotion();
  const created = data.reduce((n, d) => n + d.created, 0);
  const resolved = data.reduce((n, d) => n + d.resolved, 0);
  const config = { created: { label: "Criados", color: "var(--chart-1)" }, resolved: { label: "Resolvidos", color: "var(--chart-2)" } } satisfies ChartConfig;
  return (
    <Frame title="Criados × resolvidos por semana" label={`Chamados por semana: ${created} criados e ${resolved} resolvidos no período.`} empty={created + resolved === 0}>
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="weekStart" tickFormatter={shortDate} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar dataKey="created" fill="var(--color-created)" radius={3} isAnimationActive={animate} />
          <Bar dataKey="resolved" fill="var(--color-resolved)" radius={3} isAnimationActive={animate} />
        </BarChart>
      </ChartContainer>
    </Frame>
  );
}

export function CategoryChart({ data }: { data: CategoryRow[] }) {
  const animate = !usePrefersReducedMotion();
  const config = { count: { label: "Chamados", color: "var(--chart-1)" } } satisfies ChartConfig;
  return (
    <Frame title="Volume por categoria" label={`Chamados por categoria: ${data.map((d) => `${d.category}: ${d.count}`).join("; ")}.`} empty={data.length === 0}>
      <ChartContainer config={config} className="w-full" style={{ height: Math.max(120, data.length * 36 + 24) }}>
        <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="category" width={110} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="count" fill="var(--color-count)" radius={3} isAnimationActive={animate} />
        </BarChart>
      </ChartContainer>
    </Frame>
  );
}

export function TeamSlaChart({ data }: { data: TeamSlaRow[] }) {
  const animate = !usePrefersReducedMotion();
  const config = { percent: { label: "% no SLA", color: "var(--chart-2)" } } satisfies ChartConfig;
  const hasData = data.some((d) => d.percent !== null);
  return (
    <Frame
      title="% no SLA por equipe"
      label={`Percentual no SLA por equipe: ${data.map((d) => (d.percent === null ? `${d.team}: sem dados` : `${d.team}: ${d.percent}%`)).join("; ")}.`}
      empty={!hasData}
    >
      <ChartContainer config={config} className="h-56 w-full">
        <BarChart data={data.map((d) => ({ ...d, percent: d.percent ?? 0 }))}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="team" tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} width={44} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="percent" fill="var(--color-percent)" radius={3} isAnimationActive={animate} />
        </BarChart>
      </ChartContainer>
    </Frame>
  );
}

export function TrendChart({ data }: { data: TrendRow[] }) {
  const animate = !usePrefersReducedMotion();
  const config = { created: { label: "Chamados", color: "var(--chart-1)" }, slaPercent: { label: "% no SLA", color: "var(--chart-2)" } } satisfies ChartConfig;
  const hasData = data.some((d) => d.created > 0 || d.slaPercent !== null);
  const label = `Tendência dos últimos ${data.length} meses: ${data
    .map((d) => `${d.month}: ${d.created} chamados${d.slaPercent === null ? "" : `, ${d.slaPercent}% no SLA`}`)
    .join("; ")}.`;
  return (
    <Frame title="Tendência (6 meses)" label={label} empty={!hasData}>
      <ChartContainer config={config} className="h-56 w-full">
        <ComposedChart data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="month" tickFormatter={monthLabel} tickLine={false} axisLine={false} />
          <YAxis yAxisId="left" allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <YAxis yAxisId="right" orientation="right" domain={[0, 100]} width={44} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend content={<ChartLegendContent />} />
          <Bar yAxisId="left" dataKey="created" fill="var(--color-created)" radius={3} isAnimationActive={animate} />
          <Line yAxisId="right" dataKey="slaPercent" stroke="var(--color-slaPercent)" strokeWidth={2} dot connectNulls isAnimationActive={animate} />
        </ComposedChart>
      </ChartContainer>
    </Frame>
  );
}
