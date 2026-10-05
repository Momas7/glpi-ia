import { formatPercent } from "@/components/dashboard/format";
import { Stat } from "@/components/dashboard/Stat";
import type { AiAssistData } from "@/modules/dashboard/ai-metrics";

/** O que a IA fez no atendimento da equipe e o que as pessoas decidiram sobre as sugestões. */
export function AiAssistSection({ data }: { data: AiAssistData }) {
  const t = data.triage;
  return (
    <section aria-label="IA no atendimento" className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">IA no atendimento</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Triagem aceita" value={formatPercent(t.acceptRate)} hint={`${t.suggested} sugestões · ${t.accepted} aceitas, ${t.edited} editadas, ${t.rejected} rejeitadas, ${t.pending} pendentes`} />
        <Stat label="Rascunhos de resposta" value={String(data.drafts.generated)} hint={`${data.drafts.generated} gerados · ${data.drafts.published} publicados`} />
        <Stat label="Possíveis duplicados" value={String(data.duplicates.suggested)} hint={`${data.duplicates.suggested} sugeridos · ${data.duplicates.dismissed} ignorados`} />
        <Stat label="Resumos e incidentes" value={String(data.summaries + data.incidents)} hint={`${data.summaries} resumos · ${data.incidents} incidentes`} />
      </div>
      <p className="text-xs text-muted-foreground">
        Aceite = sugestões aceitas ou editadas entre as já decididas. Mostra o que a equipe decidiu, não a verdade absoluta.
      </p>
    </section>
  );
}
