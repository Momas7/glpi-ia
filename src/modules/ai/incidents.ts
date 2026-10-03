import type { Prisma } from "@/generated/prisma/client";
import { getDb, type Db } from "@/lib/db";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { emitEvent } from "@/modules/integrations";
import { recordAudit } from "@/modules/audit";
import { can, type SessionUser } from "@/modules/auth";
import { enableIterativeScan } from "./embed-utils";
import { mask } from "./masking";
import { dbOf, nowOf, resolveDetectConfig, vectorLiteralOf, type DetectDeps } from "./detect-shared";

export interface IncidentRow {
  id: string;
  title: string;
  status: "OPEN" | "CLOSED";
  detectedAt: Date;
  closedAt: Date | null;
  /** Total de chamados do grupo (todas as equipes). */
  ticketCount: number;
  /** Só os chamados que quem consulta pode abrir. */
  tickets: { id: string; number: number; title: string; status: string; teamName: string | null }[];
}

const TITLE_LIMIT = 120;

/**
 * Agrupa chamados abertos parecidos que chegaram juntos (qualquer equipe, janela curta). Com o mínimo de chamados:
 * entra no grupo aberto que algum deles já tenha, ou cria um grupo e avisa o n8n (uma vez por grupo).
 * A trava consultiva garante que execuções simultâneas para o mesmo conjunto criem um grupo só.
 */
export async function detectIncident(ticketId: string, deps: DetectDeps = {}): Promise<{ groupId: string; created: boolean } | null> {
  const db = dbOf(deps);
  const cfg = resolveDetectConfig(deps);
  const vec = await vectorLiteralOf(db, ticketId);
  if (!vec) return null;
  const since = new Date(nowOf(deps).getTime() - cfg.incidentWindowMinutes * 60_000);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('incident-detect'))`;
    await enableIterativeScan(tx);
    const rows = await tx.$queryRaw<{ id: string; title: string; createdAt: Date; incidentGroupId: string | null; groupStatus: string | null; teamName: string | null }[]>`
      SELECT t."id", t."title", t."createdAt", t."incidentGroupId", g."status"::text AS "groupStatus", tm."name" AS "teamName"
      FROM "OpenTicketVector" v
      JOIN "Ticket" t ON t."id" = v."ticketId"
      LEFT JOIN "Team" tm ON tm."id" = t."teamId"
      LEFT JOIN "IncidentGroup" g ON g."id" = t."incidentGroupId"
      WHERE t."status" IN ('NEW', 'OPEN', 'PENDING')
        AND t."createdAt" >= ${since}
        AND (t."teamId" IS NULL OR tm."aiEnabled" = true)
        AND (t."incidentGroupId" IS NULL OR g."status" = 'OPEN')
        AND (t."id" = ${ticketId} OR 1 - (v."embedding" <=> ${vec}::vector) >= ${cfg.incidentMinSimilarity})
      ORDER BY t."createdAt" ASC`;
    if (!rows.some((r) => r.id === ticketId) || rows.length < cfg.incidentMinTickets) return null;

    const existing = rows.find((r) => r.incidentGroupId && r.groupStatus === "OPEN")?.incidentGroupId;
    const ids = rows.map((r) => r.id);
    if (existing) {
      await tx.ticket.updateMany({
        where: { id: { in: ids }, OR: [{ incidentGroupId: null }, { incidentGroup: { status: "CLOSED" } }] },
        data: { incidentGroupId: existing },
      });
      return { groupId: existing, created: false };
    }

    // O título vai ao n8n e a todos os gestores do grupo: sai mascarado.
    const group = await tx.incidentGroup.create({ data: { title: mask(rows[0].title).text.slice(0, TITLE_LIMIT) } });
    await tx.ticket.updateMany({ where: { id: { in: ids } }, data: { incidentGroupId: group.id } });
    const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const teams = [...new Set(rows.map((r) => r.teamName).filter((n): n is string => !!n))].sort();
    await emitEvent(
      tx,
      "incident.detected",
      { id: group.id, title: group.title, ticketCount: ids.length, teams, url: `${appUrl}/incidentes`, detectedAt: group.detectedAt.toISOString() },
      { subjectId: group.id },
    );
    return { groupId: group.id, created: true };
  });
}

/** Fecha os grupos abertos em que todos os chamados já terminaram (resolvidos ou fechados). */
export async function closeFinishedIncidents(db: Db): Promise<number> {
  return db.$executeRaw`
    UPDATE "IncidentGroup" g SET "status" = 'CLOSED', "closedAt" = now()
    WHERE g."status" = 'OPEN'
      AND NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."incidentGroupId" = g."id" AND t."status" IN ('NEW', 'OPEN', 'PENDING'))`;
}

/** Líder só enxerga/encerra grupo com ao menos um chamado de equipe dele; admin, todos. */
function visibleWhere(actor: SessionUser): Prisma.IncidentGroupWhereInput {
  return actor.role === "ADMIN" ? {} : { tickets: { some: { teamId: { in: actor.teamIds } } } };
}

export async function closeIncident(actor: SessionUser, groupId: string): Promise<void> {
  if (!can(actor, "incident:close")) throw new ForbiddenError();
  await getDb().$transaction(async (tx) => {
    const group = await tx.incidentGroup.findFirst({ where: { id: groupId, ...visibleWhere(actor) } });
    if (!group) throw new NotFoundError("Incidente não encontrado.");
    const closed = await tx.incidentGroup.updateMany({
      where: { id: groupId, status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date(), closedById: actor.id },
    });
    if (closed.count !== 1) throw new AppError(409, "Este incidente já foi encerrado.");
    await recordAudit(tx, { actorId: actor.id, action: "incident.close", targetType: "incident", targetId: groupId, data: { title: group.title } });
  });
}

async function rows(db: Db, actor: SessionUser, where: Prisma.IncidentGroupWhereInput, orderBy: Prisma.IncidentGroupOrderByWithRelationInput, take?: number): Promise<IncidentRow[]> {
  const groups = await db.incidentGroup.findMany({
    where: { ...visibleWhere(actor), ...where },
    orderBy,
    take,
    include: {
      _count: { select: { tickets: true } },
      tickets: {
        where: actor.role === "ADMIN" ? {} : { teamId: { in: actor.teamIds } },
        orderBy: { createdAt: "asc" },
        select: { id: true, number: true, title: true, status: true, team: { select: { name: true } } },
      },
    },
  });
  return groups.map((g) => ({
    id: g.id,
    title: g.title,
    status: g.status,
    detectedAt: g.detectedAt,
    closedAt: g.closedAt,
    ticketCount: g._count.tickets,
    tickets: g.tickets.map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, teamName: t.team?.name ?? null })),
  }));
}

export async function listIncidents(actor: SessionUser): Promise<{ open: IncidentRow[]; recentClosed: IncidentRow[] }> {
  if (!can(actor, "incident:view")) throw new ForbiddenError();
  const db = getDb();
  const [open, recentClosed] = await Promise.all([
    rows(db, actor, { status: "OPEN" }, { detectedAt: "desc" }),
    rows(db, actor, { status: "CLOSED" }, { closedAt: "desc" }, 10),
  ]);
  return { open, recentClosed };
}

/** Faixa do topo: incidentes abertos que o gestor pode ver (vazio para quem não tem a permissão). */
export async function getOpenIncidentBanner(actor: SessionUser): Promise<{ id: string; title: string; ticketCount: number }[]> {
  if (!can(actor, "incident:view")) return [];
  const open = await rows(getDb(), actor, { status: "OPEN" }, { detectedAt: "desc" });
  return open.map((g) => ({ id: g.id, title: g.title, ticketCount: g.ticketCount }));
}

/** Aviso no chamado que faz parte de um incidente aberto, para a equipe que pode atendê-lo (nunca o solicitante). */
export async function getIncidentNotice(
  actor: SessionUser,
  ticket: { id: string; incidentGroupId: string | null; requesterId: string; teamId: string | null; assigneeId: string | null; status: string },
): Promise<{ id: string; title: string; ticketCount: number } | null> {
  if (!ticket.incidentGroupId || !can(actor, "ai:decide", ticket as never)) return null;
  const group = await getDb().incidentGroup.findUnique({
    where: { id: ticket.incidentGroupId },
    include: { _count: { select: { tickets: true } } },
  });
  if (!group || group.status !== "OPEN") return null;
  return { id: group.id, title: group.title, ticketCount: group._count.tickets };
}
