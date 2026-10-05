import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";
import type { EmbedDeps } from "@/modules/ai/embedding/run";
import type { SessionUser } from "@/modules/auth";
import { queuedEvents } from "./helpers/queued-events";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let ai: typeof import("@/modules/ai");
let t1: string, t2: string, t3: string;
let requesterRow: { id: string };
let lead1: SessionUser, lead3: SessionUser, agent: SessionUser, admin: SessionUser, requester: SessionUser;

const config = { duplicateMinSimilarity: 0.5, duplicateWindowHours: 72, incidentMinSimilarity: 0.5, incidentWindowMinutes: 30, incidentMinTickets: 5 };

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"], teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, {
    DATABASE_URL: testDb.url,
    AI_ENABLED: "true",
    APP_URL: "http://app.test",
    N8N_WEBHOOK_URL: "http://n8n.local/webhook/x",
    N8N_WEBHOOK_SECRET: "s".repeat(40),
  });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  ai = await import("@/modules/ai");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job WHERE name = 'webhook.deliver'; END IF; END $$`);
  await db.webhookDelivery.deleteMany();
  await db.$executeRawUnsafe(`DELETE FROM "OpenTicketVector"`);
  await db.auditLog.deleteMany();
  await db.aiSuggestion.deleteMany();
  await db.ticket.deleteMany();
  await db.incidentGroup.deleteMany();
  await db.aiAuditLog.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  t2 = (await db.team.create({ data: { name: "T2" } })).id;
  t3 = (await db.team.create({ data: { name: "T3" } })).id;
  const mk = (name: string, role: SessionUser["role"], teams: string[] = []) =>
    db.user.create({ data: { name, email: `${name}@x.com`, role, teams: { create: teams.map((teamId) => ({ teamId })) } } });
  requesterRow = await mk("requester", "REQUESTER");
  requester = session(requesterRow as never, "REQUESTER");
  lead1 = session(await mk("lead1", "TEAM_LEAD", [t1]), "TEAM_LEAD", [t1]);
  lead3 = session(await mk("lead3", "TEAM_LEAD", [t3]), "TEAM_LEAD", [t3]);
  agent = session(await mk("agent", "AGENT", [t1]), "AGENT", [t1]);
  admin = session(await mk("admin", "ADMIN"), "ADMIN");
});

const deps = (over: Record<string, unknown> = {}) =>
  ({
    db, provider: new FakeEmbeddingProvider(), enabled: true, dailyBudgetUsd: 5, timezone: "America/Sao_Paulo",
    model: "gemini-embedding-001", sleep: async () => {}, now: () => new Date(), config, ...over,
  }) as Partial<EmbedDeps> & { config: typeof config };

const NET = "Sem internet no prédio todo, ninguém consegue conectar na rede";
let n = 0;
const mkTicket = (over: Record<string, unknown> = {}) =>
  db.ticket.create({
    data: {
      title: `Internet caiu ${++n}`, description: `${NET} sala ${n}`, requesterId: requesterRow.id,
      teamId: t1, status: "OPEN", ...over,
    },
  });

const groups = () => db.incidentGroup.findMany({ include: { tickets: true } });
const events = async () => {
  const exists = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
  return exists[0].ok ? queuedEvents(db, "incident.detected") : []; // o schema do pg-boss só nasce no primeiro enfileiramento
};

async function fiveNetTickets(teams = [t1, t2, t1, t2, t1]) {
  const out = [];
  for (const [i, teamId] of teams.entries()) {
    out.push(await mkTicket({ teamId, createdAt: new Date(Date.now() - (teams.length - i) * 1000) }));
  }
  return out;
}

describe("detecção de incidente", () => {
  it("4 chamados parecidos não criam grupo", async () => {
    const ts = await fiveNetTickets();
    for (const t of ts.slice(0, 4)) await ai.detectForTicket(t.id, deps());
    expect(await groups()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  it("o 5º cria UM grupo com os 5 e UM evento sem descrição", async () => {
    const ts = await fiveNetTickets();
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    const [g] = await groups();
    expect(await groups()).toHaveLength(1);
    expect(g.status).toBe("OPEN");
    expect(g.tickets).toHaveLength(5);
    expect(g.title).toBe(ts[0].title); // o mais antigo do conjunto
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0].data).toMatchObject({ id: g.id, title: ts[0].title, ticketCount: 5, url: "http://app.test/incidentes" });
    expect((ev[0].data as { teams: string[] }).teams.sort()).toEqual(["T1", "T2"]);
    expect(ev[0].raw).not.toContain("sala");
  });

  it("o 6º chamado entra no mesmo grupo, sem novo evento", async () => {
    const ts = await fiveNetTickets();
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    const sixth = await mkTicket();
    await ai.detectForTicket(sixth.id, deps());
    const gs = await groups();
    expect(gs).toHaveLength(1);
    expect(gs[0].tickets.map((t) => t.id)).toContain(sixth.id);
    expect(await events()).toHaveLength(1);
  });

  it("chamado de outro assunto não entra no grupo", async () => {
    const ts = await fiveNetTickets();
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    const other = await mkTicket({ title: "Orçamento", description: "Orçamento anual do financeiro e previsão de compras" });
    await ai.detectForTicket(other.id, deps());
    expect((await db.ticket.findUniqueOrThrow({ where: { id: other.id } })).incidentGroupId).toBeNull();
  });

  it("chamados fora da janela de 30 minutos não contam", async () => {
    const old = [];
    for (let i = 0; i < 3; i++) old.push(await mkTicket({ createdAt: new Date(Date.now() - 2 * 3600_000) }));
    const fresh = [await mkTicket(), await mkTicket()];
    for (const t of [...old, ...fresh]) await ai.detectForTicket(t.id, deps());
    expect(await groups()).toHaveLength(0);
  });

  it("reprocessar o job não cria segundo grupo nem segundo evento", async () => {
    const ts = await fiveNetTickets();
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    await ai.detectForTicket(ts[4].id, deps());
    await ai.detectForTicket(ts[4].id, deps());
    expect(await groups()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
  });

  it("dois jobs em paralelo para o mesmo conjunto criam um único grupo", async () => {
    const ts = await fiveNetTickets();
    for (const t of ts) await ai.detectForTicket(t.id, deps({ config: { ...config, incidentMinTickets: 99 } }));
    await Promise.all([ai.detectForTicket(ts[3].id, deps()), ai.detectForTicket(ts[4].id, deps())]);
    expect(await groups()).toHaveLength(1);
    expect(await events()).toHaveLength(1);
  });

  it("chamado de equipe com a IA desligada não conta", async () => {
    const off = await db.team.create({ data: { name: "RH", aiEnabled: false } });
    const ts = await fiveNetTickets([t1, t1, t1, t1, off.id]);
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    expect(await groups()).toHaveLength(0);
  });
});

describe("encerramento", () => {
  async function openGroup() {
    const ts = await fiveNetTickets();
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    return { ts, group: (await groups())[0] };
  }

  it("o grupo fecha sozinho quando todos os chamados terminam, e não antes", async () => {
    const { ts, group } = await openGroup();
    for (const t of ts.slice(0, 4)) {
      await db.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED" } });
      await ai.detectForTicket(t.id, deps());
    }
    expect((await db.incidentGroup.findUniqueOrThrow({ where: { id: group.id } })).status).toBe("OPEN");
    await db.ticket.update({ where: { id: ts[4].id }, data: { status: "CLOSED" } });
    await ai.detectForTicket(ts[4].id, deps());
    const closed = await db.incidentGroup.findUniqueOrThrow({ where: { id: group.id } });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it("closeIncident: líder da equipe encerra, audita e grava quem fechou", async () => {
    const { group } = await openGroup();
    await ai.closeIncident(lead1, group.id);
    expect(await db.incidentGroup.findUniqueOrThrow({ where: { id: group.id } })).toMatchObject({ status: "CLOSED", closedById: lead1.id });
    expect(await db.auditLog.count({ where: { action: "incident.close", targetId: group.id } })).toBe(1);
  });

  it("líder de outra equipe recebe 404, técnico e solicitante 403, segunda vez 409; admin pode", async () => {
    const { group } = await openGroup();
    await expect(ai.closeIncident(lead3, group.id)).rejects.toMatchObject({ status: 404 });
    await expect(ai.closeIncident(agent, group.id)).rejects.toMatchObject({ status: 403 });
    await expect(ai.closeIncident(requester, group.id)).rejects.toMatchObject({ status: 403 });
    await ai.closeIncident(admin, group.id);
    await expect(ai.closeIncident(lead1, group.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("leitura", () => {
  it("listIncidents: líder vê só grupos com chamado da equipe dele, com os chamados que ele pode abrir", async () => {
    const ts = await fiveNetTickets([t1, t2, t2, t2, t2]);
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    const mine = await ai.listIncidents(lead1);
    expect(mine.open).toHaveLength(1);
    expect(mine.open[0].ticketCount).toBe(5);
    expect(mine.open[0].tickets.map((t) => t.id)).toEqual([ts[0].id]); // só o chamado da T1
    expect((await ai.listIncidents(lead3)).open).toHaveLength(0);
    expect((await ai.listIncidents(admin)).open[0].tickets).toHaveLength(5);
  });

  it("listIncidents devolve os 10 últimos encerrados e exige permissão", async () => {
    for (let i = 0; i < 12; i++) {
      const g = await db.incidentGroup.create({ data: { title: `G${i}`, status: "CLOSED", closedAt: new Date(Date.now() - i * 1000) } });
      const t = await mkTicket({ status: "RESOLVED", incidentGroupId: g.id });
      void t;
    }
    expect((await ai.listIncidents(admin)).recentClosed).toHaveLength(10);
    await expect(ai.listIncidents(agent)).rejects.toMatchObject({ status: 403 });
    await expect(ai.listIncidents(requester)).rejects.toMatchObject({ status: 403 });
  });

  it("faixa e aviso: líder vê a faixa; técnico da equipe vê o aviso no chamado; solicitante nada", async () => {
    const ts = await fiveNetTickets();
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    expect(await ai.getOpenIncidentBanner(lead1)).toHaveLength(1);
    expect(await ai.getOpenIncidentBanner(agent)).toEqual([]);
    expect(await ai.getOpenIncidentBanner(requester)).toEqual([]);
    const full = await db.ticket.findUniqueOrThrow({ where: { id: ts[0].id } });
    const asTicket = full as never;
    expect(await ai.getIncidentNotice(agent, asTicket)).toMatchObject({ ticketCount: 5 });
    expect(await ai.getIncidentNotice(requester, asTicket)).toBeNull();
    await ai.closeIncident(admin, (await groups())[0].id);
    expect(await ai.getIncidentNotice(agent, asTicket)).toBeNull();
    expect(await ai.getOpenIncidentBanner(lead1)).toEqual([]);
  });
});
