import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let tickets: typeof import("@/modules/tickets");
let ai: typeof import("@/modules/ai");
let requester: SessionUser, agent: SessionUser, outsider: SessionUser, admin: SessionUser;
let teamInfra: string, teamN1: string, teamOther: string, catRede: string, catAcessos: string;

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
  catAcessos = (await db.category.create({ data: { name: "Acessos", defaultTeamId: teamN1 } })).id;
  const mk = (name: string, role: SessionUser["role"]) => db.user.create({ data: { name, email: `${name}@x.com`, role } });
  requester = session(await mk("req", "REQUESTER"), "REQUESTER");
  agent = session(await mk("agent", "AGENT"), "AGENT", [teamN1]);
  outsider = session(await mk("outsider", "AGENT"), "AGENT", [teamOther]);
  admin = session(await mk("admin", "ADMIN"), "ADMIN");
});

async function ticketWithSuggestion(payload?: Partial<{ categoryId: string | null; priority: string; teamId: string | null }>) {
  const t = await tickets.createTicket(requester, { title: "Wi-Fi caiu", description: "sem rede" });
  const basis = { categoryId: t.categoryId, priority: t.priority, teamId: t.teamId };
  await db.ticket.update({ where: { id: t.id }, data: { assigneeId: agent.id } });
  await db.aiSuggestion.create({
    data: {
      ticketId: t.id,
      kind: "TRIAGE",
      confidence: 0.9,
      payload: { categoryId: catRede, priority: "HIGH", teamId: teamInfra, ...payload, basis },
    },
  });
  return t;
}

const suggestion = (ticketId: string) => db.aiSuggestion.findFirstOrThrow({ where: { ticketId } });
const freshTicket = (id: string) => db.ticket.findUniqueOrThrow({ where: { id } });

describe("aceitar", () => {
  it("aplica categoria, prioridade e equipe, limpa o responsável e audita; status não muda", async () => {
    const t = await ticketWithSuggestion();
    const { ticket } = await ai.decideSuggestion(agent, t.id, { action: "accept" });
    expect(ticket).toMatchObject({ categoryId: catRede, priority: "HIGH", teamId: teamInfra, assigneeId: null, status: "NEW" });
    expect((await freshTicket(t.id)).status).toBe("NEW");

    const types = (await db.ticketEvent.findMany({ where: { ticketId: t.id } })).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["UPDATED", "ASSIGNED"]));
    const s = await suggestion(t.id);
    expect(s).toMatchObject({ status: "ACCEPTED", decidedById: agent.id });
    expect(s.decidedAt).toBeInstanceOf(Date);
    const log = await db.auditLog.findFirstOrThrow({ where: { targetId: t.id } });
    expect(log).toMatchObject({ action: "ai.suggestion_accept", targetType: "ticket", actorId: agent.id });
  });

  it("campos nulos na sugestão mantêm o que o chamado já tem", async () => {
    const t = await ticketWithSuggestion({ categoryId: null, teamId: null, priority: "LOW" });
    const { ticket } = await ai.decideSuggestion(agent, t.id, { action: "accept" });
    expect(ticket).toMatchObject({ categoryId: null, priority: "LOW", teamId: teamN1 });
  });
});

describe("editar e rejeitar", () => {
  it("editar aplica os campos informados e marca EDITED", async () => {
    const t = await ticketWithSuggestion();
    const { ticket } = await ai.decideSuggestion(agent, t.id, {
      action: "edit",
      fields: { categoryId: catAcessos, priority: "CRITICAL", teamId: teamN1 },
    });
    expect(ticket).toMatchObject({ categoryId: catAcessos, priority: "CRITICAL", teamId: teamN1, assigneeId: agent.id });
    expect((await suggestion(t.id)).status).toBe("EDITED");
    expect(await db.auditLog.count({ where: { action: "ai.suggestion_edit" } })).toBe(1);
  });

  it("rejeitar não altera o chamado", async () => {
    const t = await ticketWithSuggestion();
    const before = await freshTicket(t.id);
    await ai.decideSuggestion(agent, t.id, { action: "reject" });
    const after = await freshTicket(t.id);
    expect(after).toMatchObject({ categoryId: before.categoryId, priority: before.priority, teamId: before.teamId, status: before.status });
    expect((await suggestion(t.id)).status).toBe("REJECTED");
    expect(await db.auditLog.count({ where: { action: "ai.suggestion_reject" } })).toBe(1);
  });

  it("editar com categoria inexistente: 400 e a sugestão continua pendente", async () => {
    const t = await ticketWithSuggestion();
    await expect(
      ai.decideSuggestion(agent, t.id, { action: "edit", fields: { categoryId: "nao-existe", priority: "LOW", teamId: null } }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await suggestion(t.id)).status).toBe("PENDING");
    expect(await db.auditLog.count()).toBe(0);
  });

  it("editar com equipe inexistente: 400 e nada é gravado", async () => {
    const t = await ticketWithSuggestion();
    await expect(
      ai.decideSuggestion(agent, t.id, { action: "edit", fields: { categoryId: null, priority: "LOW", teamId: "nao-existe" } }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await freshTicket(t.id)).priority).toBe("MEDIUM");
    expect((await suggestion(t.id)).status).toBe("PENDING");
  });
});

describe("autorização", () => {
  it("técnico de outra equipe e solicitante recebem 404", async () => {
    const t = await ticketWithSuggestion();
    for (const who of [outsider, requester]) {
      await expect(ai.decideSuggestion(who, t.id, { action: "accept" })).rejects.toMatchObject({ status: 404 });
    }
    expect((await suggestion(t.id)).status).toBe("PENDING");
  });

  it("admin pode decidir", async () => {
    const t = await ticketWithSuggestion();
    await expect(ai.decideSuggestion(admin, t.id, { action: "reject" })).resolves.toBeDefined();
  });
});

describe("estado", () => {
  it("segunda decisão recebe 409", async () => {
    const t = await ticketWithSuggestion();
    await ai.decideSuggestion(agent, t.id, { action: "reject" });
    await expect(ai.decideSuggestion(agent, t.id, { action: "accept" })).rejects.toMatchObject({ status: 409 });
  });

  it("chamado alterado depois da sugestão: 409 e a sugestão continua pendente", async () => {
    const t = await ticketWithSuggestion();
    await db.ticket.update({ where: { id: t.id }, data: { priority: "LOW" } });
    await expect(ai.decideSuggestion(agent, t.id, { action: "accept" })).rejects.toMatchObject({ status: 409 });
    expect((await suggestion(t.id)).status).toBe("PENDING");
    expect((await freshTicket(t.id)).teamId).toBe(teamN1);
  });

  it("rejeitar funciona mesmo com a sugestão obsoleta (não toca no chamado)", async () => {
    const t = await ticketWithSuggestion();
    await db.ticket.update({ where: { id: t.id }, data: { priority: "LOW" } });
    await ai.decideSuggestion(agent, t.id, { action: "reject" });
    expect((await suggestion(t.id)).status).toBe("REJECTED");
  });

  it("chamado já resolvido: 409", async () => {
    const t = await ticketWithSuggestion();
    await db.ticket.update({ where: { id: t.id }, data: { status: "RESOLVED" } });
    await expect(ai.decideSuggestion(agent, t.id, { action: "accept" })).rejects.toMatchObject({ status: 409 });
  });

  it("chamado sem sugestão: 404", async () => {
    const t = await tickets.createTicket(requester, { title: "Sem sugestão", description: "x" });
    await db.ticket.update({ where: { id: t.id }, data: { assigneeId: agent.id } });
    await expect(ai.decideSuggestion(agent, t.id, { action: "accept" })).rejects.toMatchObject({ status: 404 });
  });

  it("duas decisões simultâneas: uma vence, a outra recebe 409 e há um único evento ASSIGNED", async () => {
    const t = await ticketWithSuggestion();
    const results = await Promise.allSettled([
      ai.decideSuggestion(agent, t.id, { action: "accept" }),
      ai.decideSuggestion(admin, t.id, { action: "accept" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 409 });
    expect(await db.ticketEvent.count({ where: { ticketId: t.id, type: "ASSIGNED" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "ai.suggestion_accept" } })).toBe(1);
  });
});
