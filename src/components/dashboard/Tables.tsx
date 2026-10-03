import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/labels";
import type { DueSoonRow, WorkloadRow } from "@/modules/dashboard/queries";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-white/10 p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

export function DueSoonTable({ rows }: { rows: DueSoonRow[] }) {
  return (
    <Section title="Vence primeiro">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nada vencendo ou vencido. Bom sinal.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-12 whitespace-nowrap py-1 pr-2">#</th>
              <th className="pr-3">Chamado</th>
              <th className="pr-3">Responsável</th>
              <th className="pr-3">Prazo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-white/5">
                <td className="whitespace-nowrap py-1.5 pr-2 text-muted-foreground">#{r.number}</td>
                <td className="pr-3">
                  <Link href={`/tickets/${r.id}`} className="hover:underline">
                    {r.title}
                  </Link>
                  {r.team && <span className="ml-2 text-xs text-muted-foreground">{r.team}</span>}
                </td>
                <td className="pr-3">{r.assignee ?? <span className="text-muted-foreground">Sem responsável</span>}</td>
                <td className="whitespace-nowrap pr-3 text-muted-foreground">{formatDateTime(r.resolutionDue)}</td>
                <td>
                  <Badge variant="outline" className={`border-0 ${r.breached ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"}`}>
                    {r.breached ? "Vencido" : "Em risco"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function WorkloadTable({ rows }: { rows: WorkloadRow[] }) {
  return (
    <Section title="Carga por técnico">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhum chamado em aberto.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-1">Responsável</th>
              <th>Abertos</th>
              <th>Em risco</th>
              <th>Vencidos</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.assigneeId ?? "sem"} className="border-t border-white/5">
                <td className="py-1.5">{r.name}</td>
                <td className="tabular-nums">{r.open}</td>
                <td className="tabular-nums">{r.atRisk}</td>
                <td className="tabular-nums">{r.breached}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
