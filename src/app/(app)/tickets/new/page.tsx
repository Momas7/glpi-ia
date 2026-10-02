import { JsonForm } from "@/components/forms/JsonForm";
import { PRIORITY_LABEL, TYPE_LABEL } from "@/lib/labels";
import { requireUser } from "@/lib/server-session";

export const metadata = { title: "Novo chamado · Chamados IA" };

const toOptions = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export default async function NewTicketPage() {
  await requireUser();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <h1 className="text-xl font-semibold">Novo chamado</h1>
      <JsonForm
        endpoint="/api/tickets"
        submitLabel="Abrir chamado"
        redirectTo="/tickets/{ticket.id}"
        fields={[
          { name: "title", label: "Título" },
          { name: "description", label: "Descrição", type: "textarea", hint: "Aceita **negrito**, *itálico*, `código` e listas." },
          { name: "type", label: "Tipo", type: "select", options: toOptions(TYPE_LABEL), required: false },
          { name: "priority", label: "Prioridade", type: "select", options: toOptions(PRIORITY_LABEL), required: false },
        ]}
      />
    </div>
  );
}
