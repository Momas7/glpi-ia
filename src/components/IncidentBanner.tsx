import Link from "next/link";

/** Faixa no topo para líder e admin enquanto houver incidente em andamento. Mostra o mais recente e quantos mais. */
export function IncidentBanner({ incidents }: { incidents: { id: string; title: string; ticketCount: number }[] }) {
  if (incidents.length === 0) return null;
  const [first, ...rest] = incidents;
  return (
    <div role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm">
      <strong>Incidente em andamento:</strong>
      <span>{first.ticketCount} chamados parecidos —</span>
      <Link href="/incidentes" className="font-medium underline underline-offset-4">
        {first.title}
      </Link>
      {rest.length > 0 && <span className="text-muted-foreground">e mais {rest.length}</span>}
    </div>
  );
}
