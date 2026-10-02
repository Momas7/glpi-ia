import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { defineQueue, registerHandler } from "@/lib/queue";
import { DELIVER_QUEUE, type DeliverJob } from "./events";
import { signPayload } from "./signature";

const FAILED_QUEUE = "webhook.failed";
const TIMEOUT_MS = 10_000;
// Os corpos de convite/reset levam links com token: nada de webhook fica mais de 1 h nas tabelas do pg-boss.
const JOB_RETENTION_SECONDS = 3600;

/** Uma tentativa de entrega. Falha (status ≠ 2xx, erro de rede ou timeout) lança para o pg-boss tentar de novo. */
export async function deliverWebhook(job: DeliverJob): Promise<void> {
  const db = getDb();
  const url = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET ?? "";
  const eventId = (JSON.parse(job.body) as { id: string }).id;
  let failure: string;
  try {
    if (!url) throw new Error("N8N_WEBHOOK_URL ausente");
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-event-id": eventId,
        "x-timestamp": String(timestamp),
        "x-signature": signPayload(secret, timestamp, job.body),
      },
      body: job.body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      await db.webhookDelivery.update({ where: { id: job.deliveryId }, data: { status: "DELIVERED", deliveredAt: new Date() } });
      return;
    }
    failure = `HTTP ${res.status}`;
  } catch (err) {
    failure = err instanceof Error ? err.message : String(err);
  }
  await db.webhookDelivery.update({
    where: { id: job.deliveryId },
    data: { attempts: { increment: 1 }, lastError: failure.slice(0, 200) },
  });
  logger.warn({ deliveryId: job.deliveryId, failure }, "falha ao entregar webhook");
  throw new Error(`webhook não entregue: ${failure}`);
}

async function markFailed(job: DeliverJob): Promise<void> {
  await getDb().webhookDelivery.update({ where: { id: job.deliveryId }, data: { status: "FAILED" } });
}

/** Define as filas de entrega (8 tentativas com intervalo exponencial, depois dead letter) e registra os handlers. */
export async function registerWebhookQueues(opts: { retryLimit?: number; retryDelay?: number } = {}): Promise<void> {
  await defineQueue(FAILED_QUEUE, { deleteAfterSeconds: JOB_RETENTION_SECONDS, retryLimit: 3 });
  await defineQueue(DELIVER_QUEUE, {
    retryLimit: opts.retryLimit ?? 7,
    retryDelay: opts.retryDelay ?? 30,
    retryBackoff: true,
    deleteAfterSeconds: JOB_RETENTION_SECONDS,
    deadLetter: FAILED_QUEUE,
  });
  await registerHandler<DeliverJob>(DELIVER_QUEUE, deliverWebhook);
  await registerHandler<DeliverJob>(FAILED_QUEUE, markFailed);
}
