import { getDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { can, type SessionUser } from "@/modules/auth";
import { readBackupState, type BackupStatus } from "./backup";
import { checkReadiness, type Readiness } from "./health";
import { getQueueStats, type QueueStat } from "./queues";

export interface SystemOverview {
  readiness: Readiness;
  queues: QueueStat[];
  webhooks: { delivered: number; pending: number; failed: number };
  backup: BackupStatus;
  database: { sizeBytes: number; tickets: number; articles: number; vectors: number };
}

/** Tudo da página "Saúde do sistema" (só admin). Nada aqui traz texto de chamado nem segredo. */
export async function getSystemOverview(actor: SessionUser): Promise<SystemOverview> {
  if (!can(actor, "admin:manage")) throw new ForbiddenError();
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3600_000);
  const [readiness, queues, deliveries, backup, size, tickets, articles, chunks, ticketVectors] = await Promise.all([
    checkReadiness(),
    getQueueStats(db),
    db.webhookDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    readBackupState(),
    db.$queryRaw<{ n: bigint }[]>`SELECT pg_database_size(current_database()) AS n`,
    db.ticket.count(),
    db.kbArticle.count({ where: { published: true } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "KbChunk"`,
    db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "TicketEmbedding"`,
  ]);
  const count = (status: string) => deliveries.find((d) => d.status === status)?._count._all ?? 0;
  return {
    readiness,
    queues,
    webhooks: { delivered: count("DELIVERED"), pending: count("PENDING"), failed: count("FAILED") },
    backup,
    database: { sizeBytes: Number(size[0].n), tickets, articles, vectors: Number(chunks[0].n) + Number(ticketVectors[0].n) },
  };
}
