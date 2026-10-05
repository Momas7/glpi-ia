import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";
import { queuedEvents } from "./helpers/queued-events";

const DESCRIPTION = "DESCRICAO-SECRETA-DO-CHAMADO";
const INTERNAL = "NOTA-INTERNA-SECRETA";
const PUBLIC = "COMENTARIO-PUBLICO-TEXTO";
const DAY = 24 * 60 * 60 * 1000;
let testDb: TestDb;
let db: Db;
let svc: typeof import("@/modules/tickets");
let t1: string;
let req: SessionUser, lead: SessionUser, agent: SessionUser;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = "http://app.test";
  process.env.N8N_WEBHOOK_URL = "http://n8n.invalid/webhook";
  process.env.N8N_WEBHOOK_SECRET = "s".repeat(32);
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  svc = await import("@/modules/tickets");
});

afterAll(async () => {
  const { stopQueue } = await import("@/lib/queue");
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.$executeRaw`DELETE FROM pgboss.job WHERE name = 'webhook.deliver'`.catch(() => {});
  await db.webhookDelivery.deleteMany();
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.teamMember.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  t1 = (await db.team.create({ data: { name: "T1" } })).id;
  const mk = async (name: string, role: SessionUser["role"], teams: string[] = []) => {
    const u = await db.user.create({
      data: { name, email: `${name.toLowerCase()}@x.com`, role, teams: { create: teams.map((teamId) => ({ teamId })) } },
    });
    return { id: u.id, name, email: u.email, role, teamIds: teams } as SessionUser;
  };
  req = await mk("Req", "REQUESTER");
  lead = await mk("Lead", "TEAM_LEAD", [t1]);
  agent = await mk("Agente", "AGENT", [t1]);
});

async function newTicket() {
  const t = await svc.createTicket(lead, { title: "Impressora", description: DESCRIPTION, teamId: t1 });
  return t;
}

describe("avisos de chamado", () => {
  it("criar enfileira ticket.created com número e link", async () => {
    const t = await newTicket();
    const [ev] = await queuedEvents(db, "ticket.created");
    expect(ev.data).toMatchObject({ id: t.id, number: t.number, url: `http://app.test/tickets/${t.id}`, team: "T1" });
    expect(ev.data.requester).toMatchObject({ email: "lead@x.com" });
  });

  it("atribuir e assumir enfileiram ticket.assigned", async () => {
    const t = await newTicket();
    await svc.assignTicket(lead, t.id, { assigneeId: agent.id });
    await svc.assignTicket(lead, t.id, { assigneeId: null });
    await svc.takeTicket(agent, t.id);
    const evs = await queuedEvents(db, "ticket.assigned");
    expect(evs).toHaveLength(3);
    expect(evs[0].data.assignee).toMatchObject({ email: "agente@x.com" });
    expect(evs[1].data).toMatchObject({ previousAssigneeId: agent.id, assignee: null });
  });

  it("transições, reabrir, confirmar e fechamento automático enfileiram ticket.status_changed com from/to", async () => {
    const t = await newTicket();
    await svc.changeStatus(agent, t.id, "OPEN");
    await svc.changeStatus(agent, t.id, "RESOLVED", "Solução de teste do chamado.");
    const own = await svc.createTicket(req, { title: "Do solicitante", description: DESCRIPTION });
    await db.ticket.update({ where: { id: own.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await svc.reopenTicket(req, own.id, "Voltou a acontecer");
    await db.ticket.update({ where: { id: own.id }, data: { status: "RESOLVED", resolvedAt: new Date() } });
    await svc.confirmTicket(req, own.id);
    await db.ticket.update({ where: { id: t.id }, data: { resolvedAt: new Date(Date.now() - 8 * DAY) } });
    await svc.autoCloseResolved(new Date(), 7);

    const changes = (await queuedEvents(db, "ticket.status_changed")).map((e) => `${e.data.from}->${e.data.to}`);
    expect(changes).toEqual(["NEW->OPEN", "OPEN->RESOLVED", "RESOLVED->OPEN", "RESOLVED->CLOSED", "RESOLVED->CLOSED"]);
    expect(await queuedEvents(db, "comment.created")).toHaveLength(1); // o motivo da reabertura é público
  });

  it("comentário público avisa; nota interna não; nenhum corpo leva descrição ou texto de comentário", async () => {
    const t = await newTicket();
    await svc.addComment(agent, t.id, { body: INTERNAL, internal: true });
    await svc.addComment(agent, t.id, { body: PUBLIC, internal: false });
    const comments = await queuedEvents(db, "comment.created");
    expect(comments).toHaveLength(1);
    expect(comments[0].data).toMatchObject({ author: { email: "agente@x.com" } });
    for (const ev of await queuedEvents(db)) {
      expect(ev.raw).not.toContain(DESCRIPTION);
      expect(ev.raw).not.toContain(INTERNAL);
      expect(ev.raw).not.toContain(PUBLIC);
    }
  });

  it("transição recusada (409) não enfileira nada", async () => {
    const t = await newTicket();
    const before = (await queuedEvents(db)).length;
    await expect(svc.changeStatus(agent, t.id, "CLOSED")).rejects.toMatchObject({ status: 409 });
    expect((await queuedEvents(db)).length).toBe(before);
  });

  it("liberar atribuições (admin) enfileira ticket.assigned por chamado", async () => {
    const t = await newTicket();
    await svc.takeTicket(agent, t.id);
    await db.$transaction((tx) => svc.releaseAssignments(tx, { actorId: lead.id, userId: agent.id }));
    const evs = await queuedEvents(db, "ticket.assigned");
    expect(evs.at(-1)!.data).toMatchObject({ previousAssigneeId: agent.id, assignee: null });
  });
});
