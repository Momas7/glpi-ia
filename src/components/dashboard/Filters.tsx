import { Button } from "@/components/ui/button";
import { PERIODS, PERIOD_LABEL, type Period } from "@/modules/dashboard/period";

const selectClass = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

/** Formulário GET: a página inteira é renderizada no servidor a cada aplicação do filtro. */
export function DashboardFilters({
  teams,
  selectedTeamId,
  period,
}: {
  teams: { id: string; name: string }[];
  selectedTeamId?: string;
  period: Period;
}) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
      {teams.length > 1 && (
        <label className="flex flex-col gap-1.5">
          Equipe
          <select name="team" defaultValue={selectedTeamId ?? ""} className={selectClass}>
            <option value="">Todas</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        Período
        <select name="period" defaultValue={period} className={selectClass}>
          {PERIODS.map((p) => (
            <option key={p} value={p}>
              {PERIOD_LABEL[p]}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary">
        Aplicar
      </Button>
    </form>
  );
}
