export interface TriageBasis {
  categoryId: string | null;
  priority: string;
  teamId: string | null;
}

/** A sugestão vale para o chamado como ele estava: se mudou ou foi encerrado, ela não se aplica mais. */
export function isSuggestionStale(
  ticket: { status: string; categoryId: string | null; priority: string; teamId: string | null },
  basis: TriageBasis,
): boolean {
  return (
    ticket.status === "RESOLVED" ||
    ticket.status === "CLOSED" ||
    ticket.categoryId !== basis.categoryId ||
    ticket.priority !== basis.priority ||
    ticket.teamId !== basis.teamId
  );
}
