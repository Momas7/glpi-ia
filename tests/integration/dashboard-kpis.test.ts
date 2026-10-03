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

  it("chamado reaberto e resolvido de novo conta uma vez (um só resolvedAt final)", async () => {
    const before = await q.queryKpis({ teamIds: [ids.t1] }, OCTOBER, NOW);
    await db.ticketEvent.create({
      data: { ticketId: (await db.ticket.findFirstOrThrow({ where: { status: "RESOLVED", teamId: ids.t1 } })).id, actorId: ids.admin.id, type: "REOPENED", data: {} },
    });
    const after = await q.queryKpis({ teamIds: [ids.t1] }, OCTOBER, NOW);
    expect(after.slaPercent).toBe(before.slaPercent);
  });
});
