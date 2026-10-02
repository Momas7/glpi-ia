import { TZDate } from "@date-fns/tz";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";
import { queuedEvents } from "./helpers/queued-events";

const SP = "America/Sao_Paulo";
const sp = (d: number, h: number, min = 0) => new Date(new TZDate(2026, 9, d, h, min, SP).getTime()); // 05/10/2026 = segunda
let testDb: TestDb;
let db: Db;
let sla: typeof import("@/modules/sla");
let requesterId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_TIMEZONE = SP;
  process.env.N8N_WEBHOOK_URL = "http://n8n.invalid/webhook";
  process.env.N8N_WEBHOOK_SECRET = "s".repeat(32);
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  sla = await import("@/modules/sla");
  await db.slaPolicy.create({ data: { priority: "CRITICAL", firstResponseMinutes: 60, resolutionMinutes: 240 } });
  await db.businessHours.createMany({ data: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 1080 })) });
  requesterId = (await db.user.create({ data: { name: "Req", email: "req@x.com", role: "REQUESTER" } })).id;
});

afterAll(async () => {
  await (await import("@/lib/queue")).stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.$executeRaw`DELETE FROM pgboss.job WHERE name = 'webhook.deliver'`.catch(() => {});
  await db.webhookDelivery.deleteMany();
  await db.ticket.deleteMany();
  sla.invalidateCalendarCache();
});

// CRITICAL criado segunda 8h: resolução em 240 min úteis → vence segunda 12h
async function critical(extra: object = {}) {
  const t = await db.ticket.create({
    data: { title: "Servidor fora", description: "d", requesterId, priority: "CRITICAL", status: "OPEN", createdAt: sp(5, 8), ...extra },
  });
  await db.$transaction((tx) => sla.slaOnCreate(tx, t.id, sp(5, 8)));
  return t.id;
}
const types = async () => (await queuedEvents(db)).map((e) => e.type);

describe("scanSla", () => {
  it("85% consumido: um sla.warning, marca slaWarnedAt e não repete", async () => {
    const id = await critical();
    expect(await sla.scanSla(sp(5, 11, 24))).toEqual({ warned: 1, breached: 0 });
    expect(await sla.scanSla(sp(5, 11, 30))).toEqual({ warned: 0, breached: 0 });
    expect(await types()).toEqual(["sla.warning"]);
    const [ev] = await queuedEvents(db, "sla.warning");
    expect(ev.data).toMatchObject({ id, remainingMinutes: 36 });
    expect((await db.ticket.findUniqueOrThrow({ where: { id } })).slaWarnedAt).not.toBeNull();
  });

  it("vencido: um sla.breached (sem warning junto) e não repete", async () => {
    await critical();
    expect(await sla.scanSla(sp(5, 13))).toEqual({ warned: 0, breached: 1 });
    await sla.scanSla(sp(5, 14));
    expect(await types()).toEqual(["sla.breached"]);
  });

  it("pausado, resolvido, fechado ou sem prazo: nada", async () => {
    await critical({ status: "PENDING", pausedAt: sp(5, 9) });
    await critical({ status: "RESOLVED" });
    await critical({ status: "CLOSED" });
    await db.ticket.create({ data: { title: "Sem prazo", description: "d", requesterId, status: "OPEN", createdAt: sp(1, 8) } });
    expect(await sla.scanSla(sp(6, 13))).toEqual({ warned: 0, breached: 0 });
    expect(await types()).toEqual([]);
  });

  it("reaberto depois de alertado volta a alertar quando fica em risco de novo", async () => {
    const id = await critical();
    await sla.scanSla(sp(5, 11, 24));
    await db.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: { status: "RESOLVED" } });
      await sla.slaOnStatusChange(tx, id, "OPEN", "RESOLVED", sp(5, 11, 30));
      await tx.ticket.update({ where: { id }, data: { status: "OPEN" } });
      await sla.slaOnStatusChange(tx, id, "RESOLVED", "OPEN", sp(6, 8));
    });
    // pausado de segunda 11h30 a terça 8h = 390 min; novo prazo = segunda 8h + 630 min úteis = terça 8h30.
    // Terça 8h10: 610 − 390 = 220 min consumidos (≥ 80% de 240) e ainda não vencido → novo alerta.
    expect((await sla.scanSla(sp(6, 8, 10))).warned).toBe(1);
    expect(await types()).toEqual(["sla.warning", "sla.warning"]);
  });
});
