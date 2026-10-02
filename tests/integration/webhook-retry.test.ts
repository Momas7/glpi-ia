import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";
import { startWebhookServer } from "./helpers/webhook-server";

let testDb: TestDb;
let db: Db;
let server: Awaited<ReturnType<typeof startWebhookServer>>;
let integrations: typeof import("@/modules/integrations");
let admin: SessionUser, agent: SessionUser;
let ticketId: string, commentId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  server = await startWebhookServer();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = "http://app.test";
  process.env.N8N_WEBHOOK_URL = server.url;
  process.env.N8N_WEBHOOK_SECRET = "s".repeat(32);
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  integrations = await import("@/modules/integrations");
  await integrations.registerWebhookQueues({ retryLimit: 0, retryDelay: 1 });
});

afterAll(async () => {
  await (await import("@/lib/queue")).stopQueue();
  await server?.close();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  server.received.length = 0;
  await db.webhookDelivery.deleteMany();
  await db.comment.deleteMany();
  await db.ticket.deleteMany();
  await db.user.deleteMany();
  const a = await db.user.create({ data: { name: "Admin", email: "admin@x.com", role: "ADMIN" } });
  const g = await db.user.create({ data: { name: "Agente", email: "agente@x.com", role: "AGENT" } });
  admin = { id: a.id, name: a.name, email: a.email, role: "ADMIN", teamIds: [] };
  agent = { id: g.id, name: g.name, email: g.email, role: "AGENT", teamIds: [] };
  const t = await db.ticket.create({ data: { title: "Impressora", description: "segredo", requesterId: a.id } });
  ticketId = t.id;
  commentId = (await db.comment.create({ data: { ticketId, authorId: g.id, body: "texto", internal: false } })).id;
});

const failed = (type: string, extra: object = {}) =>
  db.webhookDelivery.create({ data: { eventId: `evt-${type}-${Date.now()}`, type, status: "FAILED", attempts: 8, lastError: "HTTP 500", ...extra } });

describe("reenvio de avisos", () => {
  it("comment.created FAILED volta a PENDING, reenviado com o mesmo id e redelivery: true", async () => {
    const d = await failed("comment.created", { ticketId, subjectId: commentId });
    await integrations.retryDelivery(admin, d.id);
    await vi.waitFor(async () => expect((await db.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("DELIVERED"), {
      timeout: 15000,
    });
    const body = JSON.parse(server.received[0].body);
    expect(body).toMatchObject({ id: d.eventId, type: "comment.created", data: { commentId, redelivery: true, author: { email: "agente@x.com" } } });
    expect(server.received[0].body).not.toContain("texto");
  });

  it("auth.* e entregas já DELIVERED → 409; não-admin → 403", async () => {
    const auth = await failed("auth.password_reset_requested");
    await expect(integrations.retryDelivery(admin, auth.id)).rejects.toMatchObject({ status: 409 });
    const ok = await db.webhookDelivery.create({ data: { eventId: "evt-ok", type: "ticket.created", ticketId, status: "DELIVERED" } });
    await expect(integrations.retryDelivery(admin, ok.id)).rejects.toMatchObject({ status: 409 });
    const t = await failed("ticket.created", { ticketId });
    await expect(integrations.retryDelivery(agent, t.id)).rejects.toMatchObject({ status: 403 });
  });

  it("listFailedDeliveries traz só FAILED, mais recentes primeiro, com o número do chamado", async () => {
    const first = await failed("ticket.created", { ticketId });
    await new Promise((r) => setTimeout(r, 20));
    const second = await failed("ticket.assigned", { ticketId });
    await db.webhookDelivery.create({ data: { eventId: "evt-pend", type: "ticket.created", ticketId } });
    const list = await integrations.listFailedDeliveries(admin);
    expect(list.map((d) => d.id)).toEqual([second.id, first.id]);
    expect(list[0].ticketNumber).toEqual(expect.any(Number));
  });
});
