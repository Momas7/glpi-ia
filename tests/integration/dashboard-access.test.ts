import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";
import { NOW, seedDashboardFixture } from "./helpers/dashboard-data";

let testDb: TestDb;
let db: Db;
let dash: typeof import("@/modules/dashboard");
let ids: Awaited<ReturnType<typeof seedDashboardFixture>>;
let admin: SessionUser, lead1: SessionUser, lead2: SessionUser, agent: SessionUser, requester: SessionUser;

const session = (u: { id: string; name: string; email: string; role: SessionUser["role"] }, teamIds: string[]): SessionUser => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  dash = await import("@/modules/dashboard");
  ids = await seedDashboardFixture(db);
  admin = session(ids.admin, []);
  lead1 = session(ids.lead1, [ids.t1]);
  lead2 = session(ids.lead2, [ids.t2]);
  agent = session(ids.ana, [ids.t1]);
  requester = session(ids.requester, []);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

describe("getDashboard: acesso e escopo", () => {
  it("técnico e solicitante → 403", async () => {
    await expect(dash.getDashboard(agent, {}, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(dash.getDashboard(requester, {}, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it("líder sem filtro vê só as próprias equipes", async () => {
    expect((await dash.getDashboard(lead1, {}, NOW)).kpis.openNow).toBe(5);
    expect((await dash.getDashboard(lead2, {}, NOW)).kpis.openNow).toBe(1);
  });

  it("líder pedindo a equipe de outro líder → 403, sem dados", async () => {
    await expect(dash.getDashboard(lead1, { teamId: ids.t2 }, NOW)).rejects.toMatchObject({ status: 403 });
    expect((await dash.getDashboard(lead1, { teamId: ids.t1 }, NOW)).kpis.openNow).toBe(5);
  });

  it("admin vê tudo e filtra por equipe; equipe inexistente → 400", async () => {
    expect((await dash.getDashboard(admin, {}, NOW)).kpis.openNow).toBe(6);
    expect((await dash.getDashboard(admin, { teamId: ids.t2 }, NOW)).kpis.openNow).toBe(1);
    await expect(dash.getDashboard(admin, { teamId: "nao-existe" }, NOW)).rejects.toMatchObject({ status: 400 });
  });

  it("devolve rótulo do escopo, período e todas as seções", async () => {
    const d = await dash.getDashboard(admin, { period: "last_month" }, NOW);
    expect(d.scopeLabel).toBe("Todas as equipes");
    expect(d.period).toBe("last_month");
    for (const k of ["kpis", "dueSoon", "workload", "weekly", "byCategory", "slaByTeam", "trend"] as const) expect(d[k]).toBeDefined();
    expect((await dash.getDashboard(lead1, { teamId: ids.t1 }, NOW)).scopeLabel).toBe("Infraestrutura");
  });
});

describe("getDashboard: cache de 60 s", () => {
  it("a segunda chamada reaproveita o resultado até limpar o cache", async () => {
    dash.clearDashboardCache();
    const before = (await dash.getDashboard(admin, { period: "last_90_days" })).kpis.openNow;
    await db.ticket.create({ data: { title: "Novo aberto", description: "d", requesterId: ids.requester.id, teamId: ids.t1, status: "OPEN" } });
    expect((await dash.getDashboard(admin, { period: "last_90_days" })).kpis.openNow).toBe(before);
    dash.clearDashboardCache();
    expect((await dash.getDashboard(admin, { period: "last_90_days" })).kpis.openNow).toBe(before + 1);
  });
});
