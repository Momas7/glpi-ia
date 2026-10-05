"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Frame } from "@/components/dashboard/Charts";
import { formatInt, formatUsd } from "@/components/dashboard/format";
import { Stat } from "@/components/dashboard/Stat";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { AiUsageData } from "@/modules/dashboard/ai-metrics";

const EMPTY = "Sem execuções de IA no período";

/** Uso e custo de IA (só admin): quanto custou, o que foi chamado e quão rápido respondeu. */
export function AiUsageSection({ usage }: { usage: AiUsageData }) {
  const animate = !usePrefersReducedMotion();
  const { totals } = usage;
  const config = { costUsd: { label: "Custo (US$)", color: "var(--chart-1)" } } satisfies ChartConfig;
  const label = `Custo por dia: ${usage.costByDay.map((d) => `${d.day}: ${formatUsd(d.costUsd)}`).join("; ")}.`;
  return (
    <section aria-label="Uso e custo de IA" className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Uso e custo de IA</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Custo estimado" value={formatUsd(totals.costUsd)} hint="no período, todas as tarefas" />
        <Stat label="Chamadas" value={formatInt(totals.calls)} hint={`${formatInt(totals.inputTokens)} tokens de entrada · ${formatInt(totals.outputTokens)} de saída`} />
        <Stat label="Falhas" value={formatInt(totals.failed)} />
        <Stat label="Barradas pelo teto" value={formatInt(totals.blocked)} />
      </div>
      <Frame title="Custo por dia" label={label} empty={usage.costByDay.length === 0} emptyText={EMPTY}>
        <ChartContainer config={config} className="h-56 w-full">
          <BarChart data={usage.costByDay}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} tickLine={false} axisLine={false} />
            <YAxis width={44} tickFormatter={(v: number) => v.toFixed(2)} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="costUsd" fill="var(--color-costUsd)" radius={3} isAnimationActive={animate} />
          </BarChart>
        </ChartContainer>
      </Frame>
      <section className="flex flex-col gap-2 rounded-lg border border-white/10 p-4">
        <h3 className="text-sm font-medium">Por tarefa</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tarefa</TableHead>
              <TableHead>Chamadas</TableHead>
              <TableHead>Falhas</TableHead>
              <TableHead>Barradas</TableHead>
              <TableHead>Tokens (entrada/saída)</TableHead>
              <TableHead>Custo</TableHead>
              <TableHead>Latência p50 (ms)</TableHead>
              <TableHead>Latência p95 (ms)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usage.byTask.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  {EMPTY}
                </TableCell>
              </TableRow>
            )}
            {usage.byTask.map((t) => (
              <TableRow key={t.jobType}>
                <TableCell>{t.jobType}</TableCell>
                <TableCell>{t.calls}</TableCell>
                <TableCell>{t.failed}</TableCell>
                <TableCell>{t.blocked}</TableCell>
                <TableCell>
                  {t.inputTokens} / {t.outputTokens}
                </TableCell>
                <TableCell>{formatUsd(t.costUsd)}</TableCell>
                <TableCell>{t.p50Ms ?? "—"}</TableCell>
                <TableCell>{t.p95Ms ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </section>
  );
}
