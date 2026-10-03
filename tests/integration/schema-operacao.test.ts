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

const mkTicket = async (email: string) => {
  const u = await db.user.create({ data: { name: "U", email, role: "REQUESTER" } });
  const t = await db.ticket.create({ data: { title: "t", description: "d", requesterId: u.id } });
  return { u, t };
};

describe("schema da operação", () => {
  it("as marcas de demonstração nascem falsas e aceitam verdadeiro", async () => {
    const { u, t } = await mkTicket("a@x.com");
    const log = await db.aiAuditLog.create({
      data: { provider: "fake", model: "m", jobType: "triage", inputTokens: 1, outputTokens: 1, costUsd: "0.1", latencyMs: 5, inputHash: "h", outcome: "OK" },
    });
    expect(log.demo).toBe(false);
    const demoLog = await db.aiAuditLog.create({
      data: { provider: "fake", model: "m", jobType: "triage", inputTokens: 1, outputTokens: 1, costUsd: "0.1", latencyMs: 5, inputHash: "h", outcome: "OK", demo: true },
    });
    expect(demoLog.demo).toBe(true);
    const s = await db.aiSuggestion.create({ data: { ticketId: t.id, kind: "TRIAGE", payload: {}, confidence: 0.9 } });
    expect(s.demo).toBe(false);
    const r = await db.ticketRating.create({ data: { ticketId: t.id, raterId: u.id, stars: 5, demo: true } });
    expect(r.demo).toBe(true);
    expect((await db.ticketRating.findUniqueOrThrow({ where: { ticketId: t.id } })).demo).toBe(true);
  });

  it("WorkerHeartbeat faz upsert por serviço", async () => {
    const first = await db.workerHeartbeat.upsert({ where: { service: "worker" }, update: { beatAt: new Date("2026-01-01T00:00:00Z") }, create: { service: "worker", beatAt: new Date("2026-01-01T00:00:00Z") } });
    expect(first.beatAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    await db.workerHeartbeat.upsert({ where: { service: "worker" }, update: { beatAt: new Date("2026-02-01T00:00:00Z") }, create: { service: "worker", beatAt: new Date() } });
    expect(await db.workerHeartbeat.count()).toBe(1);
    expect((await db.workerHeartbeat.findUniqueOrThrow({ where: { service: "worker" } })).beatAt.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});
