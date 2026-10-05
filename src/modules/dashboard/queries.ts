import { TZDate } from "@date-fns/tz";
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

// As colunas de data do Prisma são `timestamp` sem fuso, gravadas em UTC. Para as contas não dependerem do fuso do
// servidor, o PARÂMETRO é que é convertido (`::timestamptz AT TIME ZONE 'UTC'`) e a coluna fica "nua" na comparação:
// assim o Postgres consegue usar os índices em vez de varrer a tabela.
const col = (name: string): Prisma.Sql => Prisma.raw(`(t."${name}" AT TIME ZONE 'UTC')`); // para agrupar/extrair, nunca para filtrar
const at = (d: Date): Prisma.Sql => Prisma.sql`${d.toISOString()}::timestamptz`;
export const utc = (d: Date): Prisma.Sql => Prisma.sql`(${at(d)} AT TIME ZONE 'UTC')`;
const naked = (name: string): Prisma.Sql => Prisma.raw(`t."${name}"`);
export const between = (name: string, r: DateRange): Prisma.Sql => Prisma.sql`${naked(name)} >= ${utc(r.from)} AND ${naked(name)} < ${utc(r.to)}`;

/** Condição do escopo sobre "teamId" de Ticket (alias `t`). Sempre parametrizada. */
export const scopeSql = (scope: Scope): Prisma.Sql =>
  scope.teamIds === null ? Prisma.sql`TRUE` : Prisma.sql`t."teamId" = ANY(${scope.teamIds}::text[])`;
export const noTeams = (scope: Scope) => scope.teamIds !== null && scope.teamIds.length === 0;

const ACTIVE = Prisma.sql`t.status IN ('NEW', 'OPEN', 'PENDING')`;
const NOT_PAUSED = Prisma.sql`t."pausedAt" IS NULL`;
const atRiskSql = (now: Date) => Prisma.sql`${ACTIVE} AND ${NOT_PAUSED} AND t."slaWarnedAt" IS NOT NULL AND ${naked("resolutionDue")} >= ${utc(now)}`;
const breachedSql = (now: Date) => Prisma.sql`${ACTIVE} AND ${NOT_PAUSED} AND ${naked("resolutionDue")} < ${utc(now)}`;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const pct = (inTime: number, total: number): number | null => (total === 0 ? null : Math.round((inTime / total) * 100));

export async function queryKpis(scope: Scope, period: DateRange, now: Date): Promise<Kpis> {
  if (noTeams(scope)) {
    return { openNow: 0, openUnassigned: 0, atRisk: 0, breached: 0, slaPercent: null, avgFirstResponseMinutes: null, avgResolutionMinutes: null };
  }
  const resolvedWithDue = Prisma.sql`${between("resolvedAt", period)} AND t."resolutionDue" IS NOT NULL`;
  const [row] = await getDb().$queryRaw<Record<string, unknown>[]>(Prisma.sql`
    SELECT
      COUNT(*) FILTER (WHERE ${ACTIVE})::int AS "openNow",
      COUNT(*) FILTER (WHERE ${ACTIVE} AND t."assigneeId" IS NULL)::int AS "openUnassigned",
      COUNT(*) FILTER (WHERE ${atRiskSql(now)})::int AS "atRisk",
      COUNT(*) FILTER (WHERE ${breachedSql(now)})::int AS "breached",
      COUNT(*) FILTER (WHERE ${resolvedWithDue})::int AS "withDue",
      COUNT(*) FILTER (WHERE ${resolvedWithDue} AND t."resolvedAt" <= t."resolutionDue")::int AS "inTime",
      AVG(t."firstResponseBusinessMinutes") FILTER (WHERE ${between("firstRespondedAt", period)}) AS "avgFirst",
      AVG(t."resolutionBusinessMinutes") FILTER (WHERE ${between("resolvedAt", period)}) AS "avgResolution"
    FROM "Ticket" t
    WHERE ${scopeSql(scope)}`);
  return {
    openNow: Number(row.openNow),
    openUnassigned: Number(row.openUnassigned),
    atRisk: Number(row.atRisk),
    breached: Number(row.breached),
    slaPercent: pct(Number(row.inTime), Number(row.withDue)),
    avgFirstResponseMinutes: num(row.avgFirst) === null ? null : Math.round(Number(row.avgFirst)),
    avgResolutionMinutes: num(row.avgResolution) === null ? null : Math.round(Number(row.avgResolution)),
  };
}

export interface DueSoonRow {
  id: string;
  number: number;
  title: string;
  team: string | null;
  assignee: string | null;
  resolutionDue: Date;
  breached: boolean;
}

/** Chamados em risco ou vencidos (abertos, não pausados), do prazo mais próximo ao mais atrasado primeiro. */
export async function queryDueSoon(scope: Scope, now: Date, limit = 10): Promise<DueSoonRow[]> {
  if (noTeams(scope)) return [];
  const rows = await getDb().$queryRaw<(Omit<DueSoonRow, "resolutionDue"> & { resolutionDue: Date })[]>(Prisma.sql`
    SELECT t.id, t.number, t.title, tm.name AS team, u.name AS assignee,
           (t."resolutionDue" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS "resolutionDue",
           (${breachedSql(now)}) AS breached
    FROM "Ticket" t
    LEFT JOIN "Team" tm ON tm.id = t."teamId"
    LEFT JOIN "User" u ON u.id = t."assigneeId"
    WHERE ${scopeSql(scope)} AND ((${atRiskSql(now)}) OR (${breachedSql(now)}))
    ORDER BY t."resolutionDue" ASC, t.number ASC
    LIMIT ${limit}`);
  return rows.map((r) => ({ ...r, resolutionDue: new Date(r.resolutionDue), breached: Boolean(r.breached) }));
}

export interface WorkloadRow {
  assigneeId: string | null;
  name: string;
  open: number;
  atRisk: number;
  breached: number;
}

export async function queryWorkload(scope: Scope, now: Date): Promise<WorkloadRow[]> {
  if (noTeams(scope)) return [];
  const rows = await getDb().$queryRaw<WorkloadRow[]>(Prisma.sql`
    SELECT t."assigneeId" AS "assigneeId", COALESCE(u.name, 'Sem responsável') AS name,
           COUNT(*)::int AS open,
           COUNT(*) FILTER (WHERE ${atRiskSql(now)})::int AS "atRisk",
           COUNT(*) FILTER (WHERE ${breachedSql(now)})::int AS breached
    FROM "Ticket" t
    LEFT JOIN "User" u ON u.id = t."assigneeId"
    WHERE ${scopeSql(scope)} AND ${ACTIVE}
    GROUP BY t."assigneeId", u.name
    ORDER BY open DESC, name ASC`);
  return rows;
}

export interface WeeklyRow {
  weekStart: string;
  created: number;
  resolved: number;
}

/** Semanas locais (segunda a domingo) que tocam o período, com zeros nas semanas sem chamados. Uma só consulta. */
export async function queryWeekly(scope: Scope, period: DateRange, timeZone: string): Promise<WeeklyRow[]> {
  const week = (name: string) => Prisma.sql`date_trunc('week', ${col(name)} AT TIME ZONE ${timeZone})`;
  const rows = noTeams(scope)
    ? []
    : await getDb().$queryRaw<WeeklyRow[]>(Prisma.sql`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', ${at(period.from)} AT TIME ZONE ${timeZone}),
        date_trunc('week', (${at(period.to)} - interval '1 second') AT TIME ZONE ${timeZone}),
        interval '1 week') AS w
    ),
    created AS (
      SELECT ${week("createdAt")} AS w, COUNT(*)::int AS n FROM "Ticket" t
      WHERE ${scopeSql(scope)} AND ${between("createdAt", period)} GROUP BY 1
    ),
    resolved AS (
      SELECT ${week("resolvedAt")} AS w, COUNT(*)::int AS n FROM "Ticket" t
      WHERE ${scopeSql(scope)} AND ${between("resolvedAt", period)} GROUP BY 1
    )
    SELECT to_char(weeks.w, 'YYYY-MM-DD') AS "weekStart",
           COALESCE(created.n, 0)::int AS created, COALESCE(resolved.n, 0)::int AS resolved
    FROM weeks
    LEFT JOIN created ON created.w = weeks.w
    LEFT JOIN resolved ON resolved.w = weeks.w
    ORDER BY weeks.w`);
  return rows;
}

export interface CategoryRow {
  category: string;
  count: number;
}

export async function queryByCategory(scope: Scope, period: DateRange): Promise<CategoryRow[]> {
  if (noTeams(scope)) return [];
  return getDb().$queryRaw<CategoryRow[]>(Prisma.sql`
    SELECT COALESCE(c.name, 'Sem categoria') AS category, COUNT(*)::int AS count
    FROM "Ticket" t
    LEFT JOIN "Category" c ON c.id = t."categoryId"
    WHERE ${scopeSql(scope)} AND ${between("createdAt", period)}
    GROUP BY COALESCE(c.name, 'Sem categoria')
    ORDER BY count DESC, category ASC`);
}

export interface TeamSlaRow {
  team: string;
  percent: number | null;
  resolved: number;
}

/** Uma linha por equipe do escopo (mesmo sem resolvidos). */
export async function querySlaByTeam(scope: Scope, period: DateRange): Promise<TeamSlaRow[]> {
  if (noTeams(scope)) return [];
  const teamFilter = scope.teamIds === null ? Prisma.sql`TRUE` : Prisma.sql`tm.id = ANY(${scope.teamIds}::text[])`;
  const rows = await getDb().$queryRaw<{ team: string; withDue: number; inTime: number }[]>(Prisma.sql`
    SELECT tm.name AS team,
      COUNT(t.id) FILTER (WHERE ${between("resolvedAt", period)} AND t."resolutionDue" IS NOT NULL)::int AS "withDue",
      COUNT(t.id) FILTER (WHERE ${between("resolvedAt", period)} AND t."resolutionDue" IS NOT NULL
                            AND t."resolvedAt" <= t."resolutionDue")::int AS "inTime"
    FROM "Team" tm
    LEFT JOIN "Ticket" t ON t."teamId" = tm.id
    WHERE ${teamFilter}
    GROUP BY tm.id, tm.name
    ORDER BY tm.name ASC`);
  return rows.map((r) => ({ team: r.team, percent: pct(r.inTime, r.withDue), resolved: r.withDue }));
}

export interface TrendRow {
  month: string;
  created: number;
  slaPercent: number | null;
}

/** `months`: inícios dos meses locais, do mais antigo ao atual (ver `monthStarts`). Duas consultas agrupadas por mês. */
export async function queryTrend(scope: Scope, months: Date[], timeZone: string): Promise<TrendRow[]> {
  const nextMonth = (d: Date) => {
    const z = new TZDate(d.getTime(), timeZone);
    return new Date(new TZDate(z.getFullYear(), z.getMonth() + 1, 1, 0, 0, 0, 0, timeZone).getTime());
  };
  const label = (d: Date) => {
    const z = new TZDate(d.getTime(), timeZone);
    return `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, "0")}`;
  };
  if (months.length === 0) return [];
  if (noTeams(scope)) return months.map((m) => ({ month: label(m), created: 0, slaPercent: null }));

  const range = { from: months[0], to: nextMonth(months[months.length - 1]) };
  const month = (name: string) => Prisma.sql`to_char(date_trunc('month', ${col(name)} AT TIME ZONE ${timeZone}), 'YYYY-MM')`;
  const [created, sla] = await Promise.all([
    getDb().$queryRaw<{ month: string; n: number }[]>(Prisma.sql`
      SELECT ${month("createdAt")} AS month, COUNT(*)::int AS n FROM "Ticket" t
      WHERE ${scopeSql(scope)} AND ${between("createdAt", range)} GROUP BY 1`),
    getDb().$queryRaw<{ month: string; withDue: number; inTime: number }[]>(Prisma.sql`
      SELECT ${month("resolvedAt")} AS month,
             COUNT(*) FILTER (WHERE t."resolutionDue" IS NOT NULL)::int AS "withDue",
             COUNT(*) FILTER (WHERE t."resolutionDue" IS NOT NULL AND t."resolvedAt" <= t."resolutionDue")::int AS "inTime"
      FROM "Ticket" t
      WHERE ${scopeSql(scope)} AND ${between("resolvedAt", range)} GROUP BY 1`),
  ]);
  const createdBy = new Map(created.map((r) => [r.month, Number(r.n)]));
  const slaBy = new Map(sla.map((r) => [r.month, pct(Number(r.inTime), Number(r.withDue))]));
  return months.map((m) => ({ month: label(m), created: createdBy.get(label(m)) ?? 0, slaPercent: slaBy.get(label(m)) ?? null }));
}
