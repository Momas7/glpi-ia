import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { FakeEmbeddingProvider } from "@/modules/ai/embedding/fake";
import type { EmbedDeps } from "@/modules/ai/embedding/run";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let indexing: typeof import("@/modules/ai/indexing");
let search: typeof import("@/modules/ai/search");
let t1: string, t2: string;
let lead: { id: string }, requesterRow: { id: string };
let agent: SessionUser, outsider: SessionUser, admin: SessionUser, requester: SessionUser;

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"], teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  indexing = await import("@/modules/ai/indexing");
  search = await import("@/modules/ai/search");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`DELETE FROM "TicketEmbedding"`);
  await db.$executeRawUnsafe(`DELETE FROM "KbChunk"`);
  await db.kbArticle.deleteMany();
  await db.ticketRating.deleteMany();
  await db.comment.deleteMany();
  await db.ticket.deleteMany();
  await db.aiAuditLog.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  t2 = (await db.team.create({ data: { name: "T2" } })).id;
  const mk = (name: string, role: SessionUser["role"], teams: string[] = []) =>
    db.user.create({ data: { name, email: `${name}@x.com`, role, teams: { create: teams.map((teamId) => ({ teamId })) } } });
  lead = await mk("lead", "TEAM_LEAD", [t1]);
  requesterRow = await mk("requester", "REQUESTER");
  agent = session(await mk("agent", "AGENT", [t1]), "AGENT", [t1]);
  outsider = session(await mk("outsider", "AGENT", [t2]), "AGENT", [t2]);
  admin = session(await mk("admin", "ADMIN"), "ADMIN");
  requester = session(requesterRow as never as { id: string; name: string; email: string }, "REQUESTER");
});

const deps = (over: Partial<EmbedDeps> = {}): Partial<EmbedDeps> => ({
  db,
  provider: new FakeEmbeddingProvider(),
  enabled: true,
  dailyBudgetUsd: 5,
  timezone: "America/Sao_Paulo",
  model: "gemini-embedding-001",
  sleep: async () => {},
  now: () => new Date(),
  ...over,
});

const WIFI = "Wi-Fi do segundo andar sem conexão";
const QUESTION = "O Wi-Fi do segundo andar caiu e está sem conexão";

async function article(title: string, body: string, published = true) {
  const a = await db.kbArticle.create({ data: { title, body, published, createdById: lead.id, updatedById: lead.id } });
  await indexing.indexArticle(a.id, deps());
  return a;
}

async function resolvedTicket(title: string, teamId: string, over: Record<string, unknown> = {}) {
  const t = await db.ticket.create({
    data: {
      title, description: "A conexão do andar caiu várias vezes.", requesterId: requesterRow.id, teamId,
      status: "RESOLVED", resolvedAt: new Date(), resolution: "Reiniciei o ponto de acesso do andar e conferi o cabo.", ...over,
    },
  });
  await indexing.indexTicket(t.id, deps());
  return t;
}

const ids = (sources: { id: string }[]) => sources.map((s) => s.id);
const ask = (actor: SessionUser, ticketId = "novo", opts: { k?: number; minSimilarity?: number } = { minSimilarity: 0.05 }, d = deps()) =>
  search.searchKnowledge(actor, { ticketId, text: QUESTION }, opts, d);

describe("searchKnowledge", () => {
  it("a fonte mais parecida vem primeiro e o resultado traz tipo, título, trecho e similaridade", async () => {
    const wifi = await article(WIFI, "Reinicie o ponto de acesso do andar e confira o cabo de rede.");
    const other = await article("Orçamento anual do financeiro", "Planilha de custos e previsão de compras do ano.");
    const out = await ask(agent);
    expect(ids(out)[0]).toBe(wifi.id);
    expect(out[0]).toMatchObject({ kind: "article", title: WIFI });
    expect(out[0].similarity).toBeGreaterThan(0.2);
    expect(out[0].excerpt).toContain("ponto de acesso");
    if (out.length > 1) expect(out[0].similarity).toBeGreaterThan(out[1].similarity);
    void other;
  });

  it("fontes abaixo do limiar não aparecem", async () => {
    await article(WIFI, "Reinicie o ponto de acesso do andar.");
    expect(await ask(agent, "novo", { minSimilarity: 0.999 })).toEqual([]);
  });

  it("artigo em rascunho e artigo despublicado depois de indexado não aparecem", async () => {
    const draft = await article(WIFI + " rascunho", "Reinicie o ponto de acesso do andar.", false);
    const gone = await article(WIFI, "Reinicie o ponto de acesso do andar.");
    expect(ids(await ask(agent))).toContain(gone.id);
    await db.kbArticle.update({ where: { id: gone.id }, data: { published: false } }); // chunks continuam no banco
    const out = ids(await ask(agent));
    expect(out).not.toContain(gone.id);
    expect(out).not.toContain(draft.id);
  });

  it("chamado resolvido da própria equipe aparece com número, título e a solução; de outra equipe não", async () => {
    const mine = await resolvedTicket("Wi-Fi do andar caiu", t1);
    const theirs = await resolvedTicket("Wi-Fi do andar caiu também", t2);
    const out = await ask(agent);
    expect(ids(out)).toContain(mine.id);
    expect(ids(out)).not.toContain(theirs.id);
    const hit = out.find((s) => s.id === mine.id)!;
    expect(hit).toMatchObject({ kind: "ticket", number: mine.number, title: "Wi-Fi do andar caiu" });
    expect(hit.excerpt).toContain("Reiniciei o ponto de acesso");
  });

  it("ADMIN vê chamados de qualquer equipe; técnico de outra equipe só os dela", async () => {
    const a = await resolvedTicket("Wi-Fi A", t1);
    const b = await resolvedTicket("Wi-Fi B", t2);
    expect(ids(await ask(admin)).sort()).toEqual([a.id, b.id].sort());
    expect(ids(await ask(outsider))).toEqual([b.id]);
  });

  it("chamado onde o ator é responsável ou solicitante aparece mesmo de outra equipe", async () => {
    const foreign = await resolvedTicket("Wi-Fi externo", t2, { assigneeId: agent.id });
    expect(ids(await ask(agent))).toContain(foreign.id);
  });

  it("o próprio chamado nunca é fonte dele mesmo", async () => {
    const self = await resolvedTicket("Wi-Fi do andar caiu", t1);
    const other = await resolvedTicket("Wi-Fi do andar caiu de novo", t1);
    const out = ids(await ask(agent, self.id));
    expect(out).not.toContain(self.id);
    expect(out).toContain(other.id);
  });

  it("nota 2 (dada depois de indexado) tira o chamado; nota 4 mantém", async () => {
    const bad = await resolvedTicket("Wi-Fi ruim", t1);
    const good = await resolvedTicket("Wi-Fi bom", t1);
    await db.ticketRating.create({ data: { ticketId: bad.id, raterId: requesterRow.id, stars: 2 } });
    await db.ticketRating.create({ data: { ticketId: good.id, raterId: requesterRow.id, stars: 4 } });
    const out = ids(await ask(agent));
    expect(out).not.toContain(bad.id);
    expect(out).toContain(good.id);
  });

  it("chamado reaberto (ainda com vetor no banco) não aparece", async () => {
    const t = await resolvedTicket("Wi-Fi reaberto", t1);
    await db.ticket.update({ where: { id: t.id }, data: { status: "OPEN", resolvedAt: null } });
    expect(ids(await ask(agent))).not.toContain(t.id);
  });

  it("nota interna nunca vai para o trecho da fonte", async () => {
    const t = await resolvedTicket("Wi-Fi com nota", t1);
    await db.comment.create({ data: { ticketId: t.id, authorId: lead.id, body: "SEGREDO INTERNO", internal: true } });
    const hit = (await ask(agent)).find((s) => s.id === t.id)!;
    expect(hit.excerpt).not.toContain("SEGREDO");
  });

  it("chamado antigo sem solução mostra o último comentário público do técnico como trecho", async () => {
    const t = await resolvedTicket("Wi-Fi antigo", t1, { resolution: null });
    await db.comment.create({ data: { ticketId: t.id, authorId: lead.id, body: "Reiniciei o ponto de acesso do andar.", internal: false, createdAt: new Date(Date.now() - 1000) } });
    await indexing.indexTicket(t.id, deps());
    const hit = (await ask(agent)).find((s) => s.id === t.id)!;
    expect(hit.excerpt).toContain("Reiniciei o ponto de acesso");
  });

  it("no máximo 2 trechos por artigo e no máximo k fontes", async () => {
    const long = await article(WIFI, Array.from({ length: 40 }, (_, i) => `Passo ${i}: confira o Wi-Fi do andar e a conexão do ponto de acesso.`).join(" "));
    for (let i = 0; i < 5; i++) await resolvedTicket(`Wi-Fi caso ${i}`, t1);
    const out = await ask(agent, "novo", { k: 4, minSimilarity: 0.01 });
    expect(out.length).toBeLessThanOrEqual(4);
    expect(out.filter((s) => s.id === long.id).length).toBeLessThanOrEqual(2);
  });

  it("solicitante não pesquisa (403) e IA desligada devolve lista vazia", async () => {
    await expect(ask(requester)).rejects.toMatchObject({ status: 403 });
    await article(WIFI, "Reinicie o ponto de acesso do andar.");
    expect(await ask(agent, "novo", { minSimilarity: 0.05 }, deps({ enabled: false }))).toEqual([]);
  });

  it("a pergunta é mascarada antes de sair e auditada como 'search'", async () => {
    await article(WIFI, "Reinicie o ponto de acesso do andar.");
    await search.searchKnowledge(agent, { ticketId: "novo", text: "meu CPF 123.456.789-09 e o Wi-Fi do andar" }, { minSimilarity: 0.01 }, deps());
    const log = await db.aiAuditLog.findFirstOrThrow({ where: { jobType: "search" } });
    expect(log.maskedInput).toContain("[CPF_1]");
    expect(log.maskedInput).not.toContain("123.456.789-09");
  });

  it("filtro por permissão não esconde fontes visíveis atrás de muitas fontes de outra equipe", async () => {
    for (let i = 0; i < 60; i++) await resolvedTicket(`Wi-Fi do andar caiu da outra equipe ${i}`, t2);
    const mine = await resolvedTicket("Wi-Fi do andar", t1);
    expect(ids(await ask(agent))).toContain(mine.id);
  });
});
