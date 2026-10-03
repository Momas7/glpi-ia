/** Aviso à equipe no chamado que faz parte de um incidente em andamento. */
export function IncidentNotice({ notice }: { notice: { id: string; title: string; ticketCount: number } }) {
  return (
    <p role="status" className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-sm">
      Parte do incidente <strong>{notice.title}</strong> ({notice.ticketCount} chamados).
    </p>
  );
}
