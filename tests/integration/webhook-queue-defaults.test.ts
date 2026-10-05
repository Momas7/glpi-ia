import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.N8N_WEBHOOK_URL = "http://n8n.invalid/webhook";
  process.env.N8N_WEBHOOK_SECRET = "s".repeat(32);
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
});

afterAll(async () => {
  await (await import("@/lib/queue")).stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

describe("fila de webhook definida por quem enfileira", () => {
  it("o web enfileirando antes do worker já grava o job com dead letter e as tentativas certas", async () => {
    const { emitEvent } = await import("@/modules/integrations");
    await db.$transaction((tx) => emitEvent(tx, "ticket.created", { x: 1 }));
    const [job] = await db.$queryRaw<{ retry_limit: number; dead_letter: string | null }[]>`
      SELECT retry_limit, dead_letter FROM pgboss.job WHERE name = 'webhook.deliver'`;
    expect(job).toEqual({ retry_limit: 7, dead_letter: "webhook.failed" });
  });
});
