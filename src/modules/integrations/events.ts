import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { enqueue, type PrismaTransaction } from "@/lib/queue";

export type EventType =
  | "ticket.created"
  | "ticket.assigned"
  | "ticket.status_changed"
  | "comment.created"
  | "sla.warning"
  | "sla.breached"
  | "auth.invite_created"
  | "auth.password_reset_requested";

export const DELIVER_QUEUE = "webhook.deliver";

export interface DeliverJob {
  deliveryId: string;
  body: string;
}

/**
 * Publica um aviso para o n8n na MESMA transação da mudança (outbox): rollback descarta o aviso.
 * Sem N8N_WEBHOOK_URL, só registra no log e devolve null.
 */
export async function emitEvent(
  tx: Prisma.TransactionClient,
  type: EventType,
  data: Record<string, unknown>,
  ref: { ticketId?: string; subjectId?: string } = {},
): Promise<string | null> {
  if (!process.env.N8N_WEBHOOK_URL) {
    logger.info({ type, ...ref }, "evento sem destino (N8N_WEBHOOK_URL ausente)");
    return null;
  }
  const eventId = randomUUID();
  const body = JSON.stringify({ id: eventId, type, occurredAt: new Date().toISOString(), data });
  const delivery = await tx.webhookDelivery.create({
    data: { eventId, type, ticketId: ref.ticketId, subjectId: ref.subjectId },
  });
  await enqueue<DeliverJob>(DELIVER_QUEUE, { deliveryId: delivery.id, body }, { tx: tx as PrismaTransaction });
  return eventId;
}
