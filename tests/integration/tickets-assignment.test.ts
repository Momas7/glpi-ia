import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let svc: typeof import("@/modules/tickets");
let session: typeof import("@/modules/auth/session");
let t1: string, t2: string;
let lead: SessionUser, agentA: SessionUser, agentB: SessionUser, agentOther: SessionUser, inactive: SessionUser, req: SessionUser;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = ORIGIN;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  svc = await import("@/modules/tickets");
  session = await import("@/modules/auth/session");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.session.deleteMany();
  await db.teamMember.deleteMany();
  await db.category.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  t2 = (await db.team.create({ data: { name: "T2" } })).id;
  const mk = async (name: string, role: SessionUser["role"], teams: string[], active = true) => {
    const u = await db.user.create({
      data: { name, email: `${name.toLowerCase()}@x.com`, role, active, teams: { create: teams.map((teamId) => ({ teamId })) } },
    });
    cookie[name] = `session=${await session.createSession(u.id)}`;
    return { id: u.id, name, email: u.email, role, teamIds: teams } as SessionUser;
  };
  lead = await mk("Lead", "TEAM_LEAD", [t1]);
  agentA = await mk("AgenteA", "AGENT", [t1]);
  agentB = await mk("AgenteB", "AGENT", [t1]);
  agentOther = await mk("Outro", "AGENT", [t2]);
  inactive = await mk("Inativo", "AGENT", [t1], false);
  req = await mk("Req", "REQUESTER", []);
});

async function ticketInT1(title = "Chamado") {
  const t = await svc.createTicket(req, { title, description: "d" });
  return db.ticket.update({ where: { id: t.id }, data: { teamId: t1 } });
}

async function post(mod: string, c: string, id: string, body?: unknown) {
  const m = await import(mod);
  const headers: Record<string, string> = { cookie: c, origin: ORIGIN, "x-forwarded-for": "2.2.2.2" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = new Request(`${ORIGIN}/api/x`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return m.POST(r, { params: Promise.resolve({ id }) }) as Promise<Response>;
}

describe("assignTicket", () => {
  it("líder atribui a técnico da equipe e registra ASSIGNED", async () => {
    const t = await ticketInT1();
    const up = await svc.assignTicket(lead, t.id, { assigneeId: agentA.id });
    expect(up.assigneeId).toBe(agentA.id);
    const ev = await db.ticketEvent.findFirstOrThrow({ where: { ticketId: t.id, type: "ASSIGNED" } });
    expect(ev.data).toMatchObject({ before: { assigneeId: null }, after: { assigneeId: agentA.id } });
  });

  it("recusa (400) solicitante, técnico desativado, técnico de outra equipe e equipe inexistente", async () => {
    const t = await ticketInT1();
    for (const assigneeId of [req.id, inactive.id, agentOther.id]) {
      await expect(svc.assignTicket(lead, t.id, { assigneeId })).rejects.toMatchObject({ status: 400 });
    }
    await expect(svc.assignTicket(lead, t.id, { teamId: "nao-existe" })).rejects.toMatchObject({ status: 400 });
  });

  it("trocar a equipe sem informar responsável limpa o responsável", async () => {
    const t = await ticketInT1();
    await svc.assignTicket(lead, t.id, { assigneeId: agentA.id });
    const moved = await svc.assignTicket(lead, t.id, { teamId: t2 });
    expect(moved.teamId).toBe(t2);
    expect(moved.assigneeId).toBeNull();
  });

  it("não permite deixar o chamado sem equipe (400)", async () => {
    const t = await ticketInT1();
    const res = await post("@/app/api/tickets/[id]/assign/route", cookie.Lead, t.id, { teamId: null });
    expect(res.status).toBe(400);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).teamId).toBe(t1);
  });

  it("técnico comum não atribui (403)", async () => {
    const t = await ticketInT1();
    await expect(svc.assignTicket(agentA, t.id, { assigneeId: agentB.id })).rejects.toMatchObject({ status: 403 });
  });

  it("rota POST /assign: líder 200, técnico 403", async () => {
    const t = await ticketInT1();
    expect((await post("@/app/api/tickets/[id]/assign/route", cookie.AgenteA, t.id, { assigneeId: agentA.id })).status).toBe(403);
    expect((await post("@/app/api/tickets/[id]/assign/route", cookie.Lead, t.id, { assigneeId: agentA.id })).status).toBe(200);
  });
});

describe("takeTicket", () => {
  it("dois técnicos assumindo ao mesmo tempo: um vence, o outro recebe 409", async () => {
    const t = await ticketInT1();
    const results = await Promise.allSettled([svc.takeTicket(agentA, t.id), svc.takeTicket(agentB, t.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const final = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect([agentA.id, agentB.id]).toContain(final.assigneeId);
  });

  it("assumir depois que outro já assumiu (página desatualizada) → 409 com a mensagem certa; outra equipe → 404", async () => {
    const t = await ticketInT1();
    await svc.takeTicket(agentA, t.id);
    await expect(svc.takeTicket(agentB, t.id)).rejects.toMatchObject({
      status: 409,
      message: "Este chamado já foi assumido por outra pessoa.",
    });
    await expect(svc.takeTicket(agentOther, t.id)).rejects.toMatchObject({ status: 404 });
  });

  it("rota POST /take assume para o próprio usuário", async () => {
    const t = await ticketInT1();
    const res = await post("@/app/api/tickets/[id]/take/route", cookie.AgenteB, t.id);
    expect(res.status).toBe(200);
    expect((await res.json()).ticket.assigneeId).toBe(agentB.id);
  });
});

describe("PATCH atômico e referências inexistentes", () => {
  async function patch(c: string, id: string, body: unknown) {
    const m = await import("@/app/api/tickets/[id]/route");
    const r = new Request(`${ORIGIN}/api/x`, {
      method: "PATCH",
      headers: { cookie: c, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return m.PATCH(r, { params: Promise.resolve({ id }) }) as Promise<Response>;
  }

  it("campos + transição inválida → 409 e nenhum campo é gravado", async () => {
    const t = await ticketInT1();
    const res = await patch(cookie.AgenteA, t.id, { priority: "HIGH", status: "CLOSED" });
    expect(res.status).toBe(409);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).priority).toBe("MEDIUM");
  });

  it("campos + transição válida gravam juntos", async () => {
    const t = await ticketInT1();
    const res = await patch(cookie.AgenteA, t.id, { priority: "HIGH", status: "OPEN" });
    expect(res.status).toBe(200);
    const row = await db.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect([row.priority, row.status]).toEqual(["HIGH", "OPEN"]);
  });

  it("PATCH não aceita mais teamId/assigneeId (atribuição só por /assign)", async () => {
    const t = await ticketInT1();
    expect((await patch(cookie.Lead, t.id, { assigneeId: agentA.id })).status).toBe(400);
  });

  it("categoryId inexistente → 400 ao editar e ao criar", async () => {
    const t = await ticketInT1();
    expect((await patch(cookie.AgenteA, t.id, { categoryId: "nao-existe" })).status).toBe(400);
    await expect(svc.createTicket(req, { title: "Com categoria", description: "d", categoryId: "nao-existe" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createTicket(lead, { title: "Equipe errada", description: "d", teamId: "nao-existe" })).rejects.toMatchObject({ status: 400 });
  });
});
