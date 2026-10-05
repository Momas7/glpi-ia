import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await startTestDb();
  db = createDb(testDb.url);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

describe("schema da integração", () => {
  it("externalRef é único por chave de API e por chamado (comentários)", async () => {
    const admin = await db.user.create({ data: { name: "A", email: "a@x.com", role: "ADMIN" } });
    const mkKey = (prefix: string) =>
      db.apiKey.create({ data: { name: prefix, prefix, keyHash: `h-${prefix}`, scopes: ["tickets:create"], createdById: admin.id } });
    const k1 = await mkKey("k1");
    const k2 = await mkKey("k2");
    const mkTicket = (apiKeyId: string) =>
      db.ticket.create({
        data: { title: "t", description: "d", requesterId: admin.id, source: "API", apiKeyId, externalRef: "msg-1" },
      });
    const t = await mkTicket(k1.id);
    await expect(mkTicket(k1.id)).rejects.toThrow();
    await expect(mkTicket(k2.id)).resolves.toBeTruthy();

    const mkComment = () =>
      db.comment.create({ data: { ticketId: t.id, authorId: admin.id, body: "b", source: "API", externalRef: "c-1" } });
    await mkComment();
    await expect(mkComment()).rejects.toThrow();
  });

  it("WebhookDelivery nasce PENDING com zero tentativas", async () => {
    const d = await db.webhookDelivery.create({ data: { eventId: "e-1", type: "ticket.created" } });
    expect([d.status, d.attempts]).toEqual(["PENDING", 0]);
  });
});
