import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";
import type { EmbedDeps } from "@/modules/ai/embedding/run";
import type { EmbeddingProvider } from "@/modules/ai/embedding/types";
import { AiError } from "@/modules/ai/types";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let detect: typeof import("@/modules/ai/detect");
let tickets: typeof import("@/modules/tickets");
let t1: string, t2: string;
let requesterRow: { id: string };
let requester: SessionUser, agent: SessionUser;
let calls = 0;

const config = {
  duplicateMinSimilarity: 0.5,
  duplicateWindowHours: 72,
  incidentMinSimilarity: 0.5,
  incidentWindowMinutes: 30,
  incidentMinTickets: 5,
};

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, AI_ENABLED: "true" });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  detect = await import("@/modules/ai/detect");
  tickets = await import("@/modules/tickets");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  calls = 0;
  process.env.AI_ENABLED = "true";
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job WHERE name = 'ai.detect'; END IF; END $$`);
  await db.$executeRawUnsafe(`DELETE FROM "OpenTicketVector"`);
  await db.aiSuggestion.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.incidentGroup.deleteMany();
  await db.aiAuditLog.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  t2 = (await db.team.create({ data: { name: "T2" } })).id;
  const r = await db.user.create({ data: { name: "req", email: "req@x.com", role: "REQUESTER" } });
  const a = await db.user.create({ data: { name: "agent", email: "agent@x.com", role: "AGENT", teams: { create: [{ teamId: t1 }] } } });
  requesterRow = r;
  requester = { id: r.id, name: r.name, email: r.email, role: "REQUESTER", teamIds: [] };
  agent = { id: a.id, name: a.name, email: a.email, role: "AGENT", teamIds: [t1] };
});

const counting = (inner: EmbeddingProvider = new FakeEmbeddingProvider()): EmbeddingProvider => ({
  name: "fake",
  embed: async (texts, o) => {
    calls++;
    return inner.embed(texts, o);
  },
});

const deps = (over: Partial<EmbedDeps> = {}) => ({
  db, provider: counting(), enabled: true, dailyBudgetUsd: 5, timezone: "America/Sao_Paulo",
  model: "gemini-embedding-001", sleep: async () => {}, now: () => new Date(), config, ...over,
});

const NET = "Sem internet no prédio todo, ninguém consegue conectar na rede";
const NET2 = "Sem internet no prédio, ninguém conecta na rede";
const OTHER = "Orçamento anual do financeiro e previsão de compras";

const open = (title: string, description: string, over: Record<string, unknown> = {}) =>
  db.ticket.create({ data: { title, description, requesterId: requesterRow.id, teamId: t1, status: "OPEN", ...over } });

const vectorCount = async (ticketId?: string) =>
  Number(
    (ticketId
      ? await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "OpenTicketVector" WHERE "ticketId" = ${ticketId}`
      : await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "OpenTicketVector"`)[0].n,
  );

const duplicates = (ticketId: string) => db.aiSuggestion.findFirst({ where: { ticketId, kind: "DUPLICATE" } });
const queuedDetect = async () => {
  const exists = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
  if (!exists[0].ok) return [];
  return db.$queryRaw<{ data: { ticketId: string } }[]>`SELECT data FROM pgboss.job WHERE name = 'ai.detect'`;
};

describe("vetor do chamado aberto", () => {
  it("grava um vetor de 768 dimensões para o chamado novo", async () => {
    const t = await open("Internet caiu", NET);
    expect(await detect.detectForTicket(t.id, deps())).toBe("detected");
    expect(await vectorCount(t.id)).toBe(1);
    const dims = await db.$queryRaw<{ d: number }[]>`SELECT vector_dims("embedding") AS d FROM "OpenTicketVector" WHERE "ticketId" = ${t.id}`;
    expect(dims[0].d).toBe(768);
  });

  it("reprocessar não chama o provider de novo; trocar o modelo reembeda", async () => {
    const t = await open("Internet caiu", NET);
    await detect.detectForTicket(t.id, deps());
    const before = calls;
    await detect.detectForTicket(t.id, deps());
    expect(calls).toBe(before);
    await detect.detectForTicket(t.id, deps({ model: "gemini-embedding-002" }));
    expect(calls).toBe(before + 1);
  });

  it("chamado resolvido ou fechado perde o vetor; reaberto volta a ter", async () => {
    const t = await open("Internet caiu", NET);
    await detect.detectForTicket(t.id, deps());
    await db.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED" } });
    expect(await detect.detectForTicket(t.id, deps())).toBe("removed");
    expect(await vectorCount(t.id)).toBe(0);
    await db.ticket.update({ where: { id: t.id }, data: { status: "OPEN" } });
    expect(await detect.detectForTicket(t.id, deps())).toBe("detected");
    expect(await vectorCount(t.id)).toBe(1);
  });

  it("chamado inexistente é ignorado", async () => {
    expect(await detect.detectForTicket("nao-existe", deps())).toBe("skipped");
  });

  it("equipe com a IA desligada: sem vetor e sem chamada ao provider", async () => {
    const off = await db.team.create({ data: { name: "RH", aiEnabled: false } });
    const t = await open("Internet caiu", NET, { teamId: off.id });
    const before = calls;
    expect(await detect.detectForTicket(t.id, deps())).toBe("removed");
    expect(calls).toBe(before);
    expect(await vectorCount()).toBe(0);
  });

  it("IA desligada ou teto estourado: nada é gravado e o chamado segue intacto", async () => {
    const t = await open("Internet caiu", NET);
    expect(await detect.detectForTicket(t.id, deps({ enabled: false }))).toBe("skipped");
    expect(await detect.detectForTicket(t.id, deps({ dailyBudgetUsd: 0 }))).toBe("skipped");
    expect(await vectorCount()).toBe(0);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("OPEN");
  });

  it("erro do provider propaga e não grava nada", async () => {
    const t = await open("Internet caiu", NET);
    const broken: EmbeddingProvider = { name: "fake", embed: vi.fn().mockRejectedValue(new AiError("cota", false)) };
    await expect(detect.detectForTicket(t.id, deps({ provider: broken }))).rejects.toBeInstanceOf(AiError);
    expect(await vectorCount()).toBe(0);
    expect(await duplicates(t.id)).toBeNull();
  });

  it("o texto vai mascarado ao provider", async () => {
    const t = await open("Internet caiu", `${NET}. Meu CPF 123.456.789-09`);
    let seen: string[] = [];
    const provider: EmbeddingProvider = { name: "fake", embed: async (texts, o) => ((seen = texts), new FakeEmbeddingProvider().embed(texts, o)) };
    await detect.detectForTicket(t.id, deps({ provider }));
    expect(seen[0]).toContain("[CPF_1]");
    expect(seen[0]).not.toContain("123.456.789-09");
  });
});

describe("possíveis duplicados", () => {
  it("sugere o chamado parecido da mesma equipe, com número, título e similaridade", async () => {
    const old = await open("Internet caiu no prédio", NET, { createdAt: new Date(Date.now() - 3600_000) });
    await detect.detectForTicket(old.id, deps());
    const novo = await open("Sem internet", NET2);
    await detect.detectForTicket(novo.id, deps());
    const s = await duplicates(novo.id);
    expect(s).toMatchObject({ kind: "DUPLICATE", status: "PENDING" });
    const payload = s!.payload as { candidates: { ticketId: string; number: number; title: string; similarity: number }[] };
    expect(payload.candidates).toHaveLength(1);
    expect(payload.candidates[0]).toMatchObject({ ticketId: old.id, number: old.number, title: "Internet caiu no prédio" });
    expect(payload.candidates[0].similarity).toBeGreaterThan(0.5);
    expect(s!.confidence).toBeCloseTo(payload.candidates[0].similarity);
  });

  it("não sugere de outra equipe, de mais de 72 h, resolvido, fechado ou o próprio chamado", async () => {
    const other = await open("Internet caiu A", NET, { teamId: t2 });
    const oldie = await open("Internet caiu B", NET, { createdAt: new Date(Date.now() - 73 * 3600_000) });
    const done = await open("Internet caiu C", NET, { status: "RESOLVED" });
    const closed = await open("Internet caiu D", NET, { status: "CLOSED" });
    for (const t of [other, oldie]) await detect.detectForTicket(t.id, deps());
    // resolvido/fechado nunca ficam com vetor; força um vetor para provar que a consulta também filtra
    const probe = await open("Sonda", NET);
    await detect.detectForTicket(probe.id, deps());
    for (const t of [done, closed]) {
      await db.$executeRaw`INSERT INTO "OpenTicketVector" ("ticketId","contentHash","embedding") SELECT ${t.id}, 'h', "embedding" FROM "OpenTicketVector" WHERE "ticketId" = ${probe.id}`;
    }
    const novo = await open("Sem internet", NET2);
    await detect.detectForTicket(novo.id, deps());
    const candidates = await detect.findDuplicates(novo.id, deps());
    expect(candidates.map((c) => c.ticketId)).toEqual([probe.id]);
  });

  it("no máximo 3 candidatos, do mais parecido para o menos", async () => {
    const mk = async (title: string, desc: string) => {
      const t = await open(title, desc);
      await detect.detectForTicket(t.id, deps());
      return t;
    };
    await mk("A", NET);
    await mk("B", `${NET} e o wifi também`);
    await mk("C", `${NET} desde cedo hoje`);
    await mk("D", `${NET} com várias salas afetadas e reclamações`);
    const novo = await open("Sem internet", NET2);
    await detect.detectForTicket(novo.id, deps());
    const c = await detect.findDuplicates(novo.id, deps());
    expect(c.length).toBeLessThanOrEqual(3);
    expect(c.map((x) => x.similarity)).toEqual([...c.map((x) => x.similarity)].sort((a, b) => b - a));
  });

  it("texto diferente não gera sugestão e reprocessar não duplica a sugestão", async () => {
    const a = await open("Internet caiu", NET);
    await detect.detectForTicket(a.id, deps());
    const diff = await open("Orçamento", OTHER);
    await detect.detectForTicket(diff.id, deps());
    expect(await duplicates(diff.id)).toBeNull();
    const dup = await open("Sem internet", NET2);
    await detect.detectForTicket(dup.id, deps());
    await detect.detectForTicket(dup.id, deps());
    expect(await db.aiSuggestion.count({ where: { ticketId: dup.id, kind: "DUPLICATE" } })).toBe(1);
  });

  it("equipe com a IA desligada não entra como candidata", async () => {
    const a = await open("Internet caiu", NET);
    await detect.detectForTicket(a.id, deps());
    await db.team.update({ where: { id: t1 }, data: { aiEnabled: false } });
    const novo = await open("Sem internet", NET2);
    expect(await detect.detectForTicket(novo.id, deps())).toBe("removed");
    expect(await duplicates(novo.id)).toBeNull();
  });
});

describe("enfileiramento", () => {
  it("criar chamado e mudar o status enfileiram ai.detect; sem IA nada é enfileirado", async () => {
    const t = await tickets.createTicket(requester, { title: "Internet caiu", description: NET });
    expect((await queuedDetect()).map((j) => j.data.ticketId)).toEqual([t.id]);
    await db.ticket.update({ where: { id: t.id }, data: { teamId: t1 } });
    await tickets.changeStatus(agent, t.id, "OPEN");
    expect((await queuedDetect()).filter((j) => j.data.ticketId === t.id).length).toBeGreaterThanOrEqual(2);
    process.env.AI_ENABLED = "false";
    await db.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'ai.detect'`);
    await tickets.createTicket(requester, { title: "Outro", description: "x" });
    expect(await queuedDetect()).toHaveLength(0);
  });

  it("reabrir enfileira ai.detect", async () => {
    const t = await open("Internet caiu", NET, { status: "RESOLVED", resolvedAt: new Date(), resolution: "Reiniciei o roteador do prédio." });
    await tickets.reopenTicket(requester, t.id, "Voltou a cair depois de uma hora.");
    expect((await queuedDetect()).map((j) => j.data.ticketId)).toContain(t.id);
  });
});
