import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError } from "@/lib/errors";
import { escapeLike } from "@/lib/like";
import { emitTicketEvent } from "@/modules/integrations";
import { slaOnCreate, slaOnPriorityChange, slaOnStatusChange } from "@/modules/sla";
import { can, type SessionUser } from "@/modules/auth";
import type { CreateTicketInput, ListTicketsQuery, TicketStatus, UpdateTicketInput } from "./schemas";

const MAX_PAGE_SIZE = 100;

export class TicketNotFoundError extends AppError {
  constructor() {
    super(404, "Chamado não encontrado.");
  }
}
export { ForbiddenError };
export class InvalidTransitionError extends AppError {
  constructor(from: string, to: string) {
    super(409, `Transição de status inválida: ${from} → ${to}.`);
  }
}

export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["OPEN"],
  OPEN: ["PENDING", "RESOLVED"],
  PENDING: ["OPEN"],
  RESOLVED: ["OPEN", "CLOSED"],
  CLOSED: [],
};

export const ticketInclude = {
  requester: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
  team: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
  apiKey: { select: { name: true } },
} satisfies Prisma.TicketInclude;
const include = ticketInclude;

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

export async function loadVisible(actor: SessionUser, id: string): Promise<TicketWithRefs> {
  const ticket = await getTicket(actor, id);
  if (!ticket) throw new TicketNotFoundError();
  return ticket;
}

export async function getTicket(actor: SessionUser, id: string): Promise<TicketWithRefs | null> {
  const ticket = await getDb().ticket.findUnique({ where: { id }, include });
  if (!ticket || !can(actor, "ticket:read", ticket)) return null;
  return ticket;
}

/** Origem do chamado quando não vem da tela: integração por chave de API (n8n). */
export interface TicketOrigin {
  source: "API";
  apiKeyId: string;
  apiKeyName: string;
  externalRef?: string;
}

export async function createTicket(actor: SessionUser, input: CreateTicketInput, origin?: TicketOrigin): Promise<TicketWithRefs> {
  if (!can(actor, "ticket:create")) throw new ForbiddenError();
  const db = getDb();
  return db.$transaction(async (tx) => {
    const category = input.categoryId ? await requireCategory(tx, input.categoryId) : null;
    // Solicitante não escolhe a equipe: a triagem (humana ou da IA) decide.
    let teamId = actor.role === "REQUESTER" ? null : (input.teamId ?? null);
    if (teamId && !(await tx.team.findUnique({ where: { id: teamId } }))) {
      throw new AppError(400, "Equipe não encontrada.");
    }
    if (!teamId && category) teamId = category.defaultTeamId ?? null;
    // Sem equipe definida, o chamado cai na equipe de entrada para não ficar invisível aos técnicos.
    if (!teamId) {
      const intake = await tx.team.findUnique({ where: { name: process.env.DEFAULT_INTAKE_TEAM ?? "Suporte N1" } });
      teamId = intake?.id ?? null;
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
        ...(origin ? { source: origin.source, apiKeyId: origin.apiKeyId, externalRef: origin.externalRef } : {}),
      },
      include,
    });
    await tx.ticketEvent.create({
      data: { ticketId: ticket.id, actorId: actor.id, type: "CREATED", data: { number: ticket.number, ...(origin ? { via: origin.apiKeyName } : {}) } },
    });
    await slaOnCreate(tx, ticket.id, new Date());
    await emitTicketEvent(tx, "ticket.created", ticket.id);
    for (const hook of createdHooks) await hook(tx, ticket);
    return tx.ticket.findUniqueOrThrow({ where: { id: ticket.id }, include });
  });
}

async function requireCategory(tx: Tx, categoryId: string) {
  const category = await tx.category.findUnique({ where: { id: categoryId } });
  if (!category) throw new AppError(400, "Categoria não encontrada.");
  return category;
}

/** Aplica campos editáveis dentro de uma transação já aberta. */
async function applyFields(tx: Tx, actor: SessionUser, current: TicketWithRefs, patch: UpdateTicketInput): Promise<void> {
  if (!can(actor, "ticket:update", current)) throw new ForbiddenError();
  if (patch.categoryId) await requireCategory(tx, patch.categoryId);

  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const old = (current as Record<string, unknown>)[key];
    if (old !== value) {
      before[key] = old;
      after[key] = value;
    }
  }
  if (Object.keys(after).length === 0) return;

  await tx.ticket.update({ where: { id: current.id }, data: patch });
  if (patch.priority && patch.priority !== current.priority) await slaOnPriorityChange(tx, current.id, new Date());
  await tx.ticketEvent.create({
    data: { ticketId: current.id, actorId: actor.id, type: "UPDATED", data: { before, after } as Prisma.InputJsonValue },
  });
}

/** Valida e aplica a transição de status dentro de uma transação já aberta. */
async function applyStatus(tx: Tx, actor: SessionUser, current: TicketWithRefs, to: TicketStatus): Promise<void> {
  if (!can(actor, "ticket:update", current)) throw new ForbiddenError();
  if (to === "CLOSED" && !can(actor, "ticket:close", current)) throw new ForbiddenError();
  if (!TRANSITIONS[current.status].includes(to)) throw new InvalidTransitionError(current.status, to);

  const now = new Date();
  // Atualização condicional ao status lido: se outra pessoa mudou o chamado entretanto, count = 0.
  const claimed = await tx.ticket.updateMany({
    where: { id: current.id, status: current.status },
    data: {
      status: to,
      resolvedAt: to === "RESOLVED" ? now : to === "OPEN" ? null : undefined,
      closedAt: to === "CLOSED" ? now : undefined,
    },
  });
  if (claimed.count !== 1) {
    throw new AppError(409, "O chamado foi alterado por outra pessoa. Atualize a página e tente de novo.");
  }
  await tx.ticketEvent.create({
    data: { ticketId: current.id, actorId: actor.id, type: "STATUS_CHANGED", data: { from: current.status, to } },
  });
  await slaOnStatusChange(tx, current.id, current.status, to, now);
  await emitTicketEvent(tx, "ticket.status_changed", current.id, { from: current.status, to });
}

export async function updateTicket(actor: SessionUser, id: string, patch: UpdateTicketInput): Promise<TicketWithRefs> {
  return patchTicket(actor, id, { fields: patch });
}

export async function changeStatus(actor: SessionUser, id: string, to: TicketStatus): Promise<TicketWithRefs> {
  return patchTicket(actor, id, { fields: {}, status: to });
}

/** Campos e status numa única transação: se a transição for inválida, nenhum campo é gravado. */
export async function patchTicket(
  actor: SessionUser,
  id: string,
  input: { fields: UpdateTicketInput; status?: TicketStatus },
): Promise<TicketWithRefs> {
  const current = await loadVisible(actor, id);
  return getDb().$transaction(async (tx) => {
    if (input.status) {
      // Valida a transição antes de tocar nos campos (falha cedo, sem gravar nada).
      if (!TRANSITIONS[current.status].includes(input.status)) throw new InvalidTransitionError(current.status, input.status);
    }
    if (Object.keys(input.fields).length > 0) await applyFields(tx, actor, current, input.fields);
    if (input.status) await applyStatus(tx, actor, current, input.status);
    return tx.ticket.findUniqueOrThrow({ where: { id }, include });
  });
}

function scopeWhere(actor: SessionUser, scope: ListTicketsQuery["scope"]): Prisma.TicketWhereInput {
  if (scope === "assigned") return { assigneeId: actor.id };
  if (scope === "team") return { teamId: { in: actor.teamIds } };
  if (scope === "mine") return { requesterId: actor.id };
  return {};
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
      scopeWhere(actor, query.scope),
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
