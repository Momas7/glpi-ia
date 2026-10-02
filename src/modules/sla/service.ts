import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from "./calendar";

type Tx = Prisma.TransactionClient;
type Status = "NEW" | "OPEN" | "PENDING" | "RESOLVED" | "CLOSED";
type Role = "REQUESTER" | "AGENT" | "TEAM_LEAD" | "ADMIN";

const CACHE_MS = 5 * 60 * 1000;
let cache: { cal: BusinessCalendar; at: number } | undefined;

export function invalidateCalendarCache(): void {
  cache = undefined;
}

/** Expediente e feriados do banco, no fuso APP_TIMEZONE. Cache de 5 min por processo (invalidado quando o admin edita). */
export async function loadCalendar(db: Tx | ReturnType<typeof getDb> = getDb()): Promise<BusinessCalendar> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.cal;
  const [hours, holidays] = await Promise.all([db.businessHours.findMany(), db.holiday.findMany({ select: { date: true } })]);
  const cal: BusinessCalendar = {
    timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo",
    hours: new Map(hours.map((h) => [h.weekday, { start: h.startMinute, end: h.endMinute }])),
    holidays: new Set(holidays.map((h) => h.date.toISOString().slice(0, 10))),
  };
  cache = { cal, at: Date.now() };
  return cal;
}

interface SlaFields {
  createdAt: Date;
  slaFirstResponseMinutes: number | null;
  slaResolutionMinutes: number | null;
  pausedMinutes: number;
}

/** Prazos sempre recalculados a partir da criação: minutos da política + pausas acumuladas. */
function deadlines(t: SlaFields, cal: BusinessCalendar) {
  if (t.slaFirstResponseMinutes == null || t.slaResolutionMinutes == null) return null;
  try {
    return {
      firstResponseDue: addBusinessMinutes(t.createdAt, t.slaFirstResponseMinutes + t.pausedMinutes, cal),
      resolutionDue: addBusinessMinutes(t.createdAt, t.slaResolutionMinutes + t.pausedMinutes, cal),
    };
  } catch (err) {
    // Calendário inválido nunca impede abrir ou mudar um chamado: fica sem prazo e registra.
    logger.error({ err }, "não foi possível calcular o prazo de SLA");
    return null;
  }
}

async function applyPolicy(tx: Tx, ticketId: string): Promise<void> {
  const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const policy = await tx.slaPolicy.findUnique({ where: { priority: t.priority } });
  if (!policy) {
    logger.warn({ ticketId, priority: t.priority }, "sem política de SLA para a prioridade");
    await tx.ticket.update({
      where: { id: ticketId },
      data: { slaFirstResponseMinutes: null, slaResolutionMinutes: null, firstResponseDue: null, resolutionDue: null },
    });
    return;
  }
  const fields = { ...t, slaFirstResponseMinutes: policy.firstResponseMinutes, slaResolutionMinutes: policy.resolutionMinutes };
  const due = deadlines(fields, await loadCalendar(tx));
  await tx.ticket.update({
    where: { id: ticketId },
    data: {
      slaFirstResponseMinutes: policy.firstResponseMinutes,
      slaResolutionMinutes: policy.resolutionMinutes,
      firstResponseDue: due?.firstResponseDue ?? null,
      resolutionDue: due?.resolutionDue ?? null,
    },
  });
}

export async function slaOnCreate(tx: Tx, ticketId: string, _now: Date): Promise<void> {
  await applyPolicy(tx, ticketId);
}

/** Mudança de prioridade: minutos da nova política, mantendo as pausas já acumuladas. */
export async function slaOnPriorityChange(tx: Tx, ticketId: string, _now: Date): Promise<void> {
  await applyPolicy(tx, ticketId);
}

/**
 * Pendente e Resolvido pausam o relógio. Ao sair da pausa, o tempo pausado (em minutos úteis) é somado e os prazos
 * recalculados; ao reabrir, os alertas podem disparar de novo.
 */
export async function slaOnStatusChange(tx: Tx, ticketId: string, from: Status, to: Status, now: Date): Promise<void> {
  const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (t.slaResolutionMinutes == null) return;
  const cal = await loadCalendar(tx);
  let pausedMinutes = t.pausedMinutes;
  let pausedAt = t.pausedAt;
  const data: Prisma.TicketUpdateInput = {};

  const leavingPause = (from === "PENDING" || from === "RESOLVED") && to !== "PENDING" && to !== "RESOLVED" && to !== "CLOSED";
  if (leavingPause && pausedAt) {
    pausedMinutes += businessMinutesBetween(pausedAt, now, cal);
    pausedAt = null;
    const due = deadlines({ ...t, pausedMinutes }, cal);
    Object.assign(data, { pausedMinutes, pausedAt: null, firstResponseDue: due?.firstResponseDue, resolutionDue: due?.resolutionDue });
    if (from === "RESOLVED") Object.assign(data, { slaWarnedAt: null, slaBreachedAt: null, resolutionBusinessMinutes: null });
  }
  if (to === "PENDING" && !pausedAt) data.pausedAt = now;
  if (to === "RESOLVED") {
    data.resolutionBusinessMinutes = Math.max(0, businessMinutesBetween(t.createdAt, now, cal) - pausedMinutes);
    if (!pausedAt) data.pausedAt = now;
  }
  if (Object.keys(data).length > 0) await tx.ticket.update({ where: { id: ticketId }, data });
}

/** 1ª resposta: primeiro comentário público de alguém da equipe que não seja o solicitante. */
export async function slaOnComment(
  tx: Tx,
  ticketId: string,
  author: { id: string; role: Role },
  internal: boolean,
  now: Date,
): Promise<void> {
  if (internal || author.role === "REQUESTER") return;
  const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  if (t.firstRespondedAt || t.requesterId === author.id) return;
  const cal = await loadCalendar(tx);
  const ongoingPause = t.pausedAt ? businessMinutesBetween(t.pausedAt, now, cal) : 0;
  await tx.ticket.update({
    where: { id: ticketId },
    data: {
      firstRespondedAt: now,
      firstResponseBusinessMinutes: Math.max(0, businessMinutesBetween(t.createdAt, now, cal) - t.pausedMinutes - ongoingPause),
    },
  });
}
