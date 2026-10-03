import type { Priority } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { can, type SessionUser } from "@/modules/auth";
import type { TicketWithRefs } from "@/modules/tickets";

export interface PendingTriage {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  priority: Priority;
  teamId: string | null;
  teamName: string | null;
  confidence: number;
  options: { categories: { id: string; name: string }[]; teams: { id: string; name: string }[] };
}

interface TriagePayload {
  categoryId: string | null;
  priority: Priority;
  teamId: string | null;
}

/** A sugestão pendente do chamado, só para quem pode decidi-la (nunca o solicitante). */
export async function getPendingTriage(actor: SessionUser, ticket: TicketWithRefs): Promise<PendingTriage | null> {
  if (!can(actor, "ai:decide", ticket)) return null;
  const db = getDb();
  const s = await db.aiSuggestion.findFirst({ where: { ticketId: ticket.id, kind: "TRIAGE", status: "PENDING" } });
  if (!s) return null;
  const payload = s.payload as unknown as TriagePayload;
  const [categories, teams] = await Promise.all([
    db.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    id: s.id,
    categoryId: payload.categoryId,
    categoryName: categories.find((c) => c.id === payload.categoryId)?.name ?? null,
    priority: payload.priority,
    teamId: payload.teamId,
    teamName: teams.find((t) => t.id === payload.teamId)?.name ?? null,
    confidence: s.confidence,
    options: { categories, teams },
  };
}

/** Ids dos chamados da lista com sugestão pendente que o usuário pode decidir (uma consulta só). */
export async function pendingTriageTicketIds(actor: SessionUser, tickets: TicketWithRefs[]): Promise<Set<string>> {
  const decidable = tickets.filter((t) => can(actor, "ai:decide", t));
  if (decidable.length === 0) return new Set();
  const rows = await getDb().aiSuggestion.findMany({
    where: { ticketId: { in: decidable.map((t) => t.id) }, kind: "TRIAGE", status: "PENDING" },
    select: { ticketId: true },
  });
  return new Set(rows.map((r) => r.ticketId));
}
