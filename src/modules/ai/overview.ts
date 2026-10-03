import type { Priority } from "@/generated/prisma/client";
import { getConfig, type Config } from "@/lib/config";
import { enqueue } from "@/lib/queue";
import { getDb } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { recordAudit } from "@/modules/audit";
import { can, type SessionUser } from "@/modules/auth";
import { TicketNotFoundError, getTicket, type TicketWithRefs } from "@/modules/tickets";
import { stripCitations, teamAiEnabled, type DraftSourceRef } from "./draft";
import { realComments } from "./summary";
import { getEmbeddingProvider } from "./embedding/factory";
import { defaultTriageModel } from "./pricing";
import { getLlmProvider } from "./provider/factory";
import { AI_REINDEX_QUEUE } from "./enqueue";
import { startOfDay } from "./run";
import { isSuggestionStale, type TriageBasis } from "./stale";

export interface PendingTriage {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  priority: Priority;
  teamId: string | null;
  teamName: string | null;
  confidence: number;
  /** Categoria e equipe do chamado agora: o editor parte delas quando a sugestão diz "manter". */
  current: { categoryId: string | null; teamId: string | null };
  options: { categories: { id: string; name: string }[]; teams: { id: string; name: string }[] };
}

interface TriagePayload {
  categoryId: string | null;
  priority: Priority;
  teamId: string | null;
  basis: TriageBasis;
}

/** A sugestão pendente do chamado, só para quem pode decidi-la (nunca o solicitante). */
export async function getPendingTriage(actor: SessionUser, ticket: TicketWithRefs): Promise<PendingTriage | null> {
  if (!can(actor, "ai:decide", ticket)) return null;
  const db = getDb();
  const s = await db.aiSuggestion.findFirst({ where: { ticketId: ticket.id, kind: "TRIAGE", status: "PENDING" } });
  if (!s) return null;
  const payload = s.payload as unknown as TriagePayload;
  if (isSuggestionStale(ticket, payload.basis)) return null;
  const [categories, teams] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    id: s.id,
    categoryId: payload.categoryId,
    categoryName: categories.find((c) => c.id === payload.categoryId)?.name ?? null,
    priority: payload.priority,
    teamId: payload.teamId,
    teamName: teams.find((t) => t.id === payload.teamId)?.name ?? null,
    confidence: s.confidence,
    current: { categoryId: ticket.categoryId, teamId: ticket.teamId },
    options: { categories, teams },
  };
}

/** Ids dos chamados da lista com sugestão pendente que o usuário pode decidir (uma consulta só). */
export async function pendingTriageTicketIds(actor: SessionUser, tickets: TicketWithRefs[]): Promise<Set<string>> {
  const decidable = tickets.filter((t) => can(actor, "ai:decide", t));
  if (decidable.length === 0) return new Set();
  const rows = await getDb().aiSuggestion.findMany({
    where: { ticketId: { in: decidable.map((t) => t.id) }, kind: "TRIAGE", status: "PENDING" },
    select: { ticketId: true, payload: true },
  });
  const byId = new Map(decidable.map((t) => [t.id, t]));
  return new Set(
    rows
      .filter((r) => !isSuggestionStale(byId.get(r.ticketId)!, (r.payload as unknown as TriagePayload).basis))
      .map((r) => r.ticketId),
  );
}

type OverviewConfig = Pick<
  Config,
  | "AI_ENABLED"
  | "LLM_PROVIDER"
  | "EMBEDDING_PROVIDER"
  | "GEMINI_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "AI_MODEL_TRIAGE"
  | "AI_DAILY_BUDGET"
  | "APP_TIMEZONE"
>;

export interface AiOverview {
  enabled: boolean;
  reason: string | null;
  /** Por que a busca por conhecimento (embeddings) não funciona, quando não funciona. */
  ragReason: string | null;
  knowledge: { articles: number; chunks: number; tickets: number };
  detection: { duplicatesSuggested: number; duplicatesDismissed: number; incidentsDetected: number; incidentsOpen: number };
  provider: string;
  model: string;
  spentTodayUsd: number;
  budgetUsd: number;
  acceptance: { pending: number; accepted: number; edited: number; rejected: number };
  teams: { id: string; name: string; aiEnabled: boolean }[];
  recent: {
    id: string;
    createdAt: Date;
    jobType: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    outcome: string;
  }[];
}

function assertAdmin(actor: SessionUser) {
  if (!can(actor, "admin:manage")) throw new ForbiddenError();
}

/** Painel de IA da administração. Não devolve texto de chamado (nem mascarado) nem mensagens de erro. */
export async function getAiOverview(actor: SessionUser, config: OverviewConfig = getConfig()): Promise<AiOverview> {
  assertAdmin(actor);
  const db = getDb();
  const providerReady = getLlmProvider(config) !== null;
  const reason = !config.AI_ENABLED
    ? "IA desligada (AI_ENABLED=false)."
    : !providerReady
      ? `Sem chave de API para o provider ${config.LLM_PROVIDER}.`
      : null;

  const ragReason = getEmbeddingProvider(config) === null ? `Sem chave de API para embeddings (provider ${config.EMBEDDING_PROVIDER}).` : null;

  const [spent, grouped, teams, recent, articles, chunks, indexedTickets, duplicatesSuggested, duplicatesDismissed, incidentsDetected, incidentsOpen] = await Promise.all([
    db.aiAuditLog.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: startOfDay(new Date(), config.APP_TIMEZONE) } } }),
    db.aiSuggestion.groupBy({ by: ["status"], where: { kind: "TRIAGE" }, _count: { _all: true } }),
    db.team.findMany({ select: { id: true, name: true, aiEnabled: true }, orderBy: { name: "asc" } }),
    db.aiAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, createdAt: true, jobType: true, model: true, inputTokens: true, outputTokens: true, costUsd: true, latencyMs: true, outcome: true },
    }),
    db.kbArticle.count({ where: { published: true } }),
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "KbChunk"`,
    db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "TicketEmbedding"`,
    db.aiSuggestion.count({ where: { kind: "DUPLICATE" } }),
    db.aiSuggestion.count({ where: { kind: "DUPLICATE", status: "REJECTED" } }),
    db.incidentGroup.count(),
    db.incidentGroup.count({ where: { status: "OPEN" } }),
  ]);
  const count = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0;
  return {
    enabled: reason === null,
    reason,
    ragReason,
    knowledge: { articles, chunks: Number(chunks[0].n), tickets: Number(indexedTickets[0].n) },
    detection: { duplicatesSuggested, duplicatesDismissed, incidentsDetected, incidentsOpen },
    provider: config.LLM_PROVIDER,
    model: config.AI_MODEL_TRIAGE ?? defaultTriageModel(config.LLM_PROVIDER),
    spentTodayUsd: Number(spent._sum.costUsd ?? 0),
    budgetUsd: config.AI_DAILY_BUDGET,
    acceptance: { pending: count("PENDING"), accepted: count("ACCEPTED"), edited: count("EDITED"), rejected: count("REJECTED") },
    teams,
    recent: recent.map((r) => ({ ...r, costUsd: Number(r.costUsd) })),
  };
}

/** Liga ou desliga a triagem por IA para uma equipe. */
export async function setTeamAi(actor: SessionUser, teamId: string, enabled: boolean): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    const team = await tx.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundError("Equipe não encontrada.");
    await tx.team.update({ where: { id: teamId }, data: { aiEnabled: enabled } });
    await recordAudit(tx, { actorId: actor.id, action: "team.ai_toggle", targetType: "team", targetId: teamId, data: { enabled } });
  });
}

export interface DraftView {
  /** O botão "Sugerir resposta" só aparece com a IA ligada, providers configurados e permissão de atender o chamado. */
  available: boolean;
  draft: { id: string; text: string; sources: DraftSourceRef[] } | null;
}

type DraftViewConfig = Pick<
  Config,
  "AI_ENABLED" | "LLM_PROVIDER" | "EMBEDDING_PROVIDER" | "GEMINI_API_KEY" | "ANTHROPIC_API_KEY"
>;

/** O rascunho de resposta do chamado (nota interna `AI_DRAFT`) e se dá para pedir outro. */
export async function getDraftView(actor: SessionUser, ticket: TicketWithRefs, config: DraftViewConfig = getConfig()): Promise<DraftView> {
  if (!can(actor, "ai:decide", ticket)) return { available: false, draft: null };
  const available =
    config.AI_ENABLED && getLlmProvider(config) !== null && getEmbeddingProvider(config) !== null && (await teamAiEnabled(ticket.teamId));
  if (!can(actor, "comment:read_internal", ticket)) return { available, draft: null };
  const comment = await getDb().comment.findFirst({
    where: { ticketId: ticket.id, source: "AI_DRAFT", internal: true },
    orderBy: { createdAt: "desc" },
  });
  if (!comment) return { available, draft: null };
  return {
    available,
    draft: { id: comment.id, text: stripCitations(comment.body), sources: (comment.sources ?? []) as unknown as DraftSourceRef[] },
  };
}

/** Pede a reindexação de tudo (artigos publicados e chamados resolvidos); o worker processa em lotes, com pausa. */
export async function requestReindex(actor: SessionUser): Promise<void> {
  assertAdmin(actor);
  await getDb().$transaction(async (tx) => {
    await recordAudit(tx, { actorId: actor.id, action: "ai.reindex", targetType: "ai", targetId: "knowledge", data: {} });
    await enqueue(AI_REINDEX_QUEUE, {}, { tx });
  });
}

export interface SummaryView {
  available: boolean;
  /** Comentários do chamado (sem rascunhos da IA): o botão só vale a partir de 3. */
  commentCount: number;
  summary: { text: string; commentCount: number; newComments: number } | null;
}

type SummaryViewConfig = Pick<Config, "AI_ENABLED" | "LLM_PROVIDER" | "GEMINI_API_KEY" | "ANTHROPIC_API_KEY">;

/** O resumo salvo do chamado e quantos comentários vieram depois dele; só para quem atende o chamado. */
export async function getSummaryView(actor: SessionUser, ticket: TicketWithRefs, config: SummaryViewConfig = getConfig()): Promise<SummaryView> {
  if (!can(actor, "ai:decide", ticket)) return { available: false, commentCount: 0, summary: null };
  const db = getDb();
  const available = config.AI_ENABLED && getLlmProvider(config) !== null && (await teamAiEnabled(ticket.teamId));
  const [commentCount, saved] = await Promise.all([
    db.comment.count({ where: { ticketId: ticket.id, ...realComments } }),
    db.aiSuggestion.findUnique({ where: { ticketId_kind: { ticketId: ticket.id, kind: "SUMMARY" } } }),
  ]);
  if (!saved) return { available, commentCount, summary: null };
  const payload = saved.payload as { text: string; commentCount: number; lastCommentId: string };
  const last = await db.comment.findUnique({ where: { id: payload.lastCommentId }, select: { createdAt: true } });
  const newComments = last
    ? await db.comment.count({ where: { ticketId: ticket.id, ...realComments, createdAt: { gt: last.createdAt } } })
    : Math.max(0, commentCount - payload.commentCount);
  return { available, commentCount, summary: { text: payload.text, commentCount: payload.commentCount, newComments } };
}

export interface DuplicatesView {
  id: string;
  candidates: { id: string; number: number; title: string; status: string; similarity: number; canOpen: boolean }[];
}

interface DuplicatePayload {
  candidates: { ticketId: string; number: number; title: string; similarity: number }[];
}

const OPEN_STATUS = ["NEW", "OPEN", "PENDING"];

/** Os possíveis duplicados do chamado (sugestão pendente), só para quem o atende. Candidato encerrado ou apagado sai. */
export async function getDuplicatesView(actor: SessionUser, ticket: TicketWithRefs): Promise<DuplicatesView | null> {
  if (!can(actor, "ai:decide", ticket)) return null;
  const db = getDb();
  const s = await db.aiSuggestion.findFirst({ where: { ticketId: ticket.id, kind: "DUPLICATE", status: "PENDING" } });
  if (!s) return null;
  const payload = s.payload as unknown as DuplicatePayload;
  const current = await db.ticket.findMany({
    where: { id: { in: payload.candidates.map((c) => c.ticketId) } },
    select: { id: true, number: true, title: true, status: true, requesterId: true, teamId: true, assigneeId: true },
  });
  const byId = new Map(current.map((t) => [t.id, t]));
  const candidates = payload.candidates.flatMap((c) => {
    const t = byId.get(c.ticketId);
    if (!t || !OPEN_STATUS.includes(t.status)) return [];
    return [{ id: t.id, number: t.number, title: t.title, status: t.status, similarity: c.similarity, canOpen: can(actor, "ticket:read", t as never) }];
  });
  return candidates.length === 0 ? null : { id: s.id, candidates };
}

/** Ids dos chamados da lista com possível duplicado pendente que o usuário pode decidir (uma consulta só). */
export async function duplicateTicketIds(actor: SessionUser, tickets: TicketWithRefs[]): Promise<Set<string>> {
  const decidable = tickets.filter((t) => can(actor, "ai:decide", t));
  if (decidable.length === 0) return new Set();
  const rows = await getDb().aiSuggestion.findMany({
    where: { ticketId: { in: decidable.map((t) => t.id) }, kind: "DUPLICATE", status: "PENDING" },
    select: { ticketId: true },
  });
  return new Set(rows.map((r) => r.ticketId));
}

/** "Não é duplicado": descarta a sugestão. Decisão única; nada é vinculado nem mesclado. */
export async function dismissDuplicates(actor: SessionUser, ticketId: string): Promise<void> {
  const ticket = await getTicket(actor, ticketId);
  if (!ticket || !can(actor, "ai:decide", ticket)) throw new TicketNotFoundError();
  const db = getDb();
  const s = await db.aiSuggestion.findUnique({ where: { ticketId_kind: { ticketId, kind: "DUPLICATE" } } });
  if (!s) throw new AppError(404, "Sugestão não encontrada.");
  const claimed = await db.aiSuggestion.updateMany({
    where: { id: s.id, status: "PENDING" },
    data: { status: "REJECTED", decidedById: actor.id, decidedAt: new Date() },
  });
  if (claimed.count !== 1) throw new AppError(409, "Esta sugestão já foi decidida.");
}
