import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { can, type SessionUser } from "@/modules/auth";
import type { CreateTicketInput, ListTicketsQuery, TicketStatus, UpdateTicketInput } from "./schemas";

const MAX_PAGE_SIZE = 100;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

export class TicketNotFoundError extends AppError {
  constructor() {
    super(404, "Chamado não encontrado.");
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "Sem permissão para esta ação.") {
    super(403, message);
  }
}
export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, `Transição de status inválida: ${from} → ${to}.`);
  }
}

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["OPEN"],
  OPEN: ["PENDING", "RESOLVED"],
  PENDING: ["OPEN"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: [],
};

const include = {
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.TicketInclude;

export type TicketWithRefs = Prisma.TicketGetPayload<{ include: typeof include }>;
type Tx = Prisma.TransactionClient;
export type TicketCreatedHook = (tx: Tx, ticket: TicketWithRefs) => Promise<void>;

const createdHooks = new Set<TicketCreatedHook>();

/** Executados dentro da transação de criação (Fase 3 enfileira a triagem aqui). Retorna função para remover. */
export function registerTicketCreatedHook(hook: TicketCreatedHook): () => void {
  createdHooks.add(hook);
  return () => void createdHooks.delete(hook);
}

function visibilityWhere(actor: SessionUser): Prisma.TicketWhereInput {
  if (actor.role === "ADMIN") return {};
  if (actor.role === "REQUESTER") return { requesterId: actor.id };
  return {
    OR: [{ teamId: { in: actor.teamIds } }, { assigneeId: actor.id }, { requesterId: actor.id }],
  };
}

async function loadVisible(actor: SessionUser, id: string): Promise<TicketWithRefs> {
  const ticket = await getTicket(actor, id);
  if (!ticket) throw new TicketNotFoundError();
  return ticket;
}

export async function getTicket(actor: SessionUser, id: string): Promise<TicketWithRefs | null> {
  const ticket = await getDb().ticket.findUnique({ where: { id }, include });
  if (!ticket || !can(actor, "ticket:read", ticket)) return null;
  return ticket;
}

export async function createTicket(actor: SessionUser, input: CreateTicketInput): Promise<TicketWithRefs> {
  if (!can(actor, "ticket:create")) throw new ForbiddenError();
  const db = getDb();
  return db.$transaction(async (tx) => {
    // Solicitante não escolhe a equipe: a triagem (humana ou da IA) decide.
    let teamId = actor.role === "REQUESTER" ? null : (input.teamId ?? null);
    if (!teamId && input.categoryId) {
      const category = await tx.category.findUnique({ where: { id: input.categoryId } });
      teamId = category?.defaultTeamId ?? null;
    }
    const ticket = await tx.ticket.create({
      data: {
        title: input.title,
        description: input.description,
        type: input.type,
        priority: input.priority,
        categoryId: input.categoryId,
        teamId,
        requesterId: actor.id,
      },
      include,
    });
    await tx.ticketEvent.create({
      data: { ticketId: ticket.id, actorId: actor.id, type: "CREATED", data: { number: ticket.number } },
    });
    for (const hook of createdHooks) await hook(tx, ticket);
    return ticket;
  });
}

export async function updateTicket(actor: SessionUser, id: string, patch: UpdateTicketInput): Promise<TicketWithRefs> {
  const current = await loadVisible(actor, id);
  if (!can(actor, "ticket:update", current)) throw new ForbiddenError();
  const touchesAssignment = "assigneeId" in patch || "teamId" in patch;
  if (touchesAssignment && !can(actor, "ticket:assign", current)) throw new ForbiddenError();

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const old = (current as Record<string, unknown>)[key];
    if (old !== value) {
      before[key] = old;
      after[key] = value;
    }
  }
  if (Object.keys(after).length === 0) return current;

  return getDb().$transaction(async (tx) => {
    const updated = await tx.ticket.update({ where: { id }, data: patch, include });
    await tx.ticketEvent.create({
      data: { ticketId: id, actorId: actor.id, type: "UPDATED", data: { before, after } as Prisma.InputJsonValue },
    });
    return updated;
  });
}

export async function changeStatus(actor: SessionUser, id: string, to: TicketStatus): Promise<TicketWithRefs> {
  const current = await loadVisible(actor, id);
  if (!can(actor, "ticket:update", current)) throw new ForbiddenError();
  if (to === "CLOSED" && !can(actor, "ticket:close", current)) throw new ForbiddenError();
  if (!TRANSITIONS[current.status].includes(to)) throw new InvalidTransitionError(current.status, to);

  const now = new Date();
  return getDb().$transaction(async (tx) => {
    const updated = await tx.ticket.update({
      where: { id },
      data: {
        status: to,
        resolvedAt: to === "RESOLVED" ? now : to === "OPEN" ? null : undefined,
        closedAt: to === "CLOSED" ? now : undefined,
      },
      include,
    });
    await tx.ticketEvent.create({
      data: { ticketId: id, actorId: actor.id, type: "STATUS_CHANGED", data: { from: current.status, to } },
    });
    return updated;
  });
}

export async function listTickets(
  actor: SessionUser,
  query: ListTicketsQuery,
): Promise<{ items: TicketWithRefs[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(query.pageSize)));
  const page = Math.max(1, Math.floor(query.page));
  // `contains` com mode insensitive vira ILIKE parametrizado, atendido pelo índice gin_trgm_ops do título.
  // O Prisma NÃO escapa os curingas do LIKE: escapamos \, % e _ para que valham como texto literal.
  const where: Prisma.TicketWhereInput = {
    AND: [
      visibilityWhere(actor),
      query.status ? { status: query.status } : {},
      query.teamId ? { teamId: query.teamId } : {},
      query.assigneeId ? { assigneeId: query.assigneeId } : {},
      query.q ? { title: { contains: escapeLike(query.q), mode: "insensitive" } } : {},
    ],
  };
  const db = getDb();
  const [items, total] = await Promise.all([
    db.ticket.findMany({
      where,
      include,
      orderBy: [{ createdAt: "desc" }, { number: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.ticket.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
