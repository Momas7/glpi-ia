import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError } from "@/lib/errors";
import { can, type SessionUser } from "@/modules/auth";
import type { AssignTicketInput } from "./schemas";
import { loadVisible, ticketInclude, type TicketWithRefs } from "./service";

const STAFF_ROLES = ["AGENT", "TEAM_LEAD", "ADMIN"];
const INVALID_ASSIGNEE = "O responsável precisa ser um técnico ativo da equipe do chamado.";

/** Responsável válido: AGENT, TEAM_LEAD ou ADMIN ativo e membro da equipe do chamado. */
async function assertValidAssignee(tx: Prisma.TransactionClient, assigneeId: string, teamId: string | null) {
  if (!teamId) throw new AppError(400, INVALID_ASSIGNEE);
  const user = await tx.user.findUnique({ where: { id: assigneeId }, include: { teams: { where: { teamId } } } });
  if (!user || !user.active || !STAFF_ROLES.includes(user.role) || user.teams.length === 0) {
    throw new AppError(400, INVALID_ASSIGNEE);
  }
}

export async function assignTicket(actor: SessionUser, id: string, input: AssignTicketInput): Promise<TicketWithRefs> {
  const current = await loadVisible(actor, id);
  if (!can(actor, "ticket:assign", current)) throw new ForbiddenError();

  return getDb().$transaction(async (tx) => {
    const teamId = "teamId" in input ? (input.teamId ?? null) : current.teamId;
    if (teamId && !(await tx.team.findUnique({ where: { id: teamId } }))) {
      throw new AppError(400, "Equipe não encontrada.");
    }
    const teamChanged = teamId !== current.teamId;
    // Mudar de equipe sem dizer quem atende limpa o responsável (ele pode não ser da equipe nova).
    const assigneeId = "assigneeId" in input ? (input.assigneeId ?? null) : teamChanged ? null : current.assigneeId;
    if (assigneeId) await assertValidAssignee(tx, assigneeId, teamId);

    const updated = await tx.ticket.update({ where: { id }, data: { teamId, assigneeId }, include: ticketInclude });
    await tx.ticketEvent.create({
      data: {
        ticketId: id,
        actorId: actor.id,
        type: "ASSIGNED",
        data: {
          before: { teamId: current.teamId, assigneeId: current.assigneeId },
          after: { teamId, assigneeId },
        },
      },
    });
    return updated;
  });
}

/** O técnico assume para si um chamado da equipe sem responsável. Dois cliques simultâneos: um recebe 409. */
export async function takeTicket(actor: SessionUser, id: string): Promise<TicketWithRefs> {
  const current = await loadVisible(actor, id);
  if (!can(actor, "ticket:take", current)) throw new ForbiddenError();

  return getDb().$transaction(async (tx) => {
    await assertValidAssignee(tx, actor.id, current.teamId);
    const claimed = await tx.ticket.updateMany({ where: { id, assigneeId: null }, data: { assigneeId: actor.id } });
    if (claimed.count !== 1) throw new AppError(409, "Este chamado já foi assumido por outra pessoa.");
    await tx.ticketEvent.create({
      data: {
        ticketId: id,
        actorId: actor.id,
        type: "ASSIGNED",
        data: { before: { assigneeId: null }, after: { assigneeId: actor.id }, via: "take" },
      },
    });
    return tx.ticket.findUniqueOrThrow({ where: { id }, include: ticketInclude });
  });
}
