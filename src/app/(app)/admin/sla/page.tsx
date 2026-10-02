import { BusinessHoursForm, HolidayForm, PoliciesForm, RemoveHolidayButton } from "@/components/admin/SlaForms";
import { requireUser } from "@/lib/server-session";
import { getSlaSettings } from "@/modules/sla";

export const metadata = { title: "SLA · Administração" };

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "UTC" });

export default async function SlaPage() {
  const user = await requireUser();
  const { policies, hours, holidays, configured } = await getSlaSettings(user);
  const thisYear = new Date().getFullYear();
  const upcoming = holidays.filter((h) => h.date.getUTCFullYear() >= thisYear);

  return (
    <div className="flex flex-col gap-8">
      {!configured && (
        <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <strong>SLA não configurado:</strong> faltam políticas de prazo ou dias de expediente, e os chamados estão
          ficando sem prazo. Salve as tabelas abaixo (os valores exibidos são sugestões) ou rode <code>npm run db:seed</code>.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        Prazos contam só em horário comercial e param quando o chamado está Pendente. Mudanças valem para chamados abertos a
        partir de agora.
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Prazos por prioridade</h2>
        <PoliciesForm policies={policies} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Expediente</h2>
        <BusinessHoursForm hours={hours} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Feriados</h2>
        <HolidayForm />
        <ul className="flex flex-col gap-1 text-sm">
          {upcoming.map((h) => {
            const label = `${dateFmt.format(h.date)} — ${h.name}`;
            return (
              <li key={h.id} className="flex items-center gap-2">
                <span>{label}</span>
                <RemoveHolidayButton id={h.id} label={label} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
