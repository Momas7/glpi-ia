import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { can, type SessionUser } from "@/modules/auth";
import { recordAudit } from "@/modules/audit";
import { applyTriageFields, getTicket, TicketNotFoundError, type TicketWithRefs } from "@/modules/tickets";

const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }).strict(),
  z.object({ action: z.literal("reject") }).strict(),
  z.object({
    action: z.literal("edit"),
    fields: z.object({ categoryId: z.string().min(1).nullable(), priority: priorityEnum, teamId: z.string().min(1).nullable() }).strict(),
  }).strict(),
]);

export type Decision = z.infer<typeof decisionSchema>;

interface TriagePayload {
  categoryId: string | null;
  priority: z.infer<typeof priorityEnum>;
  teamId: string | null;
  basis: { categoryId: string | null; priority: string; teamId: string | null };
}

const STATUS_FOR = { accept: "ACCEPTED", edit: "EDITED", reject: "REJECTED" } as const;

/** Aceitar, editar ou rejeitar a triagem sugerida. A decisão é única e nunca altera o status do chamado. */
export async function decideSuggestion(
  actor: SessionUser,
  ticketId: string,
  decision: Decision,
): Promise<{ ticket: TicketWithRefs }> {
  const ticket = await getTicket(actor, ticketId);
  // Quem não pode decidir também recebe 404: a existência da sugestão não é revelada.
  if (!ticket || !can(actor, "ai:decide", ticket)) throw new TicketNotFoundError();

  const db = getDb();
  const suggestion = await db.aiSuggestion.findUnique({ where: { ticketId_kind: { ticketId, kind: "TRIAGE" } } });
  if (!suggestion) throw new AppError(404, "Sugestão não encontrada.");
  if (suggestion.status !== "PENDING") throw new AppError(409, "Esta sugestão já foi decidida.");

  const payload = suggestion.payload as unknown as TriagePayload;
  const stale =
    ticket.status === "RESOLVED" ||
    ticket.status === "CLOSED" ||
    ticket.categoryId !== payload.basis.categoryId ||
    ticket.priority !== payload.basis.priority ||
    ticket.teamId !== payload.basis.teamId;
  if (stale) throw new AppError(409, "O chamado mudou desde a sugestão. Atualize a página.");

  const claim = async (tx: Prisma.TransactionClient, fields: unknown) => {
    const claimed = await tx.aiSuggestion.updateMany({
      where: { id: suggestion.id, status: "PENDING" },
      data: { status: STATUS_FOR[decision.action], decidedById: actor.id, decidedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AppError(409, "Esta sugestão já foi decidida.");
    await recordAudit(tx, {
      actorId: actor.id,
      action: `ai.suggestion_${decision.action}`,
      targetType: "ticket",
      targetId: ticketId,
      data: {
        suggestionId: suggestion.id,
        before: { categoryId: ticket.categoryId, priority: ticket.priority, teamId: ticket.teamId },
        ...(fields ? { after: fields } : {}),
      },
    });
  };

  if (decision.action === "reject") {
    await db.$transaction((tx) => claim(tx, null));
    return { ticket: (await getTicket(actor, ticketId)) ?? ticket };
  }

  const fields =
    decision.action === "edit"
      ? decision.fields
      : {
          categoryId: payload.categoryId ?? payload.basis.categoryId,
          priority: payload.priority,
          teamId: payload.teamId ?? payload.basis.teamId,
        };
  const updated = await applyTriageFields(actor, ticketId, fields, (tx) => claim(tx, fields));
  return { ticket: updated };
}
