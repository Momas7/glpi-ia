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
let t1: string, t2: string;
let requesterRow: { id: string };
let lead1: SessionUser, agent: SessionUser;
let calls = 0;

const config = { duplicateMinSimilarity: 0.5, duplicateWindowHours: 72, incidentMinSimilarity: 0.5, incidentWindowMinutes: 30, incidentMinTickets: 5 };

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"], teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, {
    DATABASE_URL: testDb.url, AI_ENABLED: "true", APP_URL: "http://app.test",
    N8N_WEBHOOK_URL: "http://n8n.local/webhook/x", N8N_WEBHOOK_SECRET: "s".repeat(40),
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
  calls = 0;
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job WHERE name = 'webhook.deliver'; END IF; END $$`);
  await db.webhookDelivery.deleteMany();
  await db.$executeRawUnsafe(`DELETE FROM "OpenTicketVector"`);
  await db.aiSuggestion.deleteMany();
  await db.ticket.deleteMany();
  await db.incidentGroup.deleteMany();
  await db.aiAuditLog.deleteMany();
  await db.auditLog.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  t2 = (await db.team.create({ data: { name: "T2" } })).id;
  const mk = (name: string, role: SessionUser["role"], teams: string[] = []) =>
    db.user.create({ data: { name, email: `${name}@x.com`, role, teams: { create: teams.map((teamId) => ({ teamId })) } } });
  requesterRow = await mk("requester", "REQUESTER");
  lead1 = session(await mk("lead1", "TEAM_LEAD", [t1]), "TEAM_LEAD", [t1]);
  agent = session(await mk("agent", "AGENT", [t1]), "AGENT", [t1]);
});

const deps = (over: Record<string, unknown> = {}) =>
  ({
    db,
    provider: { name: "fake", embed: async (texts: string[], o: never) => ((calls += 1), new FakeEmbeddingProvider().embed(texts, o)) },
    enabled: true, dailyBudgetUsd: 5, timezone: "America/Sao_Paulo", model: "gemini-embedding-001",
    sleep: async () => {}, now: () => new Date(), config, ...over,
  }) as Partial<EmbedDeps> & { config: typeof config };

const NET = "Sem internet no prédio todo, ninguém consegue conectar na rede";
let n = 0;
const mkTicket = (over: Record<string, unknown> = {}) =>
  db.ticket.create({
    data: { title: `Internet caiu ${++n}`, description: `${NET} sala ${n}`, requesterId: requesterRow.id, teamId: t1, status: "OPEN", ...over },
  });
const events = async () => {
  const exists = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
  return exists[0].ok ? queuedEvents(db, "incident.detected") : [];
};

describe("incidente encerrado à mão não volta", () => {
  it("reprocessar um chamado do grupo encerrado não cria novo grupo nem novo evento nem tira o chamado do grupo", async () => {
    const ts = [];
    for (let i = 0; i < 5; i++) ts.push(await mkTicket({ createdAt: new Date(Date.now() - (5 - i) * 1000) }));
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    const [group] = await db.incidentGroup.findMany();
    await ai.closeIncident(lead1, group.id);
    expect(await events()).toHaveLength(1);

    await db.ticket.update({ where: { id: ts[2].id }, data: { status: "PENDING" } });
    await ai.detectForTicket(ts[2].id, deps());

    expect(await db.incidentGroup.count()).toBe(1);
    expect((await db.incidentGroup.findUniqueOrThrow({ where: { id: group.id } })).status).toBe("CLOSED");
    expect(await events()).toHaveLength(1);
    for (const t of ts) expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).incidentGroupId).toBe(group.id);
  });

  it("um chamado novo parecido depois do encerramento não recria o incidente com os chamados antigos", async () => {
    const ts = [];
    for (let i = 0; i < 5; i++) ts.push(await mkTicket({ createdAt: new Date(Date.now() - (5 - i) * 1000) }));
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    const [group] = await db.incidentGroup.findMany();
    await ai.closeIncident(lead1, group.id);
    const sixth = await mkTicket();
    await ai.detectForTicket(sixth.id, deps());
    expect(await db.incidentGroup.count()).toBe(1);
    expect(await events()).toHaveLength(1);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: sixth.id } })).incidentGroupId).toBeNull();
  });
});

describe("título do incidente", () => {
  it("é mascarado no grupo e no evento enviado ao n8n", async () => {
    const ts = [];
    for (let i = 0; i < 5; i++) {
      ts.push(await mkTicket({ title: i === 0 ? "Internet caiu CPF 123.456.789-09 e a.silva@empresa.com" : `Internet caiu ${i}`, createdAt: new Date(Date.now() - (5 - i) * 1000) }));
    }
    for (const t of ts) await ai.detectForTicket(t.id, deps());
    const [group] = await db.incidentGroup.findMany();
    expect(group.title).toContain("[CPF_1]");
    expect(group.title).toContain("[EMAIL_1]");
    expect(group.title).not.toContain("123.456.789-09");
    const ev = await events();
    expect(ev[0].raw).not.toContain("123.456.789-09");
    expect(ev[0].raw).not.toContain("a.silva@empresa.com");
  });
});

describe("Reindexar tudo refaz os vetores dos chamados abertos", () => {
  it("cria o vetor de chamado aberto que ficou sem (cota) e reembeda quando o modelo muda", async () => {
    await mkTicket();
    await mkTicket();
    const out = await ai.reindexAll({ batchSize: 5, pauseMs: 0, sleep: async () => {} }, deps());
    expect(out.openTickets).toBe(2);
    const count = async () => Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "OpenTicketVector"`)[0].n);
    expect(await count()).toBe(2);
    const before = calls;
    expect((await ai.reindexAll({ batchSize: 5, pauseMs: 0, sleep: async () => {} }, deps())).openTickets).toBe(0);
    expect(calls).toBe(before);
    expect((await ai.reindexAll({ batchSize: 5, pauseMs: 0, sleep: async () => {} }, deps({ model: "gemini-embedding-002" }))).openTickets).toBe(2);
  });

  it("não cria vetor de chamado resolvido e remove o de quem foi encerrado", async () => {
    const done = await mkTicket({ status: "RESOLVED", resolvedAt: new Date(), resolution: "Reiniciei o roteador do prédio." });
    const open = await mkTicket();
    await ai.detectForTicket(open.id, deps());
    await db.ticket.update({ where: { id: open.id }, data: { status: "CLOSED" } });
    await ai.reindexAll({ batchSize: 5, pauseMs: 0, sleep: async () => {} }, deps());
    const rows = await db.$queryRaw<{ ticketId: string }[]>`SELECT "ticketId" FROM "OpenTicketVector"`;
    expect(rows.map((r) => r.ticketId)).not.toContain(done.id);
    expect(rows.map((r) => r.ticketId)).not.toContain(open.id);
  });
});

describe("cartão de duplicados e chamados de outra equipe", () => {
  it("candidato que o técnico não pode abrir aparece sem título", async () => {
    const hidden = await mkTicket({ teamId: t2, title: "Título secreto da outra equipe" });
    const mine = await mkTicket();
    await db.aiSuggestion.create({
      data: {
        ticketId: mine.id, kind: "DUPLICATE", confidence: 0.9,
        payload: { candidates: [{ ticketId: hidden.id, number: hidden.number, title: hidden.title, similarity: 0.9 }] },
      },
    });
    const view = await ai.getDuplicatesView(agent, (await db.ticket.findUniqueOrThrow({ where: { id: mine.id } })) as never);
    expect(view!.candidates[0]).toMatchObject({ number: hidden.number, canOpen: false });
    expect(JSON.stringify(view)).not.toContain("Título secreto");
  });
});

describe("busca com filtros usa varredura iterativa do HNSW", () => {
  it("o helper liga hnsw.iterative_scan dentro da transação", async () => {
    const seen = await ai.withIterativeScan(db, async (tx) => {
      const r = await tx.$queryRaw<{ v: string | null }[]>`SELECT current_setting('hnsw.iterative_scan', true) AS v`;
      return r[0].v;
    });
    expect(seen).toBe("relaxed_order");
  });
});
