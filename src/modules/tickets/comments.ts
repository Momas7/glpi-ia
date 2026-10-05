import { z } from "zod";
import { getDb } from "@/lib/db";
import { can, type SessionUser } from "@/modules/auth";
import { emitCommentEvent } from "@/modules/integrations";
import { slaOnComment } from "@/modules/sla";
import { ForbiddenError, TicketNotFoundError, getTicket } from "./service";

export const commentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  internal: z.boolean().default(false),
});

/** O texto é guardado como veio; o escape acontece na renderização (SafeText). */
export async function addComment(
  actor: SessionUser,
  ticketId: string,
  input: z.infer<typeof commentSchema>,
  origin?: { source: "API"; externalRef?: string },
) {
  const ticket = await getTicket(actor, ticketId);
  if (!ticket) throw new TicketNotFoundError();
  if (!can(actor, "comment:create", ticket)) throw new ForbiddenError();
  if (input.internal && !can(actor, "comment:read_internal", ticket)) throw new ForbiddenError();

  const db = getDb();
  return db.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        ticketId,
        authorId: actor.id,
        body: input.body,
        internal: input.internal,
        source: origin?.source ?? "WEB",
        externalRef: origin?.externalRef,
      },
      include: { author: { select: { id: true, name: true } } },
    });
    await tx.ticketEvent.create({
      data: { ticketId, actorId: actor.id, type: "COMMENTED", data: { internal: input.internal } },
    });
    await slaOnComment(tx, ticketId, { id: actor.id, role: actor.role }, input.internal, new Date());
    // Nota interna nunca sai do sistema.
    if (!input.internal) await emitCommentEvent(tx, ticketId, comment.id, { name: actor.name, email: actor.email });
    return comment;
  });
}

export async function getComments(actor: SessionUser, ticketId: string) {
  const ticket = await getTicket(actor, ticketId);
  if (!ticket) throw new TicketNotFoundError();
  const seeInternal = can(actor, "comment:read_internal", ticket);
  return getDb().comment.findMany({
    where: { ticketId, ...(seeInternal ? {} : { internal: false }) },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}
