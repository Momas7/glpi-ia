import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/lib/logger";
import { enqueue, type PrismaTransaction } from "@/lib/queue";
import { DELIVER_QUEUE, ensureWebhookQueues } from "./queues";

export type EventType =
  | "ticket.created"
  | "ticket.assigned"
  | "ticket.status_changed"
  | "comment.created"
  | "sla.warning"
  | "sla.breached"
  | "auth.invite_created"
  | "auth.password_reset_requested";

export { DELIVER_QUEUE };

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
  await ensureWebhookQueues();
  const eventId = randomUUID();
  const body = JSON.stringify({ id: eventId, type, occurredAt: new Date().toISOString(), data });
  const delivery = await tx.webhookDelivery.create({
    data: { eventId, type, ticketId: ref.ticketId, subjectId: ref.subjectId },
  });
  await enqueue<DeliverJob>(DELIVER_QUEUE, { deliveryId: delivery.id, body }, { tx: tx as PrismaTransaction });
  return eventId;
}

export interface TicketEventData {
  id: string;
  number: number;
  title: string;
  status: string;
  priority: string;
  team: string | null;
  requester: { name: string; email: string };
  assignee: { name: string; email: string } | null;
  url: string;
}

/** Dados mínimos para notificar: nunca descrição nem texto de comentário. */
export async function ticketEventData(tx: Prisma.TransactionClient, ticketId: string): Promise<TicketEventData> {
  const t = await tx.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      requester: { select: { name: true, email: true } },
      assignee: { select: { name: true, email: true } },
      team: { select: { name: true } },
    },
  });
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    status: t.status,
    priority: t.priority,
    team: t.team?.name ?? null,
    requester: t.requester,
    assignee: t.assignee,
    url: `${appUrl}/tickets/${t.id}`,
  };
}

/** Atalho para eventos de chamado: monta o `data` padrão e acrescenta campos do evento. */
export async function emitTicketEvent(
  tx: Prisma.TransactionClient,
  type: "ticket.created" | "ticket.assigned" | "ticket.status_changed" | "sla.warning" | "sla.breached",
  ticketId: string,
  extra: Record<string, unknown> = {},
): Promise<string | null> {
  if (!process.env.N8N_WEBHOOK_URL) return emitEvent(tx, type, { ticketId, ...extra }, { ticketId });
  return emitEvent(tx, type, { ...(await ticketEventData(tx, ticketId)), ...extra }, { ticketId });
}

/** Só para comentários públicos (o chamador garante). O texto do comentário não vai no aviso. */
export async function emitCommentEvent(
  tx: Prisma.TransactionClient,
  ticketId: string,
  commentId: string,
  author: { name: string; email: string },
): Promise<string | null> {
  if (!process.env.N8N_WEBHOOK_URL) return emitEvent(tx, "comment.created", { ticketId, commentId }, { ticketId, subjectId: commentId });
  return emitEvent(
    tx,
    "comment.created",
    { ticket: await ticketEventData(tx, ticketId), commentId, author },
    { ticketId, subjectId: commentId },
  );
}
