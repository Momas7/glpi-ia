import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let tickets: typeof import("@/modules/tickets");
let ai: typeof import("@/modules/ai");
let requester: SessionUser, agent: SessionUser, outsider: SessionUser;
let teamInfra: string, teamN1: string, teamOther: string, catRede: string;

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"], teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, AI_ENABLED: "false" });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  tickets = await import("@/modules/tickets");
  ai = await import("@/modules/ai");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.aiSuggestion.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.user.deleteMany();
  await db.category.deleteMany();
  await db.team.deleteMany();
  teamInfra = (await db.team.create({ data: { name: "Infraestrutura" } })).id;
  teamN1 = (await db.team.create({ data: { name: "Suporte N1" } })).id;
  teamOther = (await db.team.create({ data: { name: "Outra" } })).id;
  catRede = (await db.category.create({ data: { name: "Rede", defaultTeamId: teamInfra } })).id;
  const mk = (name: string, role: SessionUser["role"]) => db.user.create({ data: { name, email: `${name}@x.com`, role } });
  requester = session(await mk("req", "REQUESTER"), "REQUESTER");
  agent = session(await mk("agent", "AGENT"), "AGENT", [teamN1]);
  outsider = session(await mk("outsider", "AGENT"), "AGENT", [teamOther]);
});

async function withSuggestion() {
  const t = await tickets.createTicket(requester, { title: "Wi-Fi", description: "caiu" });
  await db.aiSuggestion.create({
    data: {
      ticketId: t.id, kind: "TRIAGE", confidence: 0.9,
      payload: { categoryId: catRede, priority: "HIGH", teamId: teamInfra, basis: { categoryId: null, priority: "MEDIUM", teamId: teamN1 } },
    },
  });
  return (await tickets.getTicket(agent, t.id))!;
}

describe("leitura da sugestão", () => {
  it("o técnico da equipe vê a sugestão com nomes e opções", async () => {
    const t = await withSuggestion();
    const s = await ai.getPendingTriage(agent, t);
    expect(s).toMatchObject({ categoryName: "Rede", teamName: "Infraestrutura", priority: "HIGH", confidence: 0.9 });
    expect(s!.options.categories.map((c) => c.name)).toEqual(["Rede"]);
    expect(s!.options.teams.map((x) => x.name).sort()).toEqual(["Infraestrutura", "Outra", "Suporte N1"]);
  });

  it("solicitante e técnico de outra equipe não veem", async () => {
    const t = await withSuggestion();
    expect(await ai.getPendingTriage(requester, t)).toBeNull();
    expect(await ai.getPendingTriage(outsider, t)).toBeNull();
  });

  it("depois de decidida a sugestão some", async () => {
    const t = await withSuggestion();
    await ai.decideSuggestion(agent, t.id, { action: "reject" });
    expect(await ai.getPendingTriage(agent, t)).toBeNull();
  });

  it("sugestão obsoleta (chamado mudou ou foi resolvido) deixa de aparecer no cartão e no selo", async () => {
    const t = await withSuggestion();
    await db.ticket.update({ where: { id: t.id }, data: { priority: "LOW" } });
    const changed = (await tickets.getTicket(agent, t.id))!;
    expect(await ai.getPendingTriage(agent, changed)).toBeNull();
    expect((await ai.pendingTriageTicketIds(agent, [changed])).size).toBe(0);
  });

  it("expõe a categoria e a equipe atuais do chamado para o cartão", async () => {
    const t = await withSuggestion();
    const s = await ai.getPendingTriage(agent, t);
    expect(s!.current).toEqual({ categoryId: null, teamId: teamN1 });
  });

  it("pendingTriageTicketIds devolve só os chamados pendentes e decidíveis", async () => {
    const a = await withSuggestion();
    const b = await tickets.createTicket(requester, { title: "Sem sugestão", description: "x" });
    const bFull = (await tickets.getTicket(agent, b.id))!;
    expect([...(await ai.pendingTriageTicketIds(agent, [a, bFull]))]).toEqual([a.id]);
    expect((await ai.pendingTriageTicketIds(requester, [a, bFull])).size).toBe(0);
  });
});

describe("getDraftView", () => {
  const config = (over: Record<string, unknown> = {}) =>
    ({ AI_ENABLED: true, LLM_PROVIDER: "fake", EMBEDDING_PROVIDER: "fake", ...over }) as never;

  async function withDraft() {
    const t = await withSuggestion();
    await db.comment.create({
      data: {
        ticketId: t.id, authorId: agent.id, body: "Reinicie o ponto [1].", internal: true, source: "AI_DRAFT",
        sources: [{ kind: "article", id: "a1", title: "Wi-Fi sem conexão" }],
      },
    });
    return t;
  }

  it("o técnico da equipe recebe o rascunho sem as marcas de citação e com as fontes", async () => {
    const t = await withDraft();
    const view = await ai.getDraftView(agent, t, config());
    expect(view.available).toBe(true);
    expect(view.draft).toMatchObject({ text: "Reinicie o ponto.", sources: [{ kind: "article", id: "a1", title: "Wi-Fi sem conexão" }] });
  });

  it("sem rascunho devolve draft nulo, mas disponível", async () => {
    const t = await withSuggestion();
    expect(await ai.getDraftView(agent, t, config())).toEqual({ available: true, draft: null });
  });

  it("solicitante e técnico de outra equipe não têm nada", async () => {
    const t = await withDraft();
    expect(await ai.getDraftView(requester, t, config())).toEqual({ available: false, draft: null });
    expect(await ai.getDraftView(outsider, t, config())).toEqual({ available: false, draft: null });
  });

  it("IA desligada ou provider sem chave: indisponível", async () => {
    const t = await withDraft();
    expect((await ai.getDraftView(agent, t, config({ AI_ENABLED: false }))).available).toBe(false);
    expect((await ai.getDraftView(agent, t, config({ LLM_PROVIDER: "gemini" }))).available).toBe(false);
    expect((await ai.getDraftView(agent, t, config({ EMBEDDING_PROVIDER: "gemini" }))).available).toBe(false);
  });
});
