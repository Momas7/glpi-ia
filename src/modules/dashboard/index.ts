import { getDb } from "@/lib/db";
import { AppError, ForbiddenError } from "@/lib/errors";
import { can } from "@/modules/auth/can";
import type { SessionUser } from "@/modules/auth/session";
import { monthStarts, periodRange, type Period } from "./period";
import {
  queryByCategory,
  queryDueSoon,
  queryKpis,
  querySlaByTeam,
  queryTrend,
  queryWeekly,
  queryWorkload,
  type Scope,
} from "./queries";

export { PERIODS, PERIOD_LABEL, type Period } from "./period";

export interface DashboardData {
  period: Period;
  scopeLabel: string;
  kpis: Awaited<ReturnType<typeof queryKpis>>;
  dueSoon: Awaited<ReturnType<typeof queryDueSoon>>;
  workload: Awaited<ReturnType<typeof queryWorkload>>;
  weekly: Awaited<ReturnType<typeof queryWeekly>>;
  byCategory: Awaited<ReturnType<typeof queryByCategory>>;
  slaByTeam: Awaited<ReturnType<typeof querySlaByTeam>>;
  trend: Awaited<ReturnType<typeof queryTrend>>;
  generatedAt: Date;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; data: DashboardData }>();

export function clearDashboardCache(): void {
  cache.clear();
}

async function resolveScope(actor: SessionUser, teamId?: string): Promise<{ scope: Scope; label: string }> {
  if (teamId) {
    const team = await getDb().team.findUnique({ where: { id: teamId } });
    if (!team) throw new AppError(400, "Equipe não encontrada.");
    if (actor.role !== "ADMIN" && !actor.teamIds.includes(teamId)) throw new ForbiddenError();
    return { scope: { teamIds: [teamId] }, label: team.name };
  }
  if (actor.role === "ADMIN") return { scope: { teamIds: null }, label: "Todas as equipes" };
  return { scope: { teamIds: actor.teamIds }, label: actor.teamIds.length === 1 ? "Minha equipe" : "Minhas equipes" };
}

/**
 * Dados do dashboard. O líder só enxerga as próprias equipes; o admin, todas (com filtro opcional).
 * Resultado em cache por 60 s por (equipes, período); com `now` explícito (testes) o cache é ignorado.
 */
export async function getDashboard(
  actor: SessionUser,
  filter: { teamId?: string; period?: Period },
  now?: Date,
): Promise<DashboardData> {
  if (!can(actor, "dashboard:view")) throw new ForbiddenError();
  const period = filter.period ?? "this_month";
  const { scope, label } = await resolveScope(actor, filter.teamId);

  const key = `${scope.teamIds === null ? "*" : [...scope.teamIds].sort().join(",")}|${period}|${label}`;
  const hit = !now ? cache.get(key) : undefined;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

  const at = now ?? new Date();
  const tz = process.env.APP_TIMEZONE || "America/Sao_Paulo";
  const range = periodRange(period, at, tz);
  const [kpis, dueSoon, workload, weekly, byCategory, slaByTeam, trend] = await Promise.all([
    queryKpis(scope, range, at),
    queryDueSoon(scope, at),
    queryWorkload(scope, at),
    queryWeekly(scope, range, tz),
    queryByCategory(scope, range),
    querySlaByTeam(scope, range),
    queryTrend(scope, monthStarts(at, tz, 6), tz),
  ]);
  const data: DashboardData = { period, scopeLabel: label, kpis, dueSoon, workload, weekly, byCategory, slaByTeam, trend, generatedAt: at };
  if (!now) cache.set(key, { at: Date.now(), data });
  return data;
}
