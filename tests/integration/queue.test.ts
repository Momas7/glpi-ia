import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { enqueue, registerHandler, stopQueue } from "@/lib/queue";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  db = createDb(testDb.url);
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

describe("fila pg-boss", () => {
  it("entrega o payload a um handler registrado, uma vez", async () => {
    const handler = vi.fn(async () => {});
    await registerHandler("system.ping", handler);
    await enqueue("system.ping", { hello: "mundo" });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(handler).toHaveBeenCalledWith({ hello: "mundo" });
  });

  it("reprocessa um handler que lança (retry)", async () => {
    let calls = 0;
    await registerHandler("system.flaky", async () => {
      calls++;
      if (calls === 1) throw new Error("falha transitória");
    });
    await enqueue("system.flaky", {});
    await vi.waitFor(() => expect(calls).toBe(2), { timeout: 15000 });
  });

  it("não entrega o job quando a transação que o enfileirou sofre rollback", async () => {
    const handler = vi.fn(async () => {});
    await registerHandler("system.tx", handler);
    await expect(
      db.$transaction(async (tx) => {
        await enqueue("system.tx", { n: 1 }, { tx });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await new Promise((r) => setTimeout(r, 3000));
    expect(handler).not.toHaveBeenCalled();
  });

  it("entrega o job quando a transação é confirmada", async () => {
    const handler = vi.fn(async () => {});
    await registerHandler("system.tx-ok", handler);
    await db.$transaction(async (tx) => {
      await enqueue("system.tx-ok", { n: 2 }, { tx });
    });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ n: 2 }), { timeout: 5000 });
  });
});

describe("recuperação de falha no start", () => {
  it("volta a funcionar depois que um start falhou (promise rejeitada não fica em cache)", async () => {
    await stopQueue();
    const valid = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://x:y@127.0.0.1:1/none";
    await expect(enqueue("system.recover", {})).rejects.toThrow();

    process.env.DATABASE_URL = valid;
    const handler = vi.fn(async () => {});
    await registerHandler("system.recover", handler);
    await enqueue("system.recover", { ok: true });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ ok: true }), { timeout: 8000 });
  });
});

describe("agendamento", () => {
  it("scheduleJob registra o cron no pg-boss", async () => {
    const { scheduleJob, getQueue } = await import("@/lib/queue");
    await scheduleJob("teste.agendado", "0 * * * *");
    const schedules = await (await getQueue()).getSchedules("teste.agendado");
    expect(schedules.map((s) => s.cron)).toContain("0 * * * *");
  });
});
