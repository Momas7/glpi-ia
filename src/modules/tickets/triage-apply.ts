import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { SessionUser } from "@/modules/auth";
import { emitTicketEvent } from "@/modules/integrations";
import type { Priority } from "@/generated/prisma/client";
import { applyFields, loadVisible, ticketInclude, type TicketWithRefs } from "./service";

export interface TriageFields {
  categoryId: string | null;
  priority: Priority;
  /** `null` mantém a equipe atual: chamado nunca fica sem equipe. */
  teamId: string | null;
}

/**
 * Aplica o resultado de uma triagem decidida por uma pessoa (categoria, prioridade e equipe) numa só transação.
 * Quem decide já foi autorizado por `ai:decide`, então a troca de equipe não exige `ticket:assign`.
 * `claim` roda primeiro, na mesma transação: é onde a sugestão é marcada como decidida (falhou, nada é gravado).
 * Nunca toca em `status`.
 */
export async function applyTriageFields(
  actor: SessionUser,
  ticketId: string,
  fields: TriageFields,
  claim: (tx: Prisma.TransactionClient, ticket: TicketWithRefs) => Promise<void>,
): Promise<TicketWithRefs> {
  const current = await loadVisible(actor, ticketId);
  return getDb().$transaction(async (tx) => {
    await claim(tx, current);
    await applyFields(tx, actor, current, { categoryId: fields.categoryId, priority: fields.priority });

    if (fields.teamId && fields.teamId !== current.teamId) {
      if (!(await tx.team.findUnique({ where: { id: fields.teamId } }))) throw new AppError(400, "Equipe não encontrada.");
      // Mudou de equipe: o responsável atual pode não pertencer à nova, então o chamado volta à fila.
      await tx.ticket.update({ where: { id: ticketId }, data: { teamId: fields.teamId, assigneeId: null } });
      await tx.ticketEvent.create({
        data: {
          ticketId,
          actorId: actor.id,
          type: "ASSIGNED",
          data: {
            before: { teamId: current.teamId, assigneeId: current.assigneeId },
            after: { teamId: fields.teamId, assigneeId: null },
            via: "ai",
          },
        },
      });
      await emitTicketEvent(tx, "ticket.assigned", ticketId, { previousAssigneeId: current.assigneeId });
    }
    return tx.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: ticketInclude });
  });
}
