import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";
import type { EmbedDeps } from "@/modules/ai/embedding/run";
import type { EmbeddingProvider } from "@/modules/ai/embedding/types";
import { AiError } from "@/modules/ai/types";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let indexing: typeof import("@/modules/ai/indexing");
let lead: { id: string }, agent: { id: string }, requester: { id: string };
let calls = 0;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  indexing = await import("@/modules/ai/indexing");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  calls = 0;
  await db.$executeRawUnsafe(`DELETE FROM "TicketEmbedding"`);
  await db.$executeRawUnsafe(`DELETE FROM "KbChunk"`);
  await db.kbArticle.deleteMany();
  await db.ticketRating.deleteMany();
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.aiAuditLog.deleteMany();
  await db.user.deleteMany();
  lead = await db.user.create({ data: { name: "Lead", email: "lead@x.com", role: "TEAM_LEAD" } });
  agent = await db.user.create({ data: { name: "Agent", email: "agent@x.com", role: "AGENT" } });
  requester = await db.user.create({ data: { name: "Req", email: "req@x.com", role: "REQUESTER" } });
});

const counting = (inner: EmbeddingProvider = new FakeEmbeddingProvider()): EmbeddingProvider => ({
  name: "fake",
  embed: async (texts, o) => {
    calls++;
    return inner.embed(texts, o);
  },
});

const deps = (over: Partial<EmbedDeps> = {}): Partial<EmbedDeps> => ({
  db,
  provider: counting(),
  enabled: true,
  dailyBudgetUsd: 5,
  timezone: "America/Sao_Paulo",
  model: "gemini-embedding-001",
  sleep: async () => {},
  now: () => new Date(),
  ...over,
});

const article = (title: string, body: string, published = true) =>
  db.kbArticle.create({ data: { title, body, published, createdById: lead.id, updatedById: lead.id } });

const chunkCount = async (articleId: string) =>
  Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "KbChunk" WHERE "articleId" = ${articleId}`)[0].n);

const embedded = async (ticketId: string) =>
  Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "TicketEmbedding" WHERE "ticketId" = ${ticketId}`)[0].n) === 1;

const resolved = (over: Record<string, unknown> = {}) =>
  db.ticket.create({
    data: {
      title: "Impressora travada", description: "A fila não anda.", requesterId: requester.id,
      status: "RESOLVED", resolvedAt: new Date(), resolution: "Reiniciei o serviço de spool e limpei a fila.", ...over,
    },
  });

describe("indexArticle", () => {
  it("artigo publicado gera trechos com vetor e hash", async () => {
    const a = await article("Wi-Fi sem conexão", "Reinicie o roteador do andar e confira o cabo.");
    expect(await indexing.indexArticle(a.id, deps())).toBe("indexed");
    expect(await chunkCount(a.id)).toBe(1);
    const row = (await db.$queryRaw<{ contentHash: string; dims: number }[]>`SELECT "contentHash", vector_dims("embedding") AS dims FROM "KbChunk" WHERE "articleId" = ${a.id}`)[0];
    expect(row.dims).toBe(768);
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reindexar sem mudança não chama o provider", async () => {
    const a = await article("Wi-Fi", "Reinicie o roteador.");
    await indexing.indexArticle(a.id, deps());
    const before = calls;
    expect(await indexing.indexArticle(a.id, deps())).toBe("unchanged");
    expect(calls).toBe(before);
  });

  it("editar o texto troca os trechos", async () => {
    const a = await article("Wi-Fi", "Reinicie o roteador.");
    await indexing.indexArticle(a.id, deps());
    await db.kbArticle.update({ where: { id: a.id }, data: { body: "Troque o cabo de rede." } });
    expect(await indexing.indexArticle(a.id, deps())).toBe("indexed");
    const text = (await db.$queryRaw<{ text: string }[]>`SELECT "text" FROM "KbChunk" WHERE "articleId" = ${a.id}`)[0].text;
    expect(text).toContain("Troque o cabo");
    expect(await chunkCount(a.id)).toBe(1);
  });

  it("artigo longo vira vários trechos", async () => {
    const a = await article("Manual", Array.from({ length: 80 }, (_, i) => `Passo ${i}: confira o equipamento e anote o resultado.`).join(" "));
    await indexing.indexArticle(a.id, deps());
    expect(await chunkCount(a.id)).toBeGreaterThan(2);
  });

  it("despublicar remove os trechos; artigo inexistente também", async () => {
    const a = await article("Wi-Fi", "Reinicie o roteador.");
    await indexing.indexArticle(a.id, deps());
    await db.kbArticle.update({ where: { id: a.id }, data: { published: false } });
    expect(await indexing.indexArticle(a.id, deps())).toBe("removed");
    expect(await chunkCount(a.id)).toBe(0);
    expect(await indexing.indexArticle("nao-existe", deps())).toBe("removed");
  });

  it("IA desligada não altera o índice", async () => {
    const a = await article("Wi-Fi", "Reinicie o roteador.");
    expect(await indexing.indexArticle(a.id, deps({ enabled: false }))).toBe("unchanged");
    expect(await chunkCount(a.id)).toBe(0);
  });
});

describe("indexTicket", () => {
  it("chamado resolvido com solução é indexado com título, descrição e solução", async () => {
    const t = await resolved();
    await db.comment.create({ data: { ticketId: t.id, authorId: agent.id, body: "NOTA INTERNA SECRETA", internal: true } });
    expect(await indexing.indexTicket(t.id, deps())).toBe("indexed");
    expect(await embedded(t.id)).toBe(true);
    expect(indexing.ticketKnowledgeText({ title: "T", description: "D", solution: "S" })).toContain("S");
    expect(indexing.ticketKnowledgeText({ title: "T", description: "D", solution: "S" })).not.toContain("SECRETA");
  });

  it("sem solução usa o último comentário público de um técnico, ignorando solicitante e nota interna", async () => {
    const t = await resolved({ resolution: null });
    const at = (s: number) => new Date(Date.now() - s * 1000);
    await db.comment.create({ data: { ticketId: t.id, authorId: agent.id, body: "Reiniciei o switch", internal: false, createdAt: at(50) } });
    await db.comment.create({ data: { ticketId: t.id, authorId: requester.id, body: "Obrigado!", internal: false, createdAt: at(40) } });
    await db.comment.create({ data: { ticketId: t.id, authorId: agent.id, body: "senha do admin é 123", internal: true, createdAt: at(30) } });
    const captured: string[] = [];
    const provider: EmbeddingProvider = { name: "fake", embed: async (texts, o) => (captured.push(...texts), new FakeEmbeddingProvider().embed(texts, o)) };
    expect(await indexing.indexTicket(t.id, deps({ provider }))).toBe("indexed");
    expect(captured[0]).toContain("Reiniciei o switch");
    expect(captured[0]).not.toContain("Obrigado");
    expect(captured[0]).not.toContain("senha do admin");
  });

  it("sem solução e sem comentário de técnico: não elegível", async () => {
    const t = await resolved({ resolution: null });
    expect(await indexing.indexTicket(t.id, deps())).toBe("removed");
    expect(await embedded(t.id)).toBe(false);
  });

  it("reaberto sai do índice; chamado em andamento nunca entra", async () => {
    const t = await resolved();
    await indexing.indexTicket(t.id, deps());
    await db.ticket.update({ where: { id: t.id }, data: { status: "OPEN", resolvedAt: null } });
    expect(await indexing.indexTicket(t.id, deps())).toBe("removed");
    expect(await embedded(t.id)).toBe(false);
  });

  it("nota 2 tira da base e nota 3 mantém", async () => {
    const t = await resolved();
    await indexing.indexTicket(t.id, deps());
    await db.ticketRating.create({ data: { ticketId: t.id, raterId: requester.id, stars: 2 } });
    expect(await indexing.indexTicket(t.id, deps())).toBe("removed");
    await db.ticketRating.update({ where: { ticketId: t.id }, data: { stars: 3 } });
    expect(await indexing.indexTicket(t.id, deps())).toBe("indexed");
  });

  it("reindexar sem mudança não chama o provider; mudar a solução reindexa", async () => {
    const t = await resolved();
    await indexing.indexTicket(t.id, deps());
    const before = calls;
    expect(await indexing.indexTicket(t.id, deps())).toBe("unchanged");
    expect(calls).toBe(before);
    await db.ticket.update({ where: { id: t.id }, data: { resolution: "Troquei o cabo de rede do posto." } });
    expect(await indexing.indexTicket(t.id, deps())).toBe("indexed");
  });

  it("IA desligada ou teto estourado não altera o índice", async () => {
    const t = await resolved();
    expect(await indexing.indexTicket(t.id, deps({ enabled: false }))).toBe("unchanged");
    expect(await indexing.indexTicket(t.id, deps({ dailyBudgetUsd: 0 }))).toBe("unchanged");
    expect(await embedded(t.id)).toBe(false);
  });
});

describe("reindexAll", () => {
  it("indexa artigos publicados e chamados elegíveis em lotes, com pausa entre os lotes", async () => {
    for (let i = 0; i < 3; i++) await article(`Artigo ${i}`, `Texto do artigo ${i}`);
    await article("Rascunho", "não entra", false);
    for (let i = 0; i < 3; i++) await resolved({ title: `Chamado ${i}` });
    await db.ticket.create({ data: { title: "Aberto", description: "d", requesterId: requester.id } });
    const sleep = vi.fn(async (_ms: number) => {});
    const out = await indexing.reindexAll({ batchSize: 2, pauseMs: 5000, sleep }, deps());
    expect(out).toEqual({ articles: 3, tickets: 3 });
    expect(sleep).toHaveBeenCalled();
    expect(sleep.mock.calls.every((c) => c[0] === 5000)).toBe(true);
    expect(await indexing.reindexAll({ batchSize: 2, pauseMs: 0, sleep }, deps())).toEqual({ articles: 0, tickets: 0 });
  });

  it("falha de cota no meio preserva o que já foi gravado e propaga o erro", async () => {
    for (let i = 0; i < 4; i++) await article(`Artigo ${i}`, `Texto ${i}`);
    let n = 0;
    const flaky: EmbeddingProvider = {
      name: "fake",
      embed: async (texts, o) => {
        if (++n > 2) throw new AiError("429 cota", true);
        return new FakeEmbeddingProvider().embed(texts, o);
      },
    };
    await expect(indexing.reindexAll({ batchSize: 2, pauseMs: 0, sleep: async () => {} }, deps({ provider: flaky }))).rejects.toMatchObject({ retryable: true });
    const done = Number((await db.$queryRaw<{ n: bigint }[]>`SELECT count(DISTINCT "articleId") AS n FROM "KbChunk"`)[0].n);
    expect(done).toBe(2);
    const resumed = await indexing.reindexAll({ batchSize: 2, pauseMs: 0, sleep: async () => {} }, deps());
    expect(resumed.articles).toBe(2);
  });
});
