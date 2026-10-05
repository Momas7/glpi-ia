"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Frame } from "@/components/dashboard/Charts";
import { formatAverage, formatInt } from "@/components/dashboard/format";
import { Stat } from "@/components/dashboard/Stat";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { CsatData } from "@/modules/dashboard/ai-metrics";

const EMPTY = "Sem avaliações no período";

/** Satisfação dos solicitantes: nota média, distribuição de 1 a 5 estrelas e tendência por mês. */
export function CsatSection({ csat }: { csat: CsatData }) {
  const animate = !usePrefersReducedMotion();
  const distLabel = `Distribuição das notas: ${csat.distribution.map((d) => `${d.stars} ${d.stars === 1 ? "estrela" : "estrelas"}: ${d.count}`).join("; ")}.`;
  const trendLabel = `Nota média por mês: ${csat.trend.map((t) => `${t.month}: ${t.average === null ? "sem avaliações" : formatAverage(t.average)} (${t.count} avaliações)`).join("; ")}.`;
  const distConfig = { count: { label: "Avaliações", color: "var(--chart-1)" } } satisfies ChartConfig;
  const trendConfig = { average: { label: "Nota média", color: "var(--chart-2)" } } satisfies ChartConfig;
  return (
    <section aria-label="Satisfação" className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Satisfação</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Nota média" value={formatAverage(csat.average)} hint="de 1 a 5 estrelas" />
        <Stat label="Avaliações" value={formatInt(csat.count)} hint="no período" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Frame title="Distribuição das notas" label={distLabel} empty={csat.count === 0} emptyText={EMPTY}>
          <ChartContainer config={distConfig} className="h-56 w-full">
            <BarChart data={csat.distribution.map((d) => ({ ...d, name: `${d.stars}★` }))}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="count" fill="var(--color-count)" radius={3} isAnimationActive={animate} />
            </BarChart>
          </ChartContainer>
        </Frame>
        <Frame title="Nota média por mês" label={trendLabel} empty={csat.trend.every((t) => t.count === 0)} emptyText={EMPTY}>
          <ChartContainer config={trendConfig} className="h-56 w-full">
            <LineChart data={csat.trend}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="month" tickFormatter={(m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`} tickLine={false} axisLine={false} />
              <YAxis domain={[1, 5]} width={28} tickLine={false} axisLine={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line dataKey="average" stroke="var(--color-average)" strokeWidth={2} dot connectNulls isAnimationActive={animate} />
            </LineChart>
          </ChartContainer>
        </Frame>
      </div>
    </section>
  );
}
