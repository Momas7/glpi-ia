import { TZDate } from "@date-fns/tz";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { noTeams, scopeSql, utc, type DateRange, type Scope } from "./queries";

/** Intervalo em coluna "nua" de um alias qualquer (para o Postgres poder usar índice). */
const inRange = (ref: string, r: DateRange): Prisma.Sql => Prisma.sql`${Prisma.raw(ref)} >= ${utc(r.from)} AND ${Prisma.raw(ref)} < ${utc(r.to)}`;

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const roundOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Math.round(Number(v)));
const pad = (n: number) => String(n).padStart(2, "0");

export interface CsatData {
  average: number | null;
  count: number;
  distribution: { stars: 1 | 2 | 3 | 4 | 5; count: number }[];
  trend: { month: string; average: number | null; count: number }[];
}

const STARS = [1, 2, 3, 4, 5] as const;

/** Satisfação: avaliações do atendimento dos chamados do escopo, pelo momento em que foram dadas. */
export async function queryCsat(scope: Scope, range: DateRange, months: Date[], timeZone: string): Promise<CsatData> {
  const monthKeys = months.map((m) => {
    const z = new TZDate(m.getTime(), timeZone);
    return `${z.getFullYear()}-${pad(z.getMonth() + 1)}`;
  });
  const empty: CsatData = {
    average: null,
    count: 0,
    distribution: STARS.map((stars) => ({ stars, count: 0 })),
    trend: monthKeys.map((month) => ({ month, average: null, count: 0 })),
  };
  if (noTeams(scope)) return empty;
  const db = getDb();
  const base = Prisma.sql`FROM "TicketRating" r JOIN "Ticket" t ON t."id" = r."ticketId" WHERE ${scopeSql(scope)}`;

  const [totals, dist, trend] = await Promise.all([
    db.$queryRaw<{ n: number; avg: unknown }[]>(Prisma.sql`SELECT COUNT(*)::int AS n, AVG(r."stars") AS avg ${base} AND ${inRange('r."createdAt"', range)}`),
    db.$queryRaw<{ stars: number; n: number }[]>(Prisma.sql`SELECT r."stars", COUNT(*)::int AS n ${base} AND ${inRange('r."createdAt"', range)} GROUP BY r."stars"`),
    months.length === 0
      ? Promise.resolve([] as { month: string; n: number; avg: unknown }[])
      : db.$queryRaw<{ month: string; n: number; avg: unknown }[]>(Prisma.sql`
          SELECT to_char(((r."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM') AS month, COUNT(*)::int AS n, AVG(r."stars") AS avg
          ${base} AND r."createdAt" >= ${utc(months[0])}
          GROUP BY 1`),
  ]);
  const byStars = new Map(dist.map((d) => [d.stars, d.n]));
  const byMonth = new Map(trend.map((t) => [t.month, t]));
  return {
    average: totals[0].n === 0 ? null : Number(totals[0].avg),
    count: totals[0].n,
    distribution: STARS.map((stars) => ({ stars, count: byStars.get(stars) ?? 0 })),
    trend: monthKeys.map((month) => {
      const row = byMonth.get(month);
      return { month, average: row ? Number(row.avg) : null, count: row?.n ?? 0 };
    }),
  };
}

export interface AiAssistData {
  triage: { suggested: number; accepted: number; edited: number; rejected: number; pending: number; acceptRate: number | null };
  drafts: { generated: number; published: number };
  duplicates: { suggested: number; dismissed: number };
  summaries: number;
  incidents: number;
}

/** O que a IA fez no atendimento dos chamados do escopo e o que a equipe decidiu. */
export async function queryAiAssist(scope: Scope, range: DateRange): Promise<AiAssistData> {
  const zero: AiAssistData = {
    triage: { suggested: 0, accepted: 0, edited: 0, rejected: 0, pending: 0, acceptRate: null },
    drafts: { generated: 0, published: 0 },
    duplicates: { suggested: 0, dismissed: 0 },
    summaries: 0,
    incidents: 0,
  };
  if (noTeams(scope)) return zero;
  const db = getDb();
  const [suggestions, events, incidents] = await Promise.all([
    db.$queryRaw<{ kind: string; status: string; n: number }[]>(Prisma.sql`
      SELECT s."kind"::text AS kind, s."status"::text AS status, COUNT(*)::int AS n
      FROM "AiSuggestion" s JOIN "Ticket" t ON t."id" = s."ticketId"
      WHERE s."kind" IN ('TRIAGE', 'DUPLICATE') AND ${scopeSql(scope)} AND ${inRange('s."createdAt"', range)}
      GROUP BY 1, 2`),
    db.$queryRaw<{ type: string; n: number }[]>(Prisma.sql`
      SELECT e."type", COUNT(*)::int AS n
      FROM "TicketEvent" e JOIN "Ticket" t ON t."id" = e."ticketId"
      WHERE e."type" IN ('AI_DRAFT', 'AI_DRAFT_PUBLISHED', 'AI_SUMMARY') AND ${scopeSql(scope)} AND ${inRange('e."createdAt"', range)}
      GROUP BY 1`),
    db.$queryRaw<{ n: number }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT g."id")::int AS n
      FROM "IncidentGroup" g JOIN "Ticket" t ON t."incidentGroupId" = g."id"
      WHERE ${scopeSql(scope)} AND ${inRange('g."detectedAt"', range)}`),
  ]);
  const sug = (kind: string, status?: string) =>
    suggestions.filter((s) => s.kind === kind && (!status || s.status === status)).reduce((n, s) => n + s.n, 0);
  const ev = (type: string) => events.find((e) => e.type === type)?.n ?? 0;
  const accepted = sug("TRIAGE", "ACCEPTED");
  const edited = sug("TRIAGE", "EDITED");
  const rejected = sug("TRIAGE", "REJECTED");
  const decided = accepted + edited + rejected;
  return {
    triage: {
      suggested: sug("TRIAGE"),
      accepted,
      edited,
      rejected,
      pending: sug("TRIAGE", "PENDING"),
      acceptRate: decided === 0 ? null : (accepted + edited) / decided,
    },
    drafts: { generated: ev("AI_DRAFT"), published: ev("AI_DRAFT_PUBLISHED") },
    duplicates: { suggested: sug("DUPLICATE"), dismissed: sug("DUPLICATE", "REJECTED") },
    summaries: ev("AI_SUMMARY"),
    incidents: incidents[0]?.n ?? 0,
  };
}

export interface AiUsageData {
  totals: { calls: number; failed: number; blocked: number; inputTokens: number; outputTokens: number; costUsd: number };
  byTask: {
    jobType: string;
    calls: number;
    failed: number;
    blocked: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    p50Ms: number | null;
    p95Ms: number | null;
  }[];
  costByDay: { day: string; costUsd: number }[];
}

/** Uso e custo de IA (global, só para o admin): o que foi chamado, quanto custou e quão rápido respondeu. */
export async function queryAiUsage(range: DateRange, timeZone: string): Promise<AiUsageData> {
  const db = getDb();
  const [tasks, days] = await Promise.all([
    db.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
      SELECT a."jobType",
        COUNT(*)::int AS calls,
        COUNT(*) FILTER (WHERE a."outcome" = 'FAILED')::int AS failed,
        COUNT(*) FILTER (WHERE a."outcome" = 'BUDGET')::int AS blocked,
        COALESCE(SUM(a."inputTokens"), 0)::bigint AS "inputTokens",
        COALESCE(SUM(a."outputTokens"), 0)::bigint AS "outputTokens",
        COALESCE(SUM(a."costUsd"), 0) AS cost,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY a."latencyMs") FILTER (WHERE a."outcome" = 'OK') AS p50,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY a."latencyMs") FILTER (WHERE a."outcome" = 'OK') AS p95
      FROM "AiAuditLog" a
      WHERE ${inRange('a."createdAt"', range)}
      GROUP BY a."jobType"
      ORDER BY cost DESC, a."jobType" ASC`),
    db.$queryRaw<{ day: string; cost: unknown }[]>(Prisma.sql`
      SELECT to_char(((a."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS day, COALESCE(SUM(a."costUsd"), 0) AS cost
      FROM "AiAuditLog" a
      WHERE ${inRange('a."createdAt"', range)}
      GROUP BY 1 ORDER BY 1`),
  ]);
  const byTask = tasks.map((t) => ({
    jobType: String(t.jobType),
    calls: num(t.calls),
    failed: num(t.failed),
    blocked: num(t.blocked),
    inputTokens: num(t.inputTokens),
    outputTokens: num(t.outputTokens),
    costUsd: num(t.cost),
    p50Ms: roundOrNull(t.p50),
    p95Ms: roundOrNull(t.p95),
  }));
  const sum = (pick: (t: (typeof byTask)[number]) => number) => byTask.reduce((n, t) => n + pick(t), 0);
  return {
    totals: {
      calls: sum((t) => t.calls),
      failed: sum((t) => t.failed),
      blocked: sum((t) => t.blocked),
      inputTokens: sum((t) => t.inputTokens),
      outputTokens: sum((t) => t.outputTokens),
      costUsd: sum((t) => t.costUsd),
    },
    byTask,
    costByDay: days.map((d) => ({ day: d.day, costUsd: num(d.cost) })),
  };
}

/** Há linha de demonstração no período? `includeUsage` só para quem enxerga o uso de IA (admin). */
export async function queryHasDemo(scope: Scope, range: DateRange, includeUsage: boolean): Promise<boolean> {
  const db = getDb();
  if (includeUsage) {
    const [row] = await db.$queryRaw<{ found: boolean }[]>(Prisma.sql`
      SELECT EXISTS (SELECT 1 FROM "AiAuditLog" a WHERE a."demo" AND ${inRange('a."createdAt"', range)}) AS found`);
    if (row.found) return true;
  }
  if (noTeams(scope)) return false;
  const [row] = await db.$queryRaw<{ found: boolean }[]>(Prisma.sql`
    SELECT (
      EXISTS (SELECT 1 FROM "AiSuggestion" s JOIN "Ticket" t ON t."id" = s."ticketId" WHERE s."demo" AND ${scopeSql(scope)} AND ${inRange('s."createdAt"', range)})
      OR EXISTS (SELECT 1 FROM "TicketRating" r JOIN "Ticket" t ON t."id" = r."ticketId" WHERE r."demo" AND ${scopeSql(scope)} AND ${inRange('r."createdAt"', range)})
    ) AS found`);
  return row.found;
}
