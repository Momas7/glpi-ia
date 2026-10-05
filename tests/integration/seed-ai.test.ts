import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed";
import { createDb, type Db } from "@/lib/db";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;

beforeAll(async () => {
  testDb = await startTestDb();
  db = createDb(testDb.url);
  process.env.SEED_DEMO_PASSWORD = "Demo-Fict1cia-Senha";
  await seed(db);
});

afterAll(async () => {
  delete process.env.SEED_DEMO_PASSWORD;
  await db?.$disconnect();
  await testDb?.stop();
});

const counts = async () => ({
  audit: await db.aiAuditLog.count(),
  suggestions: await db.aiSuggestion.count(),
  ratings: await db.ticketRating.count(),
  groups: await db.incidentGroup.count(),
});

describe("seed de demonstração da IA", () => {
  it("a triagem tem aceite perto de 70%, edição perto de 15% e rejeição perto de 15%, sem pendentes", async () => {
    const triage = await db.aiSuggestion.findMany({ where: { kind: "TRIAGE" } });
    expect(triage.length).toBeGreaterThanOrEqual(150);
    expect(triage.every((s) => s.demo)).toBe(true);
    expect(triage.some((s) => s.status === "PENDING")).toBe(false);
    const share = (st: string) => triage.filter((s) => s.status === st).length / triage.length;
    expect(share("ACCEPTED")).toBeGreaterThan(0.6);
    expect(share("ACCEPTED")).toBeLessThan(0.8);
    expect(share("EDITED")).toBeGreaterThan(0.07);
    expect(share("REJECTED")).toBeGreaterThan(0.07);
    expect(triage.every((s) => s.decidedAt !== null)).toBe(true);
  });

  it("avaliações só em chamados fechados, notas de 1 a 5, média perto de 4,2, todas de demonstração", async () => {
    const ratings = await db.ticketRating.findMany({ include: { ticket: true } });
    expect(ratings.length).toBeGreaterThan(40);
    expect(ratings.every((r) => r.demo && r.stars >= 1 && r.stars <= 5)).toBe(true);
    expect(ratings.every((r) => r.ticket.status === "CLOSED")).toBe(true);
    expect(ratings.every((r) => r.ticket.closedAt && r.createdAt >= r.ticket.closedAt)).toBe(true);
    const avg = ratings.reduce((n, r) => n + r.stars, 0) / ratings.length;
    expect(avg).toBeGreaterThan(3.8);
    expect(avg).toBeLessThan(4.6);
    expect(new Set(ratings.map((r) => r.stars)).size).toBeGreaterThanOrEqual(4);
  });

  it("duplicados e resumos esparsos, nenhum pendente (não aparecem como aviso em chamado encerrado)", async () => {
    const dups = await db.aiSuggestion.findMany({ where: { kind: "DUPLICATE" } });
    const sums = await db.aiSuggestion.findMany({ where: { kind: "SUMMARY" } });
    expect(dups.length).toBeGreaterThan(3);
    expect(dups.some((d) => d.status === "REJECTED")).toBe(true);
    expect(dups.some((d) => d.status === "PENDING")).toBe(false);
    expect(sums.length).toBeGreaterThan(3);
    expect([...dups, ...sums].every((s) => s.demo)).toBe(true);
  });

  it("dois incidentes encerrados, com cinco chamados cada", async () => {
    const groups = await db.incidentGroup.findMany({ include: { _count: { select: { tickets: true } } } });
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.status === "CLOSED" && g.closedAt !== null && g._count.tickets === 5)).toBe(true);
    expect(groups.every((g) => g.title.includes("demonstração"))).toBe(true);
  });

  it("execuções de IA espalhadas por vários meses, todas de demonstração, com custo e latência plausíveis", async () => {
    const logs = await db.aiAuditLog.findMany();
    expect(logs.length).toBeGreaterThan(400);
    expect(logs.every((l) => l.demo && l.maskedInput === null)).toBe(true);
    expect(new Set(logs.map((l) => l.createdAt.toISOString().slice(0, 7))).size).toBeGreaterThanOrEqual(5);
    expect(new Set(logs.map((l) => l.jobType))).toEqual(new Set(["triage", "embed", "detect", "draft", "summary", "search"]));
    expect(logs.every((l) => Number(l.costUsd) >= 0 && l.latencyMs >= 0)).toBe(true);
    const ok = logs.filter((l) => l.outcome === "OK").length / logs.length;
    expect(ok).toBeGreaterThan(0.9);
    expect(logs.some((l) => l.outcome === "FAILED")).toBe(true);
    expect(logs.some((l) => l.outcome === "BUDGET")).toBe(true);
    expect(logs.filter((l) => l.outcome === "OK").every((l) => l.inputTokens > 0)).toBe(true);
  });

  it("rodar o seed de novo não duplica nada", async () => {
    const before = await counts();
    await seed(db);
    expect(await counts()).toEqual(before);
  });
});
