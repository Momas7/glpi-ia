import { Badge } from "@/components/ui/badge";
import { formatBusinessDuration, type SlaStateName } from "@/modules/sla/state";

const STYLE: Record<string, string> = {
  ok: "bg-emerald-500/15 text-emerald-300",
  at_risk: "bg-amber-500/20 text-amber-300",
  breached: "bg-red-500/20 text-red-300",
  paused: "bg-zinc-500/20 text-zinc-300",
};

/** Prazo de resolução do chamado. Nada para chamados sem prazo ou já encerrados. */
export function SlaBadge({ state, remainingMinutes }: { state: SlaStateName; remainingMinutes: number | null }) {
  if (state === "none" || state === "done") return null;
  // Fora do expediente o tempo útil não anda: um prazo vencido às 18h fica "0 min" até o dia útil seguinte.
  const minutes = Math.abs(Math.round(remainingMinutes ?? 0));
  const text =
    state === "paused"
      ? "Pausado"
      : state === "breached"
        ? minutes === 0
          ? "Vencido"
          : `Vencido há ${formatBusinessDuration(minutes)}`
        : `${state === "at_risk" ? "Em risco" : "Em dia"} · ${minutes === 0 ? "vence agora" : `vence em ${formatBusinessDuration(minutes)}`}`;
  return (
    <Badge variant="outline" className={`border-0 ${STYLE[state]}`}>
      {text}
    </Badge>
  );
}
