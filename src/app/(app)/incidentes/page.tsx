import Link from "next/link";
import { notFound } from "next/navigation";
import { CloseIncidentButton } from "@/components/forms/CloseIncidentButton";
import { StatusBadge } from "@/components/StatusBadges";
import { formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { listIncidents, type IncidentRow } from "@/modules/ai";
import { can } from "@/modules/auth";

export const metadata = { title: "Incidentes · Sentinela" };

function IncidentCard({ incident, closable }: { incident: IncidentRow; closable: boolean }) {
  const hidden = incident.ticketCount - incident.tickets.length;
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-white/10 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{incident.title}</h3>
          <p className="text-xs text-muted-foreground">
            {incident.ticketCount} chamados · detectado em {formatDateTime(incident.detectedAt)}
            {incident.closedAt && ` · encerrado em ${formatDateTime(incident.closedAt)}`}
          </p>
        </div>
        {closable && <CloseIncidentButton id={incident.id} />}
      </header>
      <ul className="flex flex-col gap-1 text-sm">
        {incident.tickets.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2">
            <Link href={`/tickets/${t.id}`} className="underline underline-offset-4">
              #{t.number} · {t.title}
            </Link>
            <StatusBadge status={t.status} />
            {t.teamName && <span className="text-xs text-muted-foreground">{t.teamName}</span>}
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="text-xs text-muted-foreground">e mais {hidden} chamados de outras equipes.</p>}
    </article>
  );
}

export default async function IncidentsPage() {
  const user = await requireUser();
  if (!can(user, "incident:view")) notFound();
  const { open, recentClosed } = await listIncidents(user);
  const closable = can(user, "incident:close");

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold">Incidentes</h1>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Quando muitos chamados parecidos chegam juntos, o sistema os agrupa aqui e avisa o n8n. O agrupamento fecha sozinho quando todos os
        chamados terminam.
      </p>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Em andamento</h2>
        {open.length === 0 && <p className="text-sm text-muted-foreground">Nenhum incidente em andamento.</p>}
        {open.map((i) => (
          <IncidentCard key={i.id} incident={i} closable={closable} />
        ))}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Encerrados recentemente</h2>
        {recentClosed.length === 0 && <p className="text-sm text-muted-foreground">Nenhum incidente encerrado ainda.</p>}
        {recentClosed.map((i) => (
          <IncidentCard key={i.id} incident={i} closable={false} />
        ))}
      </section>
    </div>
  );
}
