import { getDb, type Db } from "@/lib/db";

export interface QueueStat {
  name: string;
  pending: number;
  active: number;
  failed: number;
  /** Idade, em segundos, do job pendente mais antigo. */
  oldestPendingSeconds: number | null;
}

/** Situação das filas do pg-boss (pendentes, em andamento e falhas). Sem o schema do pg-boss, devolve `[]`. */
export async function getQueueStats(db: Db = getDb()): Promise<QueueStat[]> {
  const exists = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
  if (!exists[0]?.ok) return [];
  const rows = await db.$queryRaw<{ name: string; state: string; n: number; oldest: number | null }[]>`
    SELECT name, state::text AS state, COUNT(*)::int AS n,
           EXTRACT(EPOCH FROM (now() - MIN(created_on)))::int AS oldest
    FROM pgboss.job
    WHERE state IN ('created', 'retry', 'active', 'failed')
    GROUP BY name, state`;
  const byName = new Map<string, QueueStat>();
  for (const r of rows) {
    const stat = byName.get(r.name) ?? { name: r.name, pending: 0, active: 0, failed: 0, oldestPendingSeconds: null };
    if (r.state === "created" || r.state === "retry") {
      stat.pending += r.n;
      stat.oldestPendingSeconds = Math.max(stat.oldestPendingSeconds ?? 0, r.oldest ?? 0);
    } else if (r.state === "active") stat.active += r.n;
    else if (r.state === "failed") stat.failed += r.n;
    byName.set(r.name, stat);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
