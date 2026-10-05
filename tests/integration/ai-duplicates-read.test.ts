import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let ai: typeof import("@/modules/ai");
let tickets: typeof import("@/modules/tickets");
let t1: string, t2: string;
let requesterRow: { id: string };
let agent: SessionUser, outsider: SessionUser, requester: SessionUser;

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"], teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, AI_ENABLED: "false" });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  ai = await import("@/modules/ai");
  tickets = await import("@/modules/tickets");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.aiSuggestion.deleteMany();
  await db.ticket.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  t2 = (await db.team.create({ data: { name: "T2" } })).id;
  const mk = (name: string, role: SessionUser["role"], teams: string[] = []) =>
    db.user.create({ data: { name, email: `${name}@x.com`, role, teams: { create: teams.map((teamId) => ({ teamId })) } } });
  requesterRow = await mk("requester", "REQUESTER");
  requester = session(requesterRow as never, "REQUESTER");
  agent = session(await mk("agent", "AGENT", [t1]), "AGENT", [t1]);
  outsider = session(await mk("outsider", "AGENT", [t2]), "AGENT", [t2]);
});

const open = (title: string, over: Record<string, unknown> = {}) =>
  db.ticket.create({ data: { title, description: "d", requesterId: requesterRow.id, teamId: t1, status: "OPEN", ...over } });

async function withDuplicates() {
  const a = await open("Internet caiu no prédio");
  const b = await open("Sem rede no andar", { teamId: t2 }); // candidato que o técnico da T1 não abre
  const mine = await open("Sem internet");
  await db.aiSuggestion.create({
    data: {
      ticketId: mine.id, kind: "DUPLICATE", confidence: 0.93,
      payload: {
        candidates: [
          { ticketId: a.id, number: a.number, title: a.title, similarity: 0.93 },
          { ticketId: b.id, number: b.number, title: b.title, similarity: 0.88 },
        ],
      },
    },
  });
  return { a, b, mine: (await tickets.getTicket(agent, mine.id))! };
}

describe("getDuplicatesView", () => {
  it("o técnico da equipe vê os candidatos e só abre os que tem acesso", async () => {
    const { a, b, mine } = await withDuplicates();
    const view = await ai.getDuplicatesView(agent, mine);
    expect(view!.candidates.map((c) => c.id)).toEqual([a.id, b.id]);
    expect(view!.candidates.map((c) => c.canOpen)).toEqual([true, false]);
    expect(view!.candidates[0]).toMatchObject({ number: a.number, status: "OPEN", similarity: 0.93 });
  });

  it("solicitante e técnico de outra equipe não veem", async () => {
    const { mine } = await withDuplicates();
    expect(await ai.getDuplicatesView(requester, mine)).toBeNull();
    expect(await ai.getDuplicatesView(outsider, mine)).toBeNull();
  });

  it("candidato que já foi encerrado ou apagado sai da lista; lista vazia vira null", async () => {
    const { a, b, mine } = await withDuplicates();
    await db.ticket.update({ where: { id: a.id }, data: { status: "RESOLVED" } });
    expect((await ai.getDuplicatesView(agent, mine))!.candidates.map((c) => c.id)).toEqual([b.id]);
    await db.ticket.delete({ where: { id: b.id } });
    expect(await ai.getDuplicatesView(agent, mine)).toBeNull();
  });
});

describe("dismissDuplicates", () => {
  it("marca como ignorada e some do cartão e do selo", async () => {
    const { mine } = await withDuplicates();
    expect((await ai.duplicateTicketIds(agent, [mine])).has(mine.id)).toBe(true);
    await ai.dismissDuplicates(agent, mine.id);
    const s = await db.aiSuggestion.findFirstOrThrow({ where: { ticketId: mine.id, kind: "DUPLICATE" } });
    expect(s).toMatchObject({ status: "REJECTED", decidedById: agent.id });
    expect(await ai.getDuplicatesView(agent, mine)).toBeNull();
    expect((await ai.duplicateTicketIds(agent, [mine])).size).toBe(0);
  });

  it("ignorar duas vezes dá 409; quem não pode atender recebe 404", async () => {
    const { mine } = await withDuplicates();
    await expect(ai.dismissDuplicates(outsider, mine.id)).rejects.toMatchObject({ status: 404 });
    await expect(ai.dismissDuplicates(requester, mine.id)).rejects.toMatchObject({ status: 404 });
    await ai.dismissDuplicates(agent, mine.id);
    await expect(ai.dismissDuplicates(agent, mine.id)).rejects.toMatchObject({ status: 409 });
  });

  it("chamado sem sugestão de duplicado: 404", async () => {
    const t = await open("Outro");
    await expect(ai.dismissDuplicates(agent, t.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("duplicateTicketIds", () => {
  it("devolve só os chamados com sugestão pendente que o usuário pode decidir", async () => {
    const { mine } = await withDuplicates();
    const other = (await tickets.getTicket(agent, (await open("Sem sugestão")).id))!;
    expect([...(await ai.duplicateTicketIds(agent, [mine, other]))]).toEqual([mine.id]);
    expect((await ai.duplicateTicketIds(requester, [mine])).size).toBe(0);
  });
});
