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
  return db.ticket.create({ data: { title: "t", description: "d", requesterId: u.id } });
};

describe("schema da IA", () => {
  it("AiSuggestion nasce PENDING", async () => {
    const t = await mkTicket("a@x.com");
    const s = await db.aiSuggestion.create({
      data: { ticketId: t.id, kind: "TRIAGE", payload: { priority: "HIGH" }, confidence: 0.9 },
    });
    expect(s.status).toBe("PENDING");
    expect(s.decidedAt).toBeNull();
  });

  it("só uma triagem por chamado", async () => {
    const t = await mkTicket("b@x.com");
    const data = { ticketId: t.id, kind: "TRIAGE" as const, payload: {}, confidence: 0.7 };
    await db.aiSuggestion.create({ data });
    await expect(db.aiSuggestion.create({ data })).rejects.toThrow();
  });

  it("apagar o chamado apaga a sugestão, mas mantém o log de auditoria", async () => {
    const t = await mkTicket("c@x.com");
    await db.aiSuggestion.create({ data: { ticketId: t.id, kind: "TRIAGE", payload: {}, confidence: 0.8 } });
    await db.aiAuditLog.create({
      data: {
        provider: "fake", model: "fake-triage", jobType: "triage", ticketId: t.id,
        inputTokens: 10, outputTokens: 5, costUsd: "0.000123", latencyMs: 12, inputHash: "h", outcome: "OK",
      },
    });
    await db.ticket.delete({ where: { id: t.id } });
    expect(await db.aiSuggestion.count({ where: { ticketId: t.id } })).toBe(0);
    expect(await db.aiAuditLog.count({ where: { ticketId: t.id } })).toBe(1);
  });

  it("Team.aiEnabled é verdadeiro por padrão", async () => {
    const team = await db.team.create({ data: { name: "Equipe IA" } });
    expect(team.aiEnabled).toBe(true);
  });
});
