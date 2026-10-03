import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let svc: typeof import("@/modules/tickets");
let requester: SessionUser, agent: SessionUser;
let agentCookie: string;
let teamId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, APP_URL: ORIGIN, AI_ENABLED: "true" });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  svc = await import("@/modules/tickets");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  process.env.AI_ENABLED = "true";
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job WHERE name = 'ai.index_ticket'; END IF; END $$`);
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  teamId = (await db.team.create({ data: { name: "T1" } })).id;
  const r = await db.user.create({ data: { name: "req", email: "req@x.com", role: "REQUESTER" } });
  const a = await db.user.create({ data: { name: "agent", email: "agent@x.com", role: "AGENT", teams: { create: [{ teamId }] } } });
  requester = { id: r.id, name: r.name, email: r.email, role: "REQUESTER", teamIds: [] };
  agent = { id: a.id, name: a.name, email: a.email, role: "AGENT", teamIds: [teamId] };
  const { createSession } = await import("@/modules/auth/session");
  agentCookie = `session=${await createSession(a.id)}`;
});

const jobs = async () => {
  const exists = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
  if (!exists[0].ok) return [];
  return db.$queryRaw<{ data: { ticketId: string } }[]>`SELECT data FROM pgboss.job WHERE name = 'ai.index_ticket'`;
};

async function openTicket() {
  const t = await svc.createTicket(requester, { title: "Impressora travada", description: "A fila não anda." });
  await db.ticket.update({ where: { id: t.id }, data: { teamId } });
  await svc.changeStatus(agent, t.id, "OPEN");
  return t;
}

const SOLUTION = "Reiniciei o serviço de spool e limpei a fila.";

describe("solução ao resolver", () => {
  it("resolver sem solução é recusado (400) e o chamado continua aberto", async () => {
    const t = await openTicket();
    await expect(svc.changeStatus(agent, t.id, "RESOLVED")).rejects.toMatchObject({ status: 400 });
    await expect(svc.patchTicket(agent, t.id, { fields: {}, status: "RESOLVED" })).rejects.toMatchObject({ status: 400 });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("OPEN");
  });

  it("solução curta (9 caracteres) ou só espaços é recusada", async () => {
    const t = await openTicket();
    await expect(svc.changeStatus(agent, t.id, "RESOLVED", "123456789")).rejects.toMatchObject({ status: 400 });
    await expect(svc.changeStatus(agent, t.id, "RESOLVED", "          ")).rejects.toMatchObject({ status: 400 });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).resolution).toBeNull();
  });

  it("com solução válida grava a solução, resolve e enfileira a indexação", async () => {
    const t = await openTicket();
    const resolved = await svc.changeStatus(agent, t.id, "RESOLVED", `  ${SOLUTION}  `);
    expect(resolved).toMatchObject({ status: "RESOLVED", resolution: SOLUTION });
    expect((await jobs()).map((j) => j.data.ticketId)).toEqual([t.id]);
  });

  it("solução enviada junto de outro status é recusada", async () => {
    const t = await svc.createTicket(requester, { title: "Outro chamado", description: "d" });
    await db.ticket.update({ where: { id: t.id }, data: { teamId } });
    await expect(svc.changeStatus(agent, t.id, "OPEN", SOLUTION)).rejects.toMatchObject({ status: 400 });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("NEW");
  });

  it("com a IA desligada nada é enfileirado", async () => {
    process.env.AI_ENABLED = "false";
    const t = await openTicket();
    await svc.changeStatus(agent, t.id, "RESOLVED", SOLUTION);
    expect(await jobs()).toHaveLength(0);
  });

  it("reabrir enfileira a reindexação (que tira o chamado da base) e mantém a solução", async () => {
    const t = await openTicket();
    await svc.changeStatus(agent, t.id, "RESOLVED", SOLUTION);
    await db.$executeRawUnsafe(`DELETE FROM pgboss.job WHERE name = 'ai.index_ticket'`);
    await svc.reopenTicket(requester, t.id, "Continua travando depois do reinício.");
    expect((await jobs()).map((j) => j.data.ticketId)).toEqual([t.id]);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).resolution).toBe(SOLUTION);
  });

  it("o fechamento automático mantém a solução", async () => {
    const t = await openTicket();
    await svc.changeStatus(agent, t.id, "RESOLVED", SOLUTION);
    await db.ticket.update({ where: { id: t.id }, data: { resolvedAt: new Date(Date.now() - 10 * 24 * 3600 * 1000) } });
    await svc.autoCloseResolved();
    expect(await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "CLOSED", resolution: SOLUTION });
  });

  it("a rota PATCH também exige a solução e a grava", async () => {
    const t = await openTicket();
    const { PATCH } = await import("@/app/api/tickets/[id]/route");
    const call = (body: object) =>
      PATCH(
        new Request(`${ORIGIN}/api/tickets/${t.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json", cookie: agentCookie, origin: ORIGIN },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: t.id }) },
      );
    expect((await call({ status: "RESOLVED" })).status).toBe(400);
    const ok = await call({ status: "RESOLVED", resolution: SOLUTION });
    expect(ok.status).toBe(200);
    expect((await ok.json()).ticket).toMatchObject({ status: "RESOLVED", resolution: SOLUTION });
  });
});
