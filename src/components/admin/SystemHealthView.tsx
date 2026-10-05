import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/labels";
import type { SystemOverview } from "@/modules/system";

const mb = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatBytes = (n: number) => `${mb.format(n / 1_048_576)} MB`;
const formatAge = (s: number | null) => (s === null ? "—" : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

/** Página "Saúde do sistema": só leitura, sem segredo e sem texto de chamado. */
export function SystemHealthView({ overview }: { overview: SystemOverview }) {
  const { readiness, queues, webhooks, backup, database } = overview;
  const state = backup.state;
  return (
    <div className="flex flex-col gap-8">
      {readiness.status === "ok" ? (
        <p role="status" className="text-sm">
          Sistema saudável: todas as verificações passaram.
        </p>
      ) : (
        <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm">
          Atenção: há verificações falhando. Veja abaixo e consulte o roteiro de operação.
        </p>
      )}

      <section aria-label="Verificações" className="flex flex-col gap-2">
        <h2 className="font-medium">Verificações</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {readiness.checks.map((c) => (
            <li key={c.name} className="flex flex-wrap items-center gap-2">
              <Badge variant={c.ok ? "outline" : "destructive"}>{c.ok ? "ok" : "falha"}</Badge>
              <span className="font-medium">{c.name}</span>
              <span className="text-muted-foreground">{c.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Filas" className="flex flex-col gap-2">
        <h2 className="font-medium">Filas</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fila</TableHead>
              <TableHead>Pendentes</TableHead>
              <TableHead>Em andamento</TableHead>
              <TableHead>Falhas</TableHead>
              <TableHead>Mais antigo pendente</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {queues.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Nenhum job nas filas.
                </TableCell>
              </TableRow>
            )}
            {queues.map((q) => (
              <TableRow key={q.name}>
                <TableCell>{q.name}</TableCell>
                <TableCell>{q.pending}</TableCell>
                <TableCell>{q.active}</TableCell>
                <TableCell>{q.failed}</TableCell>
                <TableCell>{formatAge(q.oldestPendingSeconds)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-label="Avisos ao n8n" className="flex flex-col gap-1 text-sm">
        <h2 className="font-medium">Avisos ao n8n (últimas 24 h)</h2>
        <p>
          {webhooks.delivered} entregues · {webhooks.pending} pendentes · {webhooks.failed} falhos
        </p>
      </section>

      <section aria-label="Backup" className="flex flex-col gap-2 text-sm">
        <h2 className="font-medium">Backup</h2>
        {!backup.configured && (
          <p className="text-muted-foreground">Backup não configurado: defina BACKUP_STATE_FILE e agende o backup (veja docs/operacao.md).</p>
        )}
        {backup.configured && (backup.stale || !state?.lastBackupOk) && (
          <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            {state?.lastBackupAt
              ? `Backup atrasado ou com falha: o último foi há ${backup.ageHours === null ? "?" : Math.round(backup.ageHours)} h.`
              : "Nenhum backup encontrado."}
            {state?.detail ? ` ${state.detail}` : ""}
          </p>
        )}
        {state?.lastBackupAt && (
          <p>
            Último backup: {formatDateTime(state.lastBackupAt)}
            {state.lastBackupBytes !== null && ` · ${formatBytes(state.lastBackupBytes)}`}
          </p>
        )}
        {state?.lastRestoreTestAt && (
          <p>
            Teste de restauração: {state.lastRestoreTestOk ? "passou" : "falhou"} em {formatDateTime(state.lastRestoreTestAt)}
          </p>
        )}
      </section>

      <section aria-label="Banco de dados" className="flex flex-col gap-1 text-sm">
        <h2 className="font-medium">Banco de dados</h2>
        <p>
          {formatBytes(database.sizeBytes)} · {database.tickets} chamados · {database.articles} artigos publicados · {database.vectors} vetores
        </p>
      </section>
    </div>
  );
}
