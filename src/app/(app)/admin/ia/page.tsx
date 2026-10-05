import { AiTeamToggle } from "@/components/admin/AiTeamToggle";
import { ReindexButton } from "@/components/admin/ReindexButton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";
import { getAiOverview } from "@/modules/ai";

export const metadata = { title: "IA · Administração" };

const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

export default async function AiAdminPage() {
  const user = await requireUser();
  const o = await getAiOverview(user);
  const decided = o.acceptance.accepted + o.acceptance.edited + o.acceptance.rejected;
  const rate = (n: number) => (decided === 0 ? "—" : `${Math.round((n / decided) * 100)}%`);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Estado</h2>
        <p className="text-sm">
          {o.enabled ? "IA ligada" : "IA desligada"} · provider <strong>{o.provider}</strong> · modelo <strong>{o.model}</strong>
        </p>
        {o.reason && (
          <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {o.reason} Ligar e escolher o provider é feito nas variáveis de ambiente do servidor.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Gasto estimado hoje: {usd.format(o.spentTodayUsd)} de {usd.format(o.budgetUsd)}. É uma estimativa, não a fatura.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Sugestões de triagem</h2>
        <p className="text-sm text-muted-foreground">
          Aceitas {o.acceptance.accepted} ({rate(o.acceptance.accepted)}) · editadas {o.acceptance.edited} ({rate(o.acceptance.edited)}) ·
          rejeitadas {o.acceptance.rejected} ({rate(o.acceptance.rejected)}) · aguardando decisão {o.acceptance.pending}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium">Base de conhecimento</h2>
        {o.ragReason && (
          <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {o.ragReason} Sem isso o botão &quot;Sugerir resposta&quot; não aparece.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          Indexados: {o.knowledge.articles} artigos publicados ({o.knowledge.chunks} trechos) e {o.knowledge.tickets} chamados resolvidos.
        </p>
        <ReindexButton />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Triagem por equipe</h2>
        {o.teams.map((t) => (
          <AiTeamToggle key={t.id} teamId={t.id} name={t.name} enabled={t.aiEnabled} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Últimas execuções</h2>
        <p className="text-sm text-muted-foreground">Sem texto de chamado: só métricas.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quando</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Tokens (entrada/saída)</TableHead>
              <TableHead>Custo</TableHead>
              <TableHead>Latência</TableHead>
              <TableHead>Resultado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {o.recent.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Nenhuma execução ainda.
                </TableCell>
              </TableRow>
            )}
            {o.recent.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                <TableCell>{r.jobType}</TableCell>
                <TableCell>{r.model}</TableCell>
                <TableCell>
                  {r.inputTokens} / {r.outputTokens}
                </TableCell>
                <TableCell>{usd.format(r.costUsd)}</TableCell>
                <TableCell>{r.latencyMs} ms</TableCell>
                <TableCell>{r.outcome}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
