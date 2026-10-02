import { BusinessHoursForm, HolidayForm, PoliciesForm, RemoveHolidayButton } from "@/components/admin/SlaForms";
import { requireUser } from "@/lib/server-session";
import { getSlaSettings } from "@/modules/sla";

export const metadata = { title: "SLA · Administração" };

const dateFmt = new Intl.DateTimeFormat("pt-BR", { dateStyle: "full", timeZone: "UTC" });

export default async function SlaPage() {
  const user = await requireUser();
  const { policies, hours, holidays } = await getSlaSettings(user);
  const thisYear = new Date().getFullYear();
  const upcoming = holidays.filter((h) => h.date.getUTCFullYear() >= thisYear);

  return (
    <div className="flex flex-col gap-8">
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
