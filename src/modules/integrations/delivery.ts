import { getDb } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enqueue, registerHandler, type PrismaTransaction } from "@/lib/queue";
// Imports diretos (não pelo index de auth) evitam ciclo: auth usa emitEvent deste módulo.
import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";
import { ticketEventData, type DeliverJob } from "./events";
import { DELIVER_QUEUE, FAILED_QUEUE, ensureWebhookQueues } from "./queues";
import { signPayload } from "./signature";

const TIMEOUT_MS = 10_000;

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
  await ensureWebhookQueues(opts);
  await registerHandler<DeliverJob>(DELIVER_QUEUE, deliverWebhook);
  await registerHandler<DeliverJob>(FAILED_QUEUE, markFailed);
}

function assertAdmin(actor: SessionUser) {
  if (!can(actor, "admin:manage")) throw new ForbiddenError();
}

export async function listFailedDeliveries(actor: SessionUser, limit = 50) {
  assertAdmin(actor);
  const rows = await getDb().webhookDelivery.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const ticketIds = rows.map((r) => r.ticketId).filter((id): id is string => !!id);
  const tickets = await getDb().ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, number: true } });
  const numberOf = new Map(tickets.map((t) => [t.id, t.number]));
  return rows.map((r) => ({
    id: r.id,
    eventId: r.eventId,
    type: r.type,
    ticketNumber: r.ticketId ? (numberOf.get(r.ticketId) ?? null) : null,
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt,
  }));
}

/**
 * Reenvia um aviso que falhou. O corpo original não é guardado: é remontado com o estado ATUAL do chamado
 * (mesmo id de evento, `redelivery: true`). Avisos de convite/reset não podem ser remontados (o token não é guardado).
 */
export async function retryDelivery(actor: SessionUser, deliveryId: string): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const d = await tx.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!d) throw new NotFoundError("Aviso não encontrado.");
    if (d.type.startsWith("auth.")) throw new AppError(409, "Este aviso não pode ser reenviado. Gere um novo convite ou link.");
    if (d.status !== "FAILED") throw new AppError(409, "Só avisos com falha podem ser reenviados.");
    if (!d.ticketId) throw new AppError(409, "Aviso sem chamado associado.");

    let data: Record<string, unknown>;
    if (d.type === "comment.created") {
      const comment = await tx.comment.findUniqueOrThrow({
        where: { id: d.subjectId ?? "" },
        include: { author: { select: { name: true, email: true } } },
      });
      data = { ticket: await ticketEventData(tx, d.ticketId), commentId: comment.id, author: comment.author, redelivery: true };
    } else {
      data = { ...(await ticketEventData(tx, d.ticketId)), redelivery: true };
    }
    const body = JSON.stringify({ id: d.eventId, type: d.type, occurredAt: new Date().toISOString(), data });
    await tx.webhookDelivery.update({ where: { id: d.id }, data: { status: "PENDING" } });
    await enqueue<DeliverJob>(DELIVER_QUEUE, { deliveryId: d.id, body }, { tx: tx as PrismaTransaction });
  });
}
