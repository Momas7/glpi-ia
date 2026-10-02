import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let svc: typeof import("@/modules/tickets");
let reqA: SessionUser, reqB: SessionUser, agent1: SessionUser, agent2: SessionUser, lead1: SessionUser, admin: SessionUser;
let t1: string, t2: string;

const toSession = (u: { id: string; name: string; email: string; role: SessionUser["role"] }, teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role: u.role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  svc = await import("@/modules/tickets");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.user.deleteMany();
  await db.category.deleteMany();
  await db.team.deleteMany();
  const mk = (name: string, role: SessionUser["role"]) =>
    db.user.create({ data: { name, email: `${name.toLowerCase()}@x.com`, role } });
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  t2 = (await db.team.create({ data: { name: "T2" } })).id;
  reqA = toSession(await mk("ReqA", "REQUESTER"));
  reqB = toSession(await mk("ReqB", "REQUESTER"));
  agent1 = toSession(await mk("Agent1", "AGENT"), [t1]);
  agent2 = toSession(await mk("Agent2", "AGENT"), [t2]);
  lead1 = toSession(await mk("Lead1", "TEAM_LEAD"), [t1]);
  admin = toSession(await mk("Admin", "ADMIN"));
});

const create = (actor: SessionUser, title = "Chamado", extra: object = {}) =>
  svc.createTicket(actor, { title, description: "descrição", ...extra });

// Solicitante não escolhe a equipe ao criar; a triagem (humana ou IA) atribui depois.
const createInT1 = async (title = "Chamado") => {
  const t = await create(reqA, title);
  return db.ticket.update({ where: { id: t.id }, data: { teamId: t1 } });
};

describe("criação", () => {
  it("gera números consecutivos e registra o evento CREATED", async () => {
    const a = await create(reqA);
    const b = await create(reqA);
    expect(b.number).toBe(a.number + 1);
    expect(a.status).toBe("NEW");
    expect(a.requesterId).toBe(reqA.id);
    const events = await db.ticketEvent.findMany({ where: { ticketId: a.id } });
    expect(events.map((e) => e.type)).toEqual(["CREATED"]);
  });

  it("20 criações simultâneas geram 20 números distintos", async () => {
    const all = await Promise.all(Array.from({ length: 20 }, (_, i) => create(reqA, `c${i}`)));
    expect(new Set(all.map((t) => t.number)).size).toBe(20);
  });

  it("ignora o teamId informado por solicitante, mas respeita o de agentes", async () => {
    expect((await create(reqA, "a", { teamId: t1 })).teamId).toBeNull();
    expect((await create(agent1, "b", { teamId: t1 })).teamId).toBe(t1);
  });

  it("aplica a equipe padrão da categoria", async () => {
    const cat = await db.category.create({ data: { name: "Rede", defaultTeamId: t1 } });
    const t = await create(reqA, "Sem internet", { categoryId: cat.id });
    expect(t.teamId).toBe(t1);
  });

  it("desfaz o chamado se um hook de criação falhar (mesma transação)", async () => {
    const off = svc.registerTicketCreatedHook(async () => {
      throw new Error("falha no hook");
    });
    await expect(create(reqA, "não deve persistir")).rejects.toThrow("falha no hook");
    off();
    expect(await db.ticket.count()).toBe(0);
  });
});

describe("status", () => {
  it("rejeita transição inválida (NEW→CLOSED)", async () => {
    const t = await createInT1("x");
    await expect(svc.changeStatus(agent1, t.id, "CLOSED")).rejects.toThrow(/transição/i);
  });

  it("segue NEW→OPEN→RESOLVED→CLOSED, preenchendo resolvedAt/closedAt, e limpa resolvedAt ao reabrir", async () => {
    const t = await createInT1("x");
    await svc.changeStatus(agent1, t.id, "OPEN");
    const resolved = await svc.changeStatus(agent1, t.id, "RESOLVED");
    expect(resolved.resolvedAt).not.toBeNull();
    const reopened = await svc.changeStatus(agent1, t.id, "OPEN");
    expect(reopened.resolvedAt).toBeNull();
    await svc.changeStatus(agent1, t.id, "RESOLVED");
    const closed = await svc.changeStatus(agent1, t.id, "CLOSED");
    expect(closed.closedAt).not.toBeNull();
    const types = (await db.ticketEvent.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" } })).map((e) => e.type);
    expect(types.filter((x) => x === "STATUS_CHANGED")).toHaveLength(5);
  });

  it("solicitante não muda status", async () => {
    const t = await create(reqA);
    await expect(svc.changeStatus(reqA, t.id, "OPEN")).rejects.toThrow();
  });
});

describe("concorrência de status", () => {
  it("duas mudanças simultâneas a partir de RESOLVED: uma vence, a outra recebe 409, e o estado final é válido", async () => {
    const t = await createInT1("corrida");
    await svc.changeStatus(agent1, t.id, "OPEN");
    await svc.changeStatus(agent1, t.id, "RESOLVED");
    const results = await Promise.allSettled([
      svc.changeStatus(agent1, t.id, "CLOSED"),
      svc.changeStatus(agent1, t.id, "OPEN"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 409 });
    const final = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(["CLOSED", "OPEN"]).toContain(final.status);
    expect(final.status === "OPEN" ? final.closedAt : final.resolvedAt).not.toBeUndefined();
    if (final.status === "OPEN") expect(final.closedAt).toBeNull();
  });
});

describe("equipe de entrada padrão", () => {
  it("chamado sem categoria nem equipe vai para a equipe de entrada (Suporte N1), ficando visível aos técnicos dela", async () => {
    const intake = await db.team.create({ data: { name: "Suporte N1" } });
    const intakeAgent = toSession(await db.user.create({ data: { name: "N1", email: "n1@x.com", role: "AGENT" } }), [intake.id]);
    const t = await create(reqA, "sem categoria");
    expect(t.teamId).toBe(intake.id);
    expect(await svc.getTicket(intakeAgent, t.id)).not.toBeNull();
  });

  it("não sobrescreve a equipe vinda da categoria", async () => {
    await db.team.create({ data: { name: "Suporte N1" } });
    const cat = await db.category.create({ data: { name: "Rede", defaultTeamId: t1 } });
    expect((await create(reqA, "com categoria", { categoryId: cat.id })).teamId).toBe(t1);
  });
});

describe("visibilidade e permissões", () => {
  it("solicitante não vê chamado alheio em getTicket nem em listTickets", async () => {
    const t = await create(reqA, "da A");
    expect(await svc.getTicket(reqB, t.id)).toBeNull();
    expect((await svc.listTickets(reqB, { page: 1, pageSize: 20 })).items).toHaveLength(0);
    expect(await svc.getTicket(reqA, t.id)).not.toBeNull();
  });

  it("agente de outra equipe não vê; da equipe vê; admin vê tudo", async () => {
    const t = await createInT1("da equipe 1");
    expect(await svc.getTicket(agent2, t.id)).toBeNull();
    expect(await svc.getTicket(agent1, t.id)).not.toBeNull();
    expect(await svc.getTicket(admin, t.id)).not.toBeNull();
  });

  it("updateTicket: agente edita; solicitante é negado; outra equipe recebe 'não encontrado'", async () => {
    const t = await createInT1("x");
    const up = await svc.updateTicket(agent1, t.id, { priority: "HIGH" });
    expect(up.priority).toBe("HIGH");
    await expect(svc.updateTicket(reqA, t.id, { priority: "LOW" })).rejects.toThrow();
    await expect(svc.updateTicket(agent2, t.id, { priority: "LOW" })).rejects.toThrow(/não encontrado/i);
    const ev = await db.ticketEvent.findFirstOrThrow({ where: { ticketId: t.id, type: "UPDATED" } });
    expect(ev.data).toMatchObject({ before: { priority: "MEDIUM" }, after: { priority: "HIGH" } });
  });

  it("atribuir: agente é negado, líder da equipe consegue", async () => {
    const t = await createInT1("x");
    await expect(svc.updateTicket(agent1, t.id, { assigneeId: agent1.id })).rejects.toThrow();
    const up = await svc.updateTicket(lead1, t.id, { assigneeId: agent1.id });
    expect(up.assigneeId).toBe(agent1.id);
  });
});

describe("listagem", () => {
  it("página fora do intervalo devolve vazio com o total correto; pageSize é limitado a 100", async () => {
    await create(reqA, "a");
    await create(reqA, "b");
    const far = await svc.listTickets(reqA, { page: 9999, pageSize: 20 });
    expect(far.items).toEqual([]);
    expect(far.total).toBe(2);
    const big = await svc.listTickets(reqA, { page: 1, pageSize: 100000 });
    expect(big.pageSize).toBe(100);
    expect(big.items).toHaveLength(2);
  });

  it("filtra por status", async () => {
    const t = await createInT1("a");
    await createInT1("b");
    await svc.changeStatus(agent1, t.id, "OPEN");
    const open = await svc.listTickets(agent1, { page: 1, pageSize: 20, status: "OPEN" });
    expect(open.items.map((i) => i.title)).toEqual(["a"]);
  });

  it("busca q trata %, _ e ' como texto literal e não retorna tudo", async () => {
    for (const title of ["Impressora 100% quebrada", "Rede lenta", "Item_com_underscore", "Erro do O'Brien", "Outro assunto"]) {
      await create(reqA, title);
    }
    const titles = async (q: string) => (await svc.listTickets(reqA, { page: 1, pageSize: 50, q })).items.map((i) => i.title);
    expect(await titles("%")).toEqual(["Impressora 100% quebrada"]);
    expect(await titles("_")).toEqual(["Item_com_underscore"]);
    expect(await titles("'")).toEqual(["Erro do O'Brien"]);
    expect(await titles("' OR 1=1 --")).toEqual([]);
    expect(await titles("impressora")).toEqual(["Impressora 100% quebrada"]);
  });
});
