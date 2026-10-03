import { getDb, type Db } from "@/lib/db";
import { logger } from "@/lib/logger";

export const HEARTBEAT_INTERVAL_MS = 60_000;
/** Sem batimento há mais que isso, o worker é considerado parado. */
export const WORKER_STALE_SECONDS = 180;

/** Marca "estou vivo" para o serviço (a página de saúde e o `/ready` leem isto). */
export async function recordHeartbeat(service: string, db: Db = getDb()): Promise<void> {
  const now = new Date();
  await db.workerHeartbeat.upsert({ where: { service }, update: { beatAt: now }, create: { service, beatAt: now } });
}

/** Bate já e depois a cada minuto. Falha ao gravar só é registrada: o worker não pode cair por causa do batimento. */
export function startHeartbeat(service: string, record: (service: string) => Promise<void> = recordHeartbeat): () => void {
  const beat = () => {
    void record(service).catch((err) => logger.warn({ err, service }, "falha ao gravar o batimento"));
  };
  beat();
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}
