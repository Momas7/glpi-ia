import { TZDate } from "@date-fns/tz";
import type { Db } from "@/lib/db";

export const SP = "America/Sao_Paulo";
export const sp = (y: number, m: number, d: number, h = 0, min = 0) => new Date(new TZDate(y, m - 1, d, h, min, SP).getTime());
export const NOW = sp(2026, 10, 15, 12); // quinta-feira, 15/10/2026 12h (São Paulo)
export const MINUTE = 60_000;

/** Semeia equipes, usuários e um conjunto fixo de chamados para as consultas do dashboard. */
export async function seedDashboardFixture(db: Db) {
  await db.ticketEvent.deleteMany();
  await db.comment.deleteMany();
  await db.ticket.deleteMany();
  await db.category.deleteMany();
  await db.teamMember.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  const t1 = await db.team.create({ data: { name: "Infraestrutura" } });
  const t2 = await db.team.create({ data: { name: "Sistemas" } });
  const cat = await db.category.create({ data: { name: "Rede", defaultTeamId: t1.id } });
  const mkUser = (name: string, role: "REQUESTER" | "AGENT" | "TEAM_LEAD" | "ADMIN", teamId?: string) =>
    db.user.create({
      data: { name, email: `${name.toLowerCase()}@x.com`, role, teams: teamId ? { create: [{ teamId }] } : undefined },
    });
  const requester = await mkUser("Req", "REQUESTER");
  const ana = await mkUser("Ana", "AGENT", t1.id);
  const bia = await mkUser("Bia", "AGENT", t2.id);
  const lead1 = await mkUser("Lider1", "TEAM_LEAD", t1.id);
  const lead2 = await mkUser("Lider2", "TEAM_LEAD", t2.id);
  const admin = await mkUser("Admin", "ADMIN");

  let n = 0;
  const ticket = (data: Record<string, unknown>) =>
    db.ticket.create({
      data: { title: `Chamado ${++n}`, description: "d", requesterId: requester.id, teamId: t1.id, categoryId: cat.id, createdAt: sp(2026, 10, 1, 9), ...data } as never,
    });

  // --- abertos agora (equipe 1) ---
  await ticket({ status: "OPEN", assigneeId: ana.id, slaResolutionMinutes: 240, resolutionDue: new Date(NOW.getTime() + 600 * MINUTE) }); // em dia
  await ticket({ status: "OPEN", assigneeId: ana.id, slaResolutionMinutes: 240, resolutionDue: new Date(NOW.getTime() + 60 * MINUTE), slaWarnedAt: sp(2026, 10, 15, 11) }); // em risco
  await ticket({ status: "OPEN", assigneeId: null, slaResolutionMinutes: 240, resolutionDue: new Date(NOW.getTime() - 120 * MINUTE) }); // vencido, sem responsável
  await ticket({ status: "NEW", assigneeId: null }); // sem prazo, sem responsável
  await ticket({ status: "PENDING", assigneeId: ana.id, slaResolutionMinutes: 240, resolutionDue: new Date(NOW.getTime() - 300 * MINUTE), pausedAt: sp(2026, 10, 14, 10) }); // pausado vencido
  // --- encerrados (não contam como abertos nem vencidos) ---
  await ticket({ status: "CLOSED", assigneeId: ana.id, slaResolutionMinutes: 240, resolutionDue: new Date(NOW.getTime() - 900 * MINUTE), resolvedAt: sp(2026, 9, 28, 10) });

  // --- resolvidos em outubro/2026 (equipe 1): 3 no prazo, 1 fora, 1 sem prazo ---
  const due = (d: number, h: number) => sp(2026, 10, d, h);
  const resolved = (extra: Record<string, unknown>) => ticket({ status: "RESOLVED", assigneeId: ana.id, ...extra });
  await resolved({ resolvedAt: due(5, 10), resolutionDue: due(5, 12), slaResolutionMinutes: 240, resolutionBusinessMinutes: 60, firstResponseBusinessMinutes: 10, firstRespondedAt: sp(2026, 10, 2, 9) });
  await resolved({ resolvedAt: due(6, 10), resolutionDue: due(6, 12), slaResolutionMinutes: 240, resolutionBusinessMinutes: 120, firstResponseBusinessMinutes: 20, firstRespondedAt: sp(2026, 10, 2, 9) });
  await resolved({ resolvedAt: due(7, 10), resolutionDue: due(7, 10), slaResolutionMinutes: 240, resolutionBusinessMinutes: 180, firstResponseBusinessMinutes: 30, firstRespondedAt: sp(2026, 10, 2, 9) }); // exatamente no prazo
  await resolved({ resolvedAt: due(8, 14), resolutionDue: due(8, 12), slaResolutionMinutes: 240, resolutionBusinessMinutes: 240 }); // fora do prazo
  await resolved({ resolvedAt: due(9, 10), resolutionBusinessMinutes: null }); // sem prazo (anterior ao SLA)
  // resolvido às 23h30 de 31/10 (horário de SP) fica em OUTUBRO, mesmo sendo novembro em UTC
  await resolved({ resolvedAt: sp(2026, 10, 31, 23, 30), resolutionDue: sp(2026, 11, 2, 12), slaResolutionMinutes: 240, resolutionBusinessMinutes: 100 });
  // resolvido em setembro (fora do período "este mês")
  await resolved({ createdAt: sp(2026, 9, 3, 9), resolvedAt: sp(2026, 9, 10, 10), resolutionDue: sp(2026, 9, 10, 12), slaResolutionMinutes: 240, resolutionBusinessMinutes: 90 });

  // --- equipe 2 ---
  await ticket({ teamId: t2.id, categoryId: null, status: "OPEN", assigneeId: bia.id, slaResolutionMinutes: 240, resolutionDue: new Date(NOW.getTime() - 60 * MINUTE) }); // vencido
  await ticket({ teamId: t2.id, categoryId: null, status: "RESOLVED", assigneeId: bia.id, resolvedAt: due(10, 10), resolutionDue: due(10, 12), slaResolutionMinutes: 240, resolutionBusinessMinutes: 50, firstResponseBusinessMinutes: 40, firstRespondedAt: sp(2026, 10, 2, 9) });

  return { t1: t1.id, t2: t2.id, requester, ana, bia, lead1, lead2, admin };
}
