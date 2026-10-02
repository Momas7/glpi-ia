import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
const DAY = 24 * 60 * 60 * 1000;
let testDb: TestDb;
let db: Db;
let svc: typeof import("@/modules/tickets");
let session: typeof import("@/modules/auth/session");
let t1: string;
let req: SessionUser, other: SessionUser, agent: SessionUser;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
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
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.session.deleteMany();
  await db.teamMember.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  const mk = async (name: string, role: SessionUser["role"], teams: string[] = []) => {
    const u = await db.user.create({
      data: { name, email: `${name.toLowerCase()}@x.com`, role, teams: { create: teams.map((teamId) => ({ teamId })) } },
    });
    cookie[name] = `session=${await session.createSession(u.id)}`;
    return { id: u.id, name, email: u.email, role, teamIds: teams } as SessionUser;
  };
  req = await mk("Req", "REQUESTER");
  other = await mk("Outro", "REQUESTER");
  agent = await mk("Agente", "AGENT", [t1]);
});

async function ticket(status: "OPEN" | "RESOLVED" | "CLOSED", resolvedDaysAgo = 0) {
  const t = await svc.createTicket(req, { title: "Chamado", description: "d" });
  return db.ticket.update({
    where: { id: t.id },
    data: {
      teamId: t1,
      status,
      resolvedAt: status === "OPEN" ? null : new Date(Date.now() - resolvedDaysAgo * DAY),
      closedAt: status === "CLOSED" ? new Date() : null,
    },
  });
}

describe("reopenTicket", () => {
  it("solicitante reabre RESOLVED: OPEN, resolvedAt nulo e o motivo vira comentário público", async () => {
    const t = await ticket("RESOLVED");
    const up = await svc.reopenTicket(req, t.id, "Voltou a falhar hoje cedo.");
    expect(up.status).toBe("OPEN");
    expect(up.resolvedAt).toBeNull();
    const c = await db.comment.findFirstOrThrow({ where: { ticketId: t.id } });
    expect([c.body, c.internal, c.authorId]).toEqual(["Voltou a falhar hoje cedo.", false, req.id]);
    expect(await db.ticketEvent.count({ where: { ticketId: t.id, type: "REOPENED" } })).toBe(1);
  });

  it("CLOSED → 409; outro solicitante → 404; técnico da equipe → 403", async () => {
    const closed = await ticket("CLOSED");
    await expect(svc.reopenTicket(req, closed.id, "Quero reabrir")).rejects.toMatchObject({ status: 409 });
    const resolved = await ticket("RESOLVED");
    await expect(svc.reopenTicket(other, resolved.id, "Não é meu")).rejects.toMatchObject({ status: 404 });
    await expect(svc.reopenTicket(agent, resolved.id, "Sou técnico")).rejects.toMatchObject({ status: 403 });
  });

  it("rota: motivo curto → 400; válido → 200", async () => {
    const t = await ticket("RESOLVED");
    const call = async (body: unknown) => {
      const m = await import("@/app/api/tickets/[id]/reopen/route");
      const r = new Request(`${ORIGIN}/api/x`, {
        method: "POST",
        headers: { cookie: cookie.Req, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return m.POST(r, { params: Promise.resolve({ id: t.id }) }) as Promise<Response>;
    };
    expect((await call({ reason: "ok" })).status).toBe(400);
    expect((await call({ reason: "Continua sem funcionar." })).status).toBe(200);
  });
});

describe("confirmTicket", () => {
  it("solicitante confirma RESOLVED → CLOSED com closedAt; fora de RESOLVED → 409", async () => {
    const t = await ticket("RESOLVED");
    const up = await svc.confirmTicket(req, t.id);
    expect(up.status).toBe("CLOSED");
    expect(up.closedAt).not.toBeNull();
    await expect(svc.confirmTicket(req, (await ticket("OPEN")).id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("autoCloseResolved", () => {
  it("fecha só os resolvidos há mais de N dias e registra AUTO_CLOSED sem ator", async () => {
    const old = await ticket("RESOLVED", 8);
    const recent = await ticket("RESOLVED", 6);
    const open = await ticket("OPEN");
    const closedCount = await svc.autoCloseResolved(new Date(), 7);
    expect(closedCount).toBe(1);
    const status = async (id: string) => (await db.ticket.findUniqueOrThrow({ where: { id } })).status;
    expect([await status(old.id), await status(recent.id), await status(open.id)]).toEqual(["CLOSED", "RESOLVED", "OPEN"]);
    const ev = await db.ticketEvent.findFirstOrThrow({ where: { ticketId: old.id, type: "AUTO_CLOSED" } });
    expect(ev.actorId).toBeNull();
    expect((await db.ticket.findUniqueOrThrow({ where: { id: old.id } })).closedAt).not.toBeNull();
  });
});
