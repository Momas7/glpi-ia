import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

/** Escopo de equipes: `null` = todas; lista vazia = nenhuma (sempre zeros). */
export interface Scope {
  teamIds: string[] | null;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface Kpis {
  openNow: number;
  openUnassigned: number;
  atRisk: number;
  breached: number;
  slaPercent: number | null;
  avgFirstResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
}

/** Condição SQL do escopo (sobre a coluna "teamId" de Ticket). Consultas sempre parametrizadas. */
export const scopeSql = (scope: Scope, column = Prisma.sql`t."teamId"`): Prisma.Sql =>
  scope.teamIds === null ? Prisma.sql`TRUE` : Prisma.sql`${column} = ANY(${scope.teamIds}::text[])`;

const ACTIVE = Prisma.sql`t.status IN ('NEW', 'OPEN', 'PENDING')`;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function queryKpis(scope: Scope, period: DateRange, now: Date): Promise<Kpis> {
  if (scope.teamIds !== null && scope.teamIds.length === 0) {
    return { openNow: 0, openUnassigned: 0, atRisk: 0, breached: 0, slaPercent: null, avgFirstResponseMinutes: null, avgResolutionMinutes: null };
  }
  const where = scopeSql(scope);
  const [row] = await getDb().$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE ${ACTIVE})::int AS "openNow",
      COUNT(*) FILTER (WHERE ${ACTIVE} AND t."assigneeId" IS NULL)::int AS "openUnassigned",
      COUNT(*) FILTER (WHERE ${ACTIVE} AND t."pausedAt" IS NULL AND t."slaWarnedAt" IS NOT NULL
                         AND t."resolutionDue" >= ${now})::int AS "atRisk",
      COUNT(*) FILTER (WHERE ${ACTIVE} AND t."pausedAt" IS NULL AND t."resolutionDue" < ${now})::int AS "breached",
      COUNT(*) FILTER (WHERE t."resolvedAt" >= ${period.from} AND t."resolvedAt" < ${period.to}
                         AND t."resolutionDue" IS NOT NULL)::int AS "resolvedWithDue",
      COUNT(*) FILTER (WHERE t."resolvedAt" >= ${period.from} AND t."resolvedAt" < ${period.to}
                         AND t."resolutionDue" IS NOT NULL AND t."resolvedAt" <= t."resolutionDue")::int AS "resolvedInTime",
      AVG(t."firstResponseBusinessMinutes") FILTER (WHERE t."firstRespondedAt" >= ${period.from}
                         AND t."firstRespondedAt" < ${period.to}) AS "avgFirst",
      AVG(t."resolutionBusinessMinutes") FILTER (WHERE t."resolvedAt" >= ${period.from}
                         AND t."resolvedAt" < ${period.to}) AS "avgResolution"
    FROM "Ticket" t
    WHERE ${where}`);
  const withDue = Number(row.resolvedWithDue);
  return {
    openNow: Number(row.openNow),
    openUnassigned: Number(row.openUnassigned),
    atRisk: Number(row.atRisk),
    breached: Number(row.breached),
    slaPercent: withDue === 0 ? null : Math.round((Number(row.resolvedInTime) / withDue) * 100),
    avgFirstResponseMinutes: num(row.avgFirst) === null ? null : Math.round(Number(row.avgFirst)),
    avgResolutionMinutes: num(row.avgResolution) === null ? null : Math.round(Number(row.avgResolution)),
  };
}
