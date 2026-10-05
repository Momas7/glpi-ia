import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";
import { NOW, SP, seedDashboardFixture, sp } from "./helpers/dashboard-data";

let testDb: TestDb;
let db: Db;
let q: typeof import("@/modules/dashboard/queries");
let period: typeof import("@/modules/dashboard/period");
let ids: Awaited<ReturnType<typeof seedDashboardFixture>>;
const OCTOBER = { from: sp(2026, 10, 1), to: sp(2026, 11, 1) };

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  q = await import("@/modules/dashboard/queries");
  period = await import("@/modules/dashboard/period");
  ids = await seedDashboardFixture(db);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

describe("vence primeiro", () => {
  it("só abertos não pausados em risco ou vencidos, por prazo; pausado e em dia ficam de fora", async () => {
    const rows = await q.queryDueSoon({ teamIds: [ids.t1] }, NOW);
    expect(rows.map((r) => [r.title, r.breached, r.assignee, r.team])).toEqual([
      ["Chamado 3", true, null, "Infraestrutura"],
      ["Chamado 2", false, "Ana", "Infraestrutura"],
    ]);
  });

  it("respeita o limite", async () => {
    expect(await q.queryDueSoon({ teamIds: null }, NOW, 1)).toHaveLength(1);
  });
});

describe("carga por técnico", () => {
  it("abertos, em risco e vencidos por responsável, com 'Sem responsável' e mais carga primeiro", async () => {
    const rows = await q.queryWorkload({ teamIds: [ids.t1] }, NOW);
    expect(rows.map((r) => [r.name, r.open, r.atRisk, r.breached])).toEqual([
      ["Ana", 3, 1, 0],
      ["Sem responsável", 2, 0, 1],
    ]);
  });
});

describe("criados × resolvidos por semana", () => {
  it("semanas locais (segunda a domingo), incluindo semanas sem chamados com zeros", async () => {
    const rows = await q.queryWeekly({ teamIds: [ids.t1] }, OCTOBER, SP);
    expect(rows).toEqual([
      { weekStart: "2026-09-28", created: 12, resolved: 0 },
      { weekStart: "2026-10-05", created: 0, resolved: 5 },
      { weekStart: "2026-10-12", created: 0, resolved: 0 },
      { weekStart: "2026-10-19", created: 0, resolved: 0 },
      { weekStart: "2026-10-26", created: 0, resolved: 1 }, // o resolvido às 23h30 de 31/10 (SP)
    ]);
  });

  it("período sem chamados: todas as semanas com zeros", async () => {
    const rows = await q.queryWeekly({ teamIds: [ids.t1] }, { from: sp(2025, 1, 1), to: sp(2025, 1, 29) }, SP);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.created === 0 && r.resolved === 0)).toBe(true);
  });
});

describe("por categoria", () => {
  it("chamados criados no período; sem categoria vira 'Sem categoria'; mais volume primeiro", async () => {
    expect(await q.queryByCategory({ teamIds: null }, OCTOBER)).toEqual([
      { category: "Rede", count: 12 },
      { category: "Sem categoria", count: 2 },
    ]);
    expect(await q.queryByCategory({ teamIds: [ids.t1] }, OCTOBER)).toEqual([{ category: "Rede", count: 12 }]);
  });
});

describe("% no SLA por equipe", () => {
  it("por equipe do escopo, com resolvidos com prazo; equipe sem resolvidos tem null", async () => {
    expect(await q.querySlaByTeam({ teamIds: null }, OCTOBER)).toEqual([
      { team: "Infraestrutura", percent: 80, resolved: 5 },
      { team: "Sistemas", percent: 100, resolved: 1 },
    ]);
    const nov = await q.querySlaByTeam({ teamIds: [ids.t2] }, { from: sp(2026, 11, 1), to: sp(2026, 12, 1) });
    expect(nov).toEqual([{ team: "Sistemas", percent: null, resolved: 0 }]);
  });
});

describe("tendência de 6 meses", () => {
  it("volume e % no SLA por mês; meses sem chamados em zero e null", async () => {
    const months = period.monthStarts(NOW, SP, 6);
    expect(await q.queryTrend({ teamIds: [ids.t1] }, months, SP)).toEqual([
      { month: "2026-05", created: 0, slaPercent: null },
      { month: "2026-06", created: 0, slaPercent: null },
      { month: "2026-07", created: 0, slaPercent: null },
      { month: "2026-08", created: 0, slaPercent: null },
      { month: "2026-09", created: 1, slaPercent: 100 },
      { month: "2026-10", created: 12, slaPercent: 80 },
    ]);
  });
});
