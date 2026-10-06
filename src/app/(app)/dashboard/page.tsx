import { z } from "zod";
import { DashboardFilters } from "@/components/dashboard/Filters";
import { CategoryChart, TeamSlaChart, TrendChart, WeeklyChart } from "@/components/dashboard/Charts";
import { AiAssistSection } from "@/components/dashboard/AiAssistSection";
import { AiUsageSection } from "@/components/dashboard/AiUsageSection";
import { CsatSection } from "@/components/dashboard/CsatSection";
import { DashboardNotes } from "@/components/dashboard/DashboardNotes";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { DueSoonTable, WorkloadTable } from "@/components/dashboard/Tables";
import { getDb } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertDashboardPage } from "@/lib/dashboard-guard";
import { requireUser } from "@/lib/server-session";
import { getDashboard, PERIODS } from "@/modules/dashboard";

export const metadata = { title: "Dashboard · Sentinela" };

const querySchema = z.object({
  team: z.string().min(1).optional().catch(undefined),
  period: z.enum(PERIODS as [string, ...string[]]).default("this_month").catch("this_month"),
});

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short", timeZone: process.env.APP_TIMEZONE || "America/Sao_Paulo" });

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  assertDashboardPage(user);
  const raw = await searchParams;
  const { team, period } = querySchema.parse({ team: first(raw.team) || undefined, period: first(raw.period) });

  const teams = await getDb().team.findMany({
    where: user.role === "ADMIN" ? {} : { id: { in: user.teamIds } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  let data;
  try {
    data = await getDashboard(user, { teamId: team, period: period as never });
  } catch (err) {
    if (err instanceof AppError && (err.status === 403 || err.status === 400)) {
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p role="alert" className="text-sm text-red-400">
            {err.status === 403 ? "Você não tem acesso aos dados dessa equipe." : "Equipe inválida."}
          </p>
          <DashboardFilters teams={teams} period={period as never} />
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {data.scopeLabel} · atualizado às {timeFmt.format(data.generatedAt)}
          </p>
        </div>
        <DashboardFilters teams={teams} selectedTeamId={team} period={data.period} />
      </div>
      <KpiCards kpis={data.kpis} />
      <div className="grid gap-4 xl:grid-cols-2">
        <DueSoonTable rows={data.dueSoon} />
        <WorkloadTable rows={data.workload} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <WeeklyChart data={data.weekly} />
        <CategoryChart data={data.byCategory} />
        <TeamSlaChart data={data.slaByTeam} />
        <TrendChart data={data.trend} />
      </div>
      <CsatSection csat={data.csat} />
      <AiAssistSection data={data.aiAssist} />
      {data.aiUsage && <AiUsageSection usage={data.aiUsage} />}
      <DashboardNotes hasDemoData={data.hasDemoData} />
    </div>
  );
}
