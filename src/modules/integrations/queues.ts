import { defineQueue } from "@/lib/queue";

export const DELIVER_QUEUE = "webhook.deliver";
export const FAILED_QUEUE = "webhook.failed";
// Os corpos de convite/reset levam links com token: jobs de webhook não ficam guardados depois de terminar.
const JOB_RETENTION_SECONDS = 3600;

export interface WebhookQueueOptions {
  retryLimit?: number;
  retryDelay?: number;
}

let ready: Promise<void> | undefined;

async function define(opts: WebhookQueueOptions): Promise<void> {
  await defineQueue(FAILED_QUEUE, { deleteAfterSeconds: JOB_RETENTION_SECONDS, retryLimit: 3 });
  await defineQueue(DELIVER_QUEUE, {
    retryLimit: opts.retryLimit ?? 7, // 8 tentativas no total
    retryDelay: opts.retryDelay ?? 30,
    retryBackoff: true,
    deleteAfterSeconds: JOB_RETENTION_SECONDS,
    deadLetter: FAILED_QUEUE,
  });
}

/**
 * Garante as filas de webhook com dead letter e retenção ANTES do primeiro envio, em qualquer processo
 * (o pg-boss copia a configuração da fila para cada job no momento em que ele é gravado).
 * Com `opts` (worker/testes), redefine; sem, define uma vez por processo.
 */
export function ensureWebhookQueues(opts?: WebhookQueueOptions): Promise<void> {
  if (opts) {
    ready = define(opts);
    return ready;
  }
  ready ??= define({}).catch((err) => {
    ready = undefined;
    throw err;
  });
  return ready;
}
