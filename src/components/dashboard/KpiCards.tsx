"use client";

import CountUp from "@/components/bits/CountUp";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatBusinessDuration } from "@/modules/sla/state";

export interface KpiData {
  openNow: number;
  openUnassigned: number;
  atRisk: number;
  breached: number;
  slaPercent: number | null;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
}

function Number_({ value, suffix = "", animate }: { value: number; suffix?: string; animate: boolean }) {
  return (
    <span className="text-3xl font-semibold tabular-nums">
      {animate ? <CountUp to={value} duration={1} /> : value}
      {suffix}
    </span>
  );
}

function Card({ title, children, hint, tone }: { title: string; children: React.ReactNode; hint?: string; tone?: string }) {
  return (
    <div role="group" aria-label={title} className={`flex flex-col gap-1 rounded-lg border border-white/10 p-4 ${tone ?? ""}`}>
      <span className="text-xs text-muted-foreground">{title}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

const timeText = (minutes: number | null) => (minutes === null ? "—" : formatBusinessDuration(minutes));

/** Cartões do topo. Números animados (React Bits), estáticos com prefers-reduced-motion; sem dado mostra "—". */
export function KpiCards({ kpis }: { kpis: KpiData }) {
  const animate = !usePrefersReducedMotion();
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Card title="Abertos agora" hint={`${kpis.openUnassigned} sem responsável`}>
        <Number_ value={kpis.openNow} animate={animate} />
      </Card>
      <Card title="Em risco" tone={kpis.atRisk > 0 ? "border-amber-500/40" : ""}>
        <Number_ value={kpis.atRisk} animate={animate} />
      </Card>
      <Card title="Vencidos" tone={kpis.breached > 0 ? "border-red-500/40" : ""}>
        <Number_ value={kpis.breached} animate={animate} />
      </Card>
      <Card title="No SLA" hint="resolvidos dentro do prazo no período">
        {kpis.slaPercent === null ? (
          <span className="text-3xl font-semibold">—</span>
        ) : (
          <Number_ value={kpis.slaPercent} suffix="%" animate={animate} />
        )}
      </Card>
      <Card title="1ª resposta (média)" hint="horas úteis">
        <span className="text-2xl font-semibold">{timeText(kpis.avgFirstResponseMinutes)}</span>
      </Card>
      <Card title="Resolução (média)" hint="horas úteis">
        <span className="text-2xl font-semibold">{timeText(kpis.avgResolutionMinutes)}</span>
      </Card>
    </div>
  );
}
