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
  const text =
    state === "paused"
      ? "Pausado"
      : state === "breached"
        ? `Vencido há ${formatBusinessDuration(remainingMinutes ?? 0)}`
        : `${state === "at_risk" ? "Em risco" : "Em dia"} · vence em ${formatBusinessDuration(remainingMinutes ?? 0)}`;
  return (
    <Badge variant="outline" className={`border-0 ${STYLE[state]}`}>
      {text}
    </Badge>
  );
}
