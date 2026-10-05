import { z } from "zod";
import type { Prisma, TicketRating } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError } from "@/lib/errors";
import { enqueueIndexTicket } from "@/modules/ai/enqueue";
import { can, type SessionUser } from "@/modules/auth";
import { loadVisible } from "./service";

export const RATING_WINDOW_DAYS = 30;

export const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

export type RatingInput = z.infer<typeof ratingSchema>;

const ALREADY_RATED = "Este chamado já foi avaliado.";

/** Grava a nota (uma por chamado) com o evento RATED e a reindexação, dentro da transação de quem chamou. */
export async function createRating(
  tx: Prisma.TransactionClient,
  ticketId: string,
  rater: SessionUser,
  input: RatingInput,
): Promise<TicketRating> {
  const data = ratingSchema.parse(input);
  if (await tx.ticketRating.findUnique({ where: { ticketId } })) throw new AppError(409, ALREADY_RATED);
  let rating: TicketRating;
  try {
    rating = await tx.ticketRating.create({
      data: { ticketId, raterId: rater.id, stars: data.stars, comment: data.comment || null },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") throw new AppError(409, ALREADY_RATED);
    throw err;
  }
  // O comentário não vai no evento: o histórico guarda só a nota.
  await tx.ticketEvent.create({ data: { ticketId, actorId: rater.id, type: "RATED", data: { stars: data.stars } } });
  await enqueueIndexTicket(tx, ticketId); // nota 1 ou 2 tira o chamado da base de conhecimento
  return rating;
}

export async function rateTicket(actor: SessionUser, ticketId: string, input: RatingInput): Promise<TicketRating> {
  const ticket = await loadVisible(actor, ticketId); // 404 para quem não vê o chamado
  if (!can(actor, "ticket:rate", ticket)) throw new ForbiddenError();
  const data = ratingSchema.parse(input);
  if (ticket.status === "CLOSED" && ticket.closedAt) {
    const limit = ticket.closedAt.getTime() + RATING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() > limit) throw new AppError(409, "O prazo para avaliar este chamado terminou.");
  }
  return getDb().$transaction((tx) => createRating(tx, ticketId, actor, data));
}

/** A avaliação do chamado, para quem pode ver o chamado. */
export async function getRating(actor: SessionUser, ticketId: string): Promise<TicketRating | null> {
  await loadVisible(actor, ticketId);
  return getDb().ticketRating.findUnique({ where: { ticketId } });
}
