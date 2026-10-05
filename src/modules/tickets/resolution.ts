import { z } from "zod";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { can, type SessionUser } from "@/modules/auth";
import { emitCommentEvent, emitTicketEvent } from "@/modules/integrations";
import { loadVisible, ticketInclude, type TicketWithRefs } from "./service";

export const reopenSchema = z.object({ reason: z.string().trim().min(5).max(2000) });

const NOT_RESOLVED = "Só é possível reabrir ou confirmar um chamado resolvido.";

/** Ações do solicitante sobre o próprio chamado: 404 se não vê, 403 se não é dele, 409 se não está resolvido. */
async function loadOwnResolved(actor: SessionUser, id: string, action: "ticket:reopen" | "ticket:confirm") {
  const current = await loadVisible(actor, id);
  if (current.requesterId !== actor.id) throw new ForbiddenError();
  if (current.status !== "RESOLVED") throw new AppError(409, NOT_RESOLVED);
  if (!can(actor, action, current)) throw new ForbiddenError();
  return current;
}

export async function reopenTicket(actor: SessionUser, id: string, reason: string): Promise<TicketWithRefs> {
  const { reason: text } = reopenSchema.parse({ reason });
  await loadOwnResolved(actor, id, "ticket:reopen");
  return getDb().$transaction(async (tx) => {
    const claimed = await tx.ticket.updateMany({
      where: { id, status: "RESOLVED" },
      data: { status: "OPEN", resolvedAt: null },
    });
    if (claimed.count !== 1) throw new AppError(409, NOT_RESOLVED);
    const comment = await tx.comment.create({
      data: { ticketId: id, authorId: actor.id, body: text, internal: false, source: "WEB" },
    });
    await tx.ticketEvent.create({
      data: { ticketId: id, actorId: actor.id, type: "REOPENED", data: { commentId: comment.id } },
    });
    await emitTicketEvent(tx, "ticket.status_changed", id, { from: "RESOLVED", to: "OPEN" });
    await emitCommentEvent(tx, id, comment.id, { name: actor.name, email: actor.email });
    return tx.ticket.findUniqueOrThrow({ where: { id }, include: ticketInclude });
  });
}

export async function confirmTicket(actor: SessionUser, id: string): Promise<TicketWithRefs> {
  await loadOwnResolved(actor, id, "ticket:confirm");
  return getDb().$transaction(async (tx) => {
    const claimed = await tx.ticket.updateMany({
      where: { id, status: "RESOLVED" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError(409, NOT_RESOLVED);
    await tx.ticketEvent.create({ data: { ticketId: id, actorId: actor.id, type: "CONFIRMED", data: {} } });
    await emitTicketEvent(tx, "ticket.status_changed", id, { from: "RESOLVED", to: "CLOSED" });
    return tx.ticket.findUniqueOrThrow({ where: { id }, include: ticketInclude });
  });
}

/**
 * Fecha chamados em RESOLVED há mais de `days` dias corridos (o solicitante não reabriu nem confirmou).
 * Um único UPDATE ... RETURNING evita fechar um chamado que acabou de ser reaberto.
 */
export async function autoCloseResolved(
  now: Date = new Date(),
  days: number = Number(process.env.AUTO_CLOSE_DAYS ?? 7),
): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return getDb().$transaction(async (tx) => {
    const closed = await tx.$queryRaw<{ id: string }[]>`
      UPDATE "Ticket"
         SET status = 'CLOSED', "closedAt" = ${now}, "updatedAt" = ${now}
       WHERE status = 'RESOLVED' AND "resolvedAt" <= ${cutoff}
   RETURNING id`;
    if (closed.length > 0) {
      await tx.ticketEvent.createMany({
        data: closed.map((t) => ({ ticketId: t.id, actorId: null, type: "AUTO_CLOSED", data: { days } })),
      });
      for (const t of closed) await emitTicketEvent(tx, "ticket.status_changed", t.id, { from: "RESOLVED", to: "CLOSED", automatic: true });
      logger.info({ count: closed.length, days }, "chamados fechados automaticamente");
    }
    return closed.length;
  });
}
