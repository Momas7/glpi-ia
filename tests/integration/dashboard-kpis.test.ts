import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";
import { NOW, seedDashboardFixture, sp } from "./helpers/dashboard-data";

let testDb: TestDb;
let db: Db;
let q: typeof import("@/modules/dashboard/queries");
let ids: Awaited<ReturnType<typeof seedDashboardFixture>>;
const OCTOBER = { from: sp(2026, 10, 1), to: sp(2026, 11, 1) };

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  q = await import("@/modules/dashboard/queries");
  ids = await seedDashboardFixture(db);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

describe("queryKpis", () => {
  it("abertos, sem responsável, em risco e vencidos (pausados e encerrados ficam de fora)", async () => {
    const k = await q.queryKpis({ teamIds: [ids.t1] }, OCTOBER, NOW);
    expect(k.openNow).toBe(5); // 4 ativos + 1 pausado; o fechado não conta
    expect(k.openUnassigned).toBe(2);
    expect(k.atRisk).toBe(1);
    expect(k.breached).toBe(1); // o pausado vencido NÃO conta
  });

  it("% no SLA do período: só resolvidos no período com prazo; exatamente no prazo conta como dentro", async () => {
    const k = await q.queryKpis({ teamIds: [ids.t1] }, OCTOBER, NOW);
    // com prazo, resolvidos em outubro: 3 dentro (inclui 'no prazo exato' e o de 23h30 de 31/10), 1 fora → 3/5? veja abaixo
    // resolvidos com prazo em outubro: 05, 06, 07 (dentro), 08 (fora), 31/10 23h30 (dentro) = 5 → 4 dentro
    expect(k.slaPercent).toBe(80);
  });

  it("médias de tempo só dos chamados que têm os minutos gravados", async () => {
    const k = await q.queryKpis({ teamIds: [ids.t1] }, OCTOBER, NOW);
    expect(k.avgFirstResponseMinutes).toBe(20); // (10+20+30)/3
    expect(k.avgResolutionMinutes).toBe(140); // (60+120+180+240+100)/5
  });

  it("sem resolvidos no período: null (nunca NaN)", async () => {
    const empty = { from: sp(2025, 1, 1), to: sp(2025, 2, 1) };
    const k = await q.queryKpis({ teamIds: [ids.t1] }, empty, NOW);
    expect([k.slaPercent, k.avgFirstResponseMinutes, k.avgResolutionMinutes]).toEqual([null, null, null]);
  });

  it("o resolvido às 23h30 de 31/10 (São Paulo) não aparece em novembro", async () => {
    const november = { from: sp(2026, 11, 1), to: sp(2026, 12, 1) };
    const k = await q.queryKpis({ teamIds: [ids.t1] }, november, NOW);
    expect(k.slaPercent).toBeNull();
  });

  it("filtro por equipes: outra equipe não vaza; lista vazia devolve zeros; null = todas", async () => {
    const t2 = await q.queryKpis({ teamIds: [ids.t2] }, OCTOBER, NOW);
    expect([t2.openNow, t2.breached, t2.slaPercent]).toEqual([1, 1, 100]);
    const none = await q.queryKpis({ teamIds: [] }, OCTOBER, NOW);
    expect([none.openNow, none.atRisk, none.breached, none.slaPercent]).toEqual([0, 0, 0, null]);
    const all = await q.queryKpis({ teamIds: null }, OCTOBER, NOW);
    expect(all.openNow).toBe(6);
  });

  it("chamado reaberto sai das métricas de resolvidos e, resolvido de novo, volta uma vez só (pelas operações reais)", async () => {
    const svc = await import("@/modules/tickets");
    const sla = await import("@/modules/sla");
    // calendário aberto 24 h × 7 dias e política MEDIUM: o prazo existe e cabe dentro do teste
    await db.businessHours.deleteMany();
    await db.businessHours.createMany({ data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 0, endMinute: 1440 })) });
    await db.slaPolicy.deleteMany();
    await db.slaPolicy.create({ data: { priority: "MEDIUM", firstResponseMinutes: 600, resolutionMinutes: 6000 } });
    sla.invalidateCalendarCache();

    const asSession = (u: { id: string; name: string; email: string; role: string }, teamIds: string[]) => ({
      id: u.id, name: u.name, email: u.email, role: u.role as "REQUESTER" | "AGENT", teamIds,
    });
    // Equipe própria: o fixture tem chamados resolvidos em datas fixas (5 a 9/10/2026) que cairiam na janela "hoje".
    const team = await db.team.create({ data: { name: "Equipe da reabertura" } });
    await db.teamMember.create({ data: { teamId: team.id, userId: ids.ana.id } });
    const requester = asSession(ids.requester, []);
    const agent = asSession(ids.ana, [team.id]);
    const created = await svc.createTicket(requester, { title: "Reabertura real", description: "d" });
    await db.ticket.update({ where: { id: created.id }, data: { teamId: team.id } });

    const today = { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000) };
    const now = new Date();
    const kpis = () => q.queryKpis({ teamIds: [team.id] }, today, now);
    const base = await kpis(); // chamados do fixture + este (aberto)

    await svc.changeStatus(agent, created.id, "OPEN");
    await svc.changeStatus(agent, created.id, "RESOLVED", "Solução de teste do chamado.");
    const resolved = await kpis();
    expect(resolved.slaPercent).toBe(100);
    expect(resolved.openNow).toBe(base.openNow - 1);

    await svc.reopenTicket(requester, created.id, "Voltou a falhar de novo");
    const reopened = await kpis();
    expect(reopened.slaPercent).toBeNull(); // reaberto não conta como resolvido
    expect(reopened.openNow).toBe(base.openNow);

    await svc.changeStatus(agent, created.id, "RESOLVED", "Solução de teste do chamado.");
    const again = await kpis();
    expect(again.slaPercent).toBe(100);
    expect(again.openNow).toBe(base.openNow - 1);
    const row = await db.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(again.avgResolutionMinutes).toBe(row.resolutionBusinessMinutes);
    expect(await db.ticket.count({ where: { id: created.id, resolvedAt: { not: null } } })).toBe(1);
  });
});
