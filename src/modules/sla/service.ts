import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emitTicketEvent } from "@/modules/integrations";
import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from "./calendar";
import { slaState } from "./state";

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

const PAUSED_STATUSES = ["PENDING", "RESOLVED", "CLOSED"];

/**
 * Aplica a política da prioridade atual e recalcula os prazos. Zera as marcas de alerta (o job reavalia com o novo
 * prazo). Chamado que ainda não tinha SLA (legado) começa a contar a partir de `now`; chamado em pausa sem `pausedAt`
 * passa a ficar pausado.
 */
async function applyPolicy(tx: Tx, ticketId: string, now: Date, opts: { isCreation: boolean }): Promise<void> {
  const t = await tx.ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const policy = await tx.slaPolicy.findUnique({ where: { priority: t.priority } });
  if (!policy) {
    logger.warn({ ticketId, priority: t.priority }, "sem política de SLA para a prioridade");
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        slaFirstResponseMinutes: null,
        slaResolutionMinutes: null,
        firstResponseDue: null,
        resolutionDue: null,
        slaWarnedAt: null,
        slaBreachedAt: null,
      },
    });
    return;
  }
  const cal = await loadCalendar(tx);
  let pausedMinutes = t.pausedMinutes;
  if (!opts.isCreation && t.slaResolutionMinutes == null) {
    pausedMinutes += businessMinutesBetween(t.createdAt, now, cal); // legado: o tempo antes de ter SLA não conta
  }
  const pausedAt = t.pausedAt ?? (PAUSED_STATUSES.includes(t.status) ? now : null);
  const fields = { ...t, pausedMinutes, slaFirstResponseMinutes: policy.firstResponseMinutes, slaResolutionMinutes: policy.resolutionMinutes };
  const due = deadlines(fields, cal);
  await tx.ticket.update({
    where: { id: ticketId },
    data: {
      slaFirstResponseMinutes: policy.firstResponseMinutes,
      slaResolutionMinutes: policy.resolutionMinutes,
      firstResponseDue: due?.firstResponseDue ?? null,
      resolutionDue: due?.resolutionDue ?? null,
      pausedMinutes,
      pausedAt,
      slaWarnedAt: null,
      slaBreachedAt: null,
    },
  });
}

export async function slaOnCreate(tx: Tx, ticketId: string, now: Date): Promise<void> {
  await applyPolicy(tx, ticketId, now, { isCreation: true });
}

/** Mudança de prioridade: minutos da nova política, mantendo as pausas já acumuladas. */
export async function slaOnPriorityChange(tx: Tx, ticketId: string, now: Date): Promise<void> {
  await applyPolicy(tx, ticketId, now, { isCreation: false });
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

/**
 * Varredura do job `sla.scan`: publica `sla.warning` (em risco) e `sla.breached` (vencido) uma vez por chamado.
 * A marcação é condicional (`updateMany ... IS NULL`), então duas varreduras simultâneas não duplicam o aviso.
 */
export async function scanSla(now: Date = new Date()): Promise<{ warned: number; breached: number }> {
  const db = getDb();
  const cal = await loadCalendar();
  const open = await db.ticket.findMany({
    where: { status: { notIn: ["RESOLVED", "CLOSED"] }, pausedAt: null, resolutionDue: { not: null }, slaBreachedAt: null },
    select: { id: true, status: true, createdAt: true, resolutionDue: true, slaResolutionMinutes: true, pausedAt: true, pausedMinutes: true, slaWarnedAt: true },
  });
  let warned = 0;
  let breached = 0;
  for (const t of open) {
    const { state, remainingMinutes } = slaState(t, now, cal);
    if (state === "breached") {
      const sent = await db.$transaction(async (tx) => {
        const claimed = await tx.ticket.updateMany({ where: { id: t.id, slaBreachedAt: null }, data: { slaBreachedAt: now } });
        if (claimed.count !== 1) return false;
        await emitTicketEvent(tx, "sla.breached", t.id, { resolutionDue: t.resolutionDue });
        return true;
      });
      if (sent) breached++;
    } else if (state === "at_risk" && !t.slaWarnedAt) {
      const sent = await db.$transaction(async (tx) => {
        const claimed = await tx.ticket.updateMany({ where: { id: t.id, slaWarnedAt: null }, data: { slaWarnedAt: now } });
        if (claimed.count !== 1) return false;
        await emitTicketEvent(tx, "sla.warning", t.id, { resolutionDue: t.resolutionDue, remainingMinutes });
        return true;
      });
      if (sent) warned++;
    }
  }
  if (warned || breached) logger.info({ warned, breached }, "alertas de SLA publicados");
  return { warned, breached };
}
