import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";
import { startWebhookServer } from "./helpers/webhook-server";

const SECRET = "segredo-de-teste-".padEnd(40, "x");
let testDb: TestDb;
let db: Db;
let server: Awaited<ReturnType<typeof startWebhookServer>>;
let integrations: typeof import("@/modules/integrations");
let sig: typeof import("@/modules/integrations/signature");

beforeAll(async () => {
  testDb = await startTestDb();
  server = await startWebhookServer();
  process.env.DATABASE_URL = testDb.url;
  process.env.N8N_WEBHOOK_URL = server.url;
  process.env.N8N_WEBHOOK_SECRET = SECRET;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  integrations = await import("@/modules/integrations");
  sig = await import("@/modules/integrations/signature");
  await integrations.registerWebhookQueues({ retryLimit: 2, retryDelay: 1 });
});

afterAll(async () => {
  const { stopQueue } = await import("@/lib/queue");
  await stopQueue();
  await server?.close();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(() => {
  server.received.length = 0;
  server.setRespond(() => 200);
  process.env.N8N_WEBHOOK_URL = server.url;
});

const emit = (marker: string) => db.$transaction((tx) => integrations.emitEvent(tx, "ticket.created", { marker }));
const delivery = (eventId: string) => db.webhookDelivery.findUniqueOrThrow({ where: { eventId } });
const bodies = () => server.received.map((r) => JSON.parse(r.body));

describe("emitEvent e entrega", () => {
  it("transação confirmada: chega uma vez, assinada, e fica DELIVERED", async () => {
    const eventId = (await emit("ok-1"))!;
    await vi.waitFor(async () => expect((await delivery(eventId)).status).toBe("DELIVERED"), { timeout: 15000 });
    expect(server.received).toHaveLength(1);
    const hit = server.received[0];
    expect(hit.headers["x-event-id"]).toBe(eventId);
    expect(
      sig.verifySignature({ secret: SECRET, timestamp: Number(hit.headers["x-timestamp"]), body: hit.body, signature: hit.headers["x-signature"] }),
    ).toBe(true);
    expect(JSON.parse(hit.body)).toMatchObject({ id: eventId, type: "ticket.created", data: { marker: "ok-1" } });
  });

  it("rollback: não chega e não deixa registro", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await integrations.emitEvent(tx, "ticket.created", { marker: "rollback" });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await new Promise((r) => setTimeout(r, 3000));
    expect(bodies().some((b) => b.data.marker === "rollback")).toBe(false);
    expect(await db.webhookDelivery.count({ where: { status: "PENDING" } })).toBe(0);
  });

  it("500 na primeira tentativa e 200 na segunda: entregue com attempts = 1", async () => {
    server.setRespond((_, n) => (n === 1 ? 500 : 200));
    const eventId = (await emit("retry"))!;
    await vi.waitFor(async () => expect((await delivery(eventId)).status).toBe("DELIVERED"), { timeout: 30000 });
    expect((await delivery(eventId)).attempts).toBe(1);
  });

  it("sempre 500: termina FAILED com o status no lastError", async () => {
    server.setRespond(() => 500);
    const eventId = (await emit("falha"))!;
    await vi.waitFor(async () => expect((await delivery(eventId)).status).toBe("FAILED"), { timeout: 45000 });
    expect((await delivery(eventId)).lastError).toMatch(/500/);
  });

  it("sem N8N_WEBHOOK_URL: devolve null e não cria registro", async () => {
    delete process.env.N8N_WEBHOOK_URL;
    const before = await db.webhookDelivery.count();
    expect(await emit("sem-url")).toBeNull();
    expect(await db.webhookDelivery.count()).toBe(before);
  });

  it("destino lento: emitEvent volta na hora e a tentativa estoura o timeout de 10 s", async () => {
    server.setRespond(() => new Promise((r) => setTimeout(() => r(200), 15000)));
    const t0 = Date.now();
    const eventId = (await emit("lento"))!;
    expect(Date.now() - t0).toBeLessThan(1000);
    const row = await delivery(eventId);
    const t1 = Date.now();
    await expect(
      integrations.deliverWebhook({ deliveryId: row.id, body: JSON.stringify({ id: eventId, type: "ticket.created", occurredAt: "x", data: {} }) }),
    ).rejects.toThrow();
    expect(Date.now() - t1).toBeLessThan(12000);
    expect((await delivery(eventId)).attempts).toBeGreaterThanOrEqual(1);
  }, 60000);
});
