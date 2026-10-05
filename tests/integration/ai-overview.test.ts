import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let ai: typeof import("@/modules/ai");
let admin: SessionUser, agent: SessionUser;
let teamA: string;
let ticketIds: string[];

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"]): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds: [],
});

const cfg = (over: Record<string, unknown> = {}) =>
  ({ AI_ENABLED: true, LLM_PROVIDER: "fake", EMBEDDING_PROVIDER: "fake", AI_DAILY_BUDGET: 5, APP_TIMEZONE: "America/Sao_Paulo", ...over }) as never;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
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
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job WHERE name = 'ai.reindex_all'; END IF; END $$`);
  await db.$executeRawUnsafe(`DELETE FROM "TicketEmbedding"`);
  await db.$executeRawUnsafe(`DELETE FROM "KbChunk"`);
  await db.kbArticle.deleteMany();
  await db.auditLog.deleteMany();
  await db.aiAuditLog.deleteMany();
  await db.aiSuggestion.deleteMany();
  await db.ticket.deleteMany();
  await db.incidentGroup.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  teamA = (await db.team.create({ data: { name: "Equipe A" } })).id;
  const a = await db.user.create({ data: { name: "adm", email: "adm@x.com", role: "ADMIN" } });
  const g = await db.user.create({ data: { name: "ag", email: "ag@x.com", role: "AGENT" } });
  admin = session(a, "ADMIN");
  agent = session(g, "AGENT");
  ticketIds = [];
  for (let i = 0; i < 4; i++) {
    ticketIds.push((await db.ticket.create({ data: { title: `t${i}`, description: "d", requesterId: a.id } })).id);
  }
});

const log = (over: Record<string, unknown> = {}) =>
  db.aiAuditLog.create({
    data: {
      provider: "fake", model: "fake-triage", jobType: "triage", inputTokens: 10, outputTokens: 5,
      costUsd: "0.5", latencyMs: 20, inputHash: "h", outcome: "OK", maskedInput: "TEXTO MASCARADO", error: "detalhe interno",
      ...over,
    } as never,
  });

describe("getAiOverview", () => {
  it("exige admin", async () => {
    await expect(ai.getAiOverview(agent, cfg())).rejects.toMatchObject({ status: 403 });
  });

  it("conta decisões por status", async () => {
    const statuses = ["PENDING", "ACCEPTED", "ACCEPTED", "REJECTED"] as const;
    for (const [i, status] of statuses.entries()) {
      await db.aiSuggestion.create({ data: { ticketId: ticketIds[i], kind: "TRIAGE", payload: {}, confidence: 0.8, status } });
    }
    const o = await ai.getAiOverview(admin, cfg());
    expect(o.acceptance).toEqual({ pending: 1, accepted: 2, edited: 0, rejected: 1 });
  });

  it("soma o gasto só de hoje e informa o teto", async () => {
    await log({ costUsd: "1.25" });
    await log({ costUsd: "9", createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) });
    const o = await ai.getAiOverview(admin, cfg());
    expect(o.spentTodayUsd).toBeCloseTo(1.25);
    expect(o.budgetUsd).toBe(5);
  });

  it("as últimas execuções não expõem texto de chamado nem detalhe de erro", async () => {
    await log();
    const o = await ai.getAiOverview(admin, cfg());
    expect(o.recent).toHaveLength(1);
    expect(JSON.stringify(o)).not.toContain("TEXTO MASCARADO");
    expect(JSON.stringify(o)).not.toContain("detalhe interno");
    expect(o.recent[0]).toMatchObject({ jobType: "triage", model: "fake-triage", outcome: "OK", latencyMs: 20 });
  });

  it("explica por que a IA está desligada", async () => {
    expect((await ai.getAiOverview(admin, cfg({ AI_ENABLED: false }))).reason).toMatch(/AI_ENABLED/);
    const semChave = await ai.getAiOverview(admin, cfg({ LLM_PROVIDER: "gemini" }));
    expect(semChave).toMatchObject({ enabled: false });
    expect(semChave.reason).toMatch(/chave.*gemini/i);
    const ok = await ai.getAiOverview(admin, cfg());
    expect(ok).toMatchObject({ enabled: true, reason: null, provider: "fake", model: "fake-triage" });
  });

  it("lista as equipes com o interruptor", async () => {
    const o = await ai.getAiOverview(admin, cfg());
    expect(o.teams).toEqual([{ id: teamA, name: "Equipe A", aiEnabled: true }]);
  });
});

describe("setTeamAi", () => {
  it("liga e desliga a equipe e audita", async () => {
    await ai.setTeamAi(admin, teamA, false);
    expect((await db.team.findUniqueOrThrow({ where: { id: teamA } })).aiEnabled).toBe(false);
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "team.ai_toggle" } });
    expect(entry).toMatchObject({ targetId: teamA, actorId: admin.id, data: { enabled: false } });
  });

  it("não-admin recebe 403 e equipe inexistente 404", async () => {
    await expect(ai.setTeamAi(agent, teamA, false)).rejects.toMatchObject({ status: 403 });
    await expect(ai.setTeamAi(admin, "nao-existe", false)).rejects.toMatchObject({ status: 404 });
  });
});

describe("índice de conhecimento", () => {
  const zero = `[${new Array(768).fill(0).join(",")}]`;

  it("conta artigos publicados, trechos e chamados indexados", async () => {
    const adminRow = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
    const pub = await db.kbArticle.create({ data: { title: "Publicado", body: "x", published: true, createdById: adminRow.id, updatedById: adminRow.id } });
    await db.kbArticle.create({ data: { title: "Rascunho", body: "y", published: false, createdById: adminRow.id, updatedById: adminRow.id } });
    await db.$executeRaw`INSERT INTO "KbChunk" ("id","articleId","position","text","contentHash","embedding") VALUES ('c1', ${pub.id}, 0, 't', 'h', ${zero}::vector)`;
    await db.$executeRaw`INSERT INTO "KbChunk" ("id","articleId","position","text","contentHash","embedding") VALUES ('c2', ${pub.id}, 1, 't2', 'h2', ${zero}::vector)`;
    await db.$executeRaw`INSERT INTO "TicketEmbedding" ("ticketId","contentHash","embedding") VALUES (${ticketIds[0]}, 'h', ${zero}::vector)`;
    const o = await ai.getAiOverview(admin, cfg());
    expect(o.knowledge).toEqual({ articles: 1, chunks: 2, tickets: 1 });
  });

  it("explica quando falta a chave do provider de embeddings", async () => {
    const o = await ai.getAiOverview(admin, cfg({ EMBEDDING_PROVIDER: "gemini" }));
    expect(o.ragReason).toMatch(/embeddings.*gemini/i);
    expect((await ai.getAiOverview(admin, cfg())).ragReason).toBeNull();
  });
});

describe("requestReindex", () => {
  it("enfileira a reindexação e audita", async () => {
    await ai.requestReindex(admin);
    const jobs = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pgboss.job WHERE name = 'ai.reindex_all'`;
    expect(Number(jobs[0].n)).toBe(1);
    expect(await db.auditLog.count({ where: { action: "ai.reindex", actorId: admin.id } })).toBe(1);
  });

  it("não-admin recebe 403 e nada é enfileirado", async () => {
    await expect(ai.requestReindex(agent)).rejects.toMatchObject({ status: 403 });
    expect(await db.auditLog.count({ where: { action: "ai.reindex" } })).toBe(0);
  });
});

describe("duplicados e incidentes", () => {
  it("conta duplicados sugeridos e ignorados e os incidentes detectados e abertos", async () => {
    const statuses = ["PENDING", "PENDING", "REJECTED"] as const;
    for (const [i, status] of statuses.entries()) {
      await db.aiSuggestion.create({ data: { ticketId: ticketIds[i], kind: "DUPLICATE", payload: { candidates: [] }, confidence: 0.9, status } });
    }
    await db.aiSuggestion.create({ data: { ticketId: ticketIds[3], kind: "TRIAGE", payload: {}, confidence: 0.9 } }); // outro tipo não conta
    await db.incidentGroup.create({ data: { title: "A" } });
    await db.incidentGroup.create({ data: { title: "B" } });
    await db.incidentGroup.create({ data: { title: "C", status: "CLOSED", closedAt: new Date() } });
    const o = await ai.getAiOverview(admin, cfg());
    expect(o.detection).toEqual({ duplicatesSuggested: 3, duplicatesDismissed: 1, incidentsDetected: 3, incidentsOpen: 2 });
  });

  it("sem dados tudo é zero", async () => {
    expect((await ai.getAiOverview(admin, cfg())).detection).toEqual({ duplicatesSuggested: 0, duplicatesDismissed: 0, incidentsDetected: 0, incidentsOpen: 0 });
  });
});
