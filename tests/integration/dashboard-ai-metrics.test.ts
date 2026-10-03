import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let metrics: typeof import("@/modules/dashboard/ai-metrics");
let dash: typeof import("@/modules/dashboard");
let teamA: string, teamB: string;
let requesterId: string;
let admin: SessionUser, leadA: SessionUser;

const TZ = "America/Sao_Paulo";
// Outubro de 2026 no fuso de São Paulo: [01/10 03:00Z, 01/11 03:00Z)
const RANGE = { from: new Date("2026-10-01T03:00:00Z"), to: new Date("2026-11-01T03:00:00Z") };
const MONTHS = [new Date("2026-08-01T03:00:00Z"), new Date("2026-09-01T03:00:00Z"), new Date("2026-10-01T03:00:00Z")];
const inOct = (day: number, hour = 12) => new Date(Date.UTC(2026, 9, day, hour));

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"], teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, APP_TIMEZONE: TZ });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  metrics = await import("@/modules/dashboard/ai-metrics");
  dash = await import("@/modules/dashboard");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  dash.clearDashboardCache();
  await db.aiAuditLog.deleteMany();
  await db.aiSuggestion.deleteMany();
  await db.ticketRating.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.incidentGroup.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  teamA = (await db.team.create({ data: { name: "A" } })).id;
  teamB = (await db.team.create({ data: { name: "B" } })).id;
  const r = await db.user.create({ data: { name: "req", email: "req@x.com", role: "REQUESTER" } });
  const l = await db.user.create({ data: { name: "leadA", email: "lead@x.com", role: "TEAM_LEAD", teams: { create: [{ teamId: teamA }] } } });
  const a = await db.user.create({ data: { name: "adm", email: "adm@x.com", role: "ADMIN" } });
  requesterId = r.id;
  leadA = session(l, "TEAM_LEAD", [teamA]);
  admin = session(a, "ADMIN");
});

const mkTicket = (teamId: string, over: Record<string, unknown> = {}) =>
  db.ticket.create({ data: { title: "t", description: "d", requesterId, teamId, status: "CLOSED", ...over } });
const rate = (ticketId: string, stars: number, createdAt: Date, demo = false) =>
  db.ticketRating.create({ data: { ticketId, raterId: requesterId, stars, createdAt, demo } });
const log = (over: Record<string, unknown>) =>
  db.aiAuditLog.create({
    data: {
      provider: "fake", model: "m", jobType: "triage", inputTokens: 100, outputTokens: 10, costUsd: "0.01", latencyMs: 100,
      inputHash: "h", outcome: "OK", createdAt: inOct(10), ...over,
    } as never,
  });

describe("queryCsat", () => {
  async function seedRatings() {
    const a = [];
    for (const [i, stars] of [5, 4, 4, 2, 1].entries()) {
      const t = await mkTicket(teamA);
      await rate(t.id, stars, inOct(5 + i));
      a.push(t);
    }
    const b = await mkTicket(teamB);
    await rate(b.id, 3, inOct(9));
    const sep = await mkTicket(teamA);
    await rate(sep.id, 5, new Date("2026-09-15T12:00:00Z")); // fora do período, dentro da tendência
  }

  it("média, quantidade e distribuição de todas as equipes no período", async () => {
    await seedRatings();
    const c = await metrics.queryCsat({ teamIds: null }, RANGE, MONTHS, TZ);
    expect(c.count).toBe(6);
    expect(c.average).toBeCloseTo(19 / 6, 5);
    expect(c.distribution).toEqual([
      { stars: 1, count: 1 }, { stars: 2, count: 1 }, { stars: 3, count: 1 }, { stars: 4, count: 2 }, { stars: 5, count: 1 },
    ]);
  });

  it("o escopo por equipe nunca soma chamados de outra equipe", async () => {
    await seedRatings();
    const a = await metrics.queryCsat({ teamIds: [teamA] }, RANGE, MONTHS, TZ);
    expect(a.count).toBe(5);
    expect(a.average).toBeCloseTo(3.2, 5);
    const b = await metrics.queryCsat({ teamIds: [teamB] }, RANGE, MONTHS, TZ);
    expect(b.count).toBe(1);
    expect(b.average).toBe(3);
  });

  it("a tendência cobre os meses pedidos, inclusive o que não tem nota", async () => {
    await seedRatings();
    const c = await metrics.queryCsat({ teamIds: null }, RANGE, MONTHS, TZ);
    expect(c.trend.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(c.trend[0]).toEqual({ month: "2026-08", average: null, count: 0 });
    expect(c.trend[1]).toMatchObject({ month: "2026-09", count: 1, average: 5 });
    expect(c.trend[2]).toMatchObject({ month: "2026-10", count: 6 });
  });

  it("sem avaliações ou sem equipes: zeros e nulos, distribuição completa", async () => {
    const c = await metrics.queryCsat({ teamIds: null }, RANGE, MONTHS, TZ);
    expect(c).toMatchObject({ average: null, count: 0 });
    expect(c.distribution).toHaveLength(5);
    const none = await metrics.queryCsat({ teamIds: [] }, RANGE, MONTHS, TZ);
    expect(none.count).toBe(0);
  });
});

describe("queryAiAssist", () => {
  async function seedAssist() {
    const aTickets = [];
    for (let i = 0; i < 11; i++) aTickets.push(await mkTicket(teamA, { status: "OPEN" }));
    const statuses = ["ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "ACCEPTED", "EDITED", "EDITED", "REJECTED", "REJECTED", "PENDING"] as const;
    for (const [i, t] of aTickets.entries()) {
      await db.aiSuggestion.create({ data: { ticketId: t.id, kind: "TRIAGE", payload: {}, confidence: 0.9, status: statuses[i], createdAt: inOct(3 + (i % 20)) } });
    }
    const b = await mkTicket(teamB, { status: "OPEN" });
    await db.aiSuggestion.create({ data: { ticketId: b.id, kind: "TRIAGE", payload: {}, confidence: 0.9, status: "ACCEPTED", createdAt: inOct(4) } });
    // duplicados
    await db.aiSuggestion.create({ data: { ticketId: aTickets[0].id, kind: "DUPLICATE", payload: {}, confidence: 0.9, status: "REJECTED", createdAt: inOct(5) } });
    await db.aiSuggestion.create({ data: { ticketId: aTickets[1].id, kind: "DUPLICATE", payload: {}, confidence: 0.9, status: "PENDING", createdAt: inOct(5) } });
    await db.aiSuggestion.create({ data: { ticketId: b.id, kind: "DUPLICATE", payload: {}, confidence: 0.9, status: "PENDING", createdAt: inOct(5) } });
    // eventos
    const ev = (ticketId: string, type: string, day = 6) => db.ticketEvent.create({ data: { ticketId, type, data: {}, createdAt: inOct(day) } });
    for (const t of aTickets.slice(0, 3)) await ev(t.id, "AI_DRAFT");
    await ev(aTickets[0].id, "AI_DRAFT_PUBLISHED");
    await ev(b.id, "AI_DRAFT");
    await ev(aTickets[1].id, "AI_SUMMARY");
    await ev(aTickets[2].id, "AI_SUMMARY");
    await ev(b.id, "AI_SUMMARY");
    await ev(aTickets[3].id, "AI_DRAFT", 20); // dentro do período
    await db.ticketEvent.create({ data: { ticketId: aTickets[4].id, type: "AI_DRAFT", data: {}, createdAt: new Date("2026-09-10T12:00:00Z") } }); // fora
    // incidentes
    const g1 = await db.incidentGroup.create({ data: { title: "g1", detectedAt: inOct(7) } });
    const g2 = await db.incidentGroup.create({ data: { title: "g2", detectedAt: inOct(8) } });
    await db.ticket.update({ where: { id: aTickets[5].id }, data: { incidentGroupId: g1.id } });
    await db.ticket.update({ where: { id: b.id }, data: { incidentGroupId: g1.id } });
    await db.ticket.update({ where: { id: (await mkTicket(teamB)).id }, data: { incidentGroupId: g2.id } });
  }

  it("equipe A: triagem com taxa de aceite, rascunhos, duplicados, resumos e incidentes", async () => {
    await seedAssist();
    const r = await metrics.queryAiAssist({ teamIds: [teamA] }, RANGE);
    expect(r.triage).toEqual({ suggested: 11, accepted: 6, edited: 2, rejected: 2, pending: 1, acceptRate: 0.8 });
    expect(r.drafts).toEqual({ generated: 4, published: 1 });
    expect(r.duplicates).toEqual({ suggested: 2, dismissed: 1 });
    expect(r.summaries).toBe(2);
    expect(r.incidents).toBe(1);
  });

  it("todas as equipes somam tudo, e equipe sem dados fica zerada", async () => {
    await seedAssist();
    const all = await metrics.queryAiAssist({ teamIds: null }, RANGE);
    expect(all.triage.suggested).toBe(12);
    expect(all.drafts.generated).toBe(5);
    expect(all.duplicates.suggested).toBe(3);
    expect(all.summaries).toBe(3);
    expect(all.incidents).toBe(2);
    const none = await metrics.queryAiAssist({ teamIds: [] }, RANGE);
    expect(none.triage).toEqual({ suggested: 0, accepted: 0, edited: 0, rejected: 0, pending: 0, acceptRate: null });
    expect(none.incidents).toBe(0);
  });

  it("sem sugestões decididas a taxa de aceite é nula", async () => {
    const t = await mkTicket(teamA, { status: "OPEN" });
    await db.aiSuggestion.create({ data: { ticketId: t.id, kind: "TRIAGE", payload: {}, confidence: 0.9, createdAt: inOct(3) } });
    const r = await metrics.queryAiAssist({ teamIds: [teamA] }, RANGE);
    expect(r.triage).toMatchObject({ suggested: 1, pending: 1, acceptRate: null });
  });
});

describe("queryAiUsage", () => {
  async function seedUsage() {
    for (const ms of [100, 200, 300, 400]) await log({ latencyMs: ms });
    await log({ outcome: "FAILED", latencyMs: 50, costUsd: "0", inputTokens: 0, outputTokens: 0 });
    await log({ jobType: "embed", outcome: "BUDGET", latencyMs: 0, costUsd: "0", inputTokens: 0, outputTokens: 0 });
    await log({ jobType: "draft", inputTokens: 500, outputTokens: 50, costUsd: "0.2", latencyMs: 1000 });
    await log({ createdAt: new Date("2026-09-20T12:00:00Z"), costUsd: "5" }); // fora do período
  }

  it("totais e por tarefa: chamadas, falhas, barradas, tokens e custo", async () => {
    await seedUsage();
    const u = await metrics.queryAiUsage(RANGE, TZ);
    expect(u.totals).toMatchObject({ calls: 7, failed: 1, blocked: 1, inputTokens: 900, outputTokens: 90 });
    expect(u.totals.costUsd).toBeCloseTo(0.24, 6);
    const triage = u.byTask.find((t) => t.jobType === "triage")!;
    expect(triage).toMatchObject({ calls: 5, failed: 1, blocked: 0 });
    expect(u.byTask.map((t) => t.jobType).sort()).toEqual(["draft", "embed", "triage"]);
  });

  it("latência mediana e p95 só das chamadas com sucesso", async () => {
    await seedUsage();
    const triage = (await metrics.queryAiUsage(RANGE, TZ)).byTask.find((t) => t.jobType === "triage")!;
    expect(triage.p50Ms).toBe(250);
    expect(triage.p95Ms).toBe(385);
    const embed = (await metrics.queryAiUsage(RANGE, TZ)).byTask.find((t) => t.jobType === "embed")!;
    expect(embed.p50Ms).toBeNull(); // só havia chamada barrada
  });

  it("custo por dia usa o dia local (23h30 ainda é o dia anterior; 00h30 já é o seguinte)", async () => {
    await log({ createdAt: new Date("2026-10-11T02:30:00Z"), costUsd: "0.10" }); // 10/10 23:30 em São Paulo
    await log({ createdAt: new Date("2026-10-11T03:30:00Z"), costUsd: "0.25" }); // 11/10 00:30
    await log({ createdAt: new Date("2026-10-10T15:00:00Z"), costUsd: "0.05" });
    const days = (await metrics.queryAiUsage(RANGE, TZ)).costByDay;
    expect(days.map((d) => d.day)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(days[0].costUsd).toBeCloseTo(0.15, 6);
    expect(days[1].costUsd).toBeCloseTo(0.25, 6);
  });

  it("sem execuções: tudo zerado", async () => {
    const u = await metrics.queryAiUsage(RANGE, TZ);
    expect(u.totals).toMatchObject({ calls: 0, failed: 0, blocked: 0, costUsd: 0 });
    expect(u.byTask).toEqual([]);
    expect(u.costByDay).toEqual([]);
  });
});

describe("queryHasDemo", () => {
  it("só é verdadeiro com linha de demonstração dentro do período e do escopo", async () => {
    expect(await metrics.queryHasDemo({ teamIds: null }, RANGE, true)).toBe(false);
    const t = await mkTicket(teamA);
    await rate(t.id, 5, inOct(5), true);
    expect(await metrics.queryHasDemo({ teamIds: [teamA] }, RANGE, false)).toBe(true);
    expect(await metrics.queryHasDemo({ teamIds: [teamB] }, RANGE, false)).toBe(false);
    expect(await metrics.queryHasDemo({ teamIds: [teamA] }, { from: new Date("2026-01-01T03:00:00Z"), to: new Date("2026-02-01T03:00:00Z") }, false)).toBe(false);
    await log({ demo: true });
    expect(await metrics.queryHasDemo({ teamIds: [teamB] }, RANGE, true)).toBe(true); // uso de IA é global
    expect(await metrics.queryHasDemo({ teamIds: [teamB] }, RANGE, false)).toBe(false); // líder não vê uso de IA
  });
});

describe("getDashboard", () => {
  it("o líder recebe satisfação e IA no atendimento da própria equipe, nunca o uso e custo de IA", async () => {
    const t = await mkTicket(teamA, { resolvedAt: new Date(), closedAt: new Date() });
    await rate(t.id, 4, new Date());
    const other = await mkTicket(teamB);
    await rate(other.id, 1, new Date());
    await log({ createdAt: new Date() });
    const data = await dash.getDashboard(leadA, { period: "this_month" });
    expect(data.csat.count).toBe(1);
    expect(data.csat.average).toBe(4);
    expect(data.aiUsage).toBeUndefined();
  });

  it("o admin recebe o uso e custo de IA e o cache não vaza isso ao líder", async () => {
    await log({ createdAt: new Date() });
    const asAdmin = await dash.getDashboard(admin, { period: "this_month" });
    expect(asAdmin.aiUsage?.totals.calls).toBe(1);
    const asLead = await dash.getDashboard(leadA, { period: "this_month" });
    expect(asLead.aiUsage).toBeUndefined();
    const asAdminAgain = await dash.getDashboard(admin, { period: "this_month" });
    expect(asAdminAgain.aiUsage?.totals.calls).toBe(1);
  });

  it("hasDemoData acompanha as linhas de demonstração do período", async () => {
    const t = await mkTicket(teamA, { resolvedAt: new Date(), closedAt: new Date() });
    await rate(t.id, 5, new Date(), true);
    expect((await dash.getDashboard(leadA, { period: "this_month" })).hasDemoData).toBe(true);
    expect((await dash.getDashboard(admin, { period: "last_month" })).hasDemoData).toBe(false);
  });
});
