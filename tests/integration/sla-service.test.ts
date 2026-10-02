import { TZDate } from "@date-fns/tz";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const SP = "America/Sao_Paulo";
const sp = (d: number, h: number, min = 0) => new Date(new TZDate(2026, 9, d, h, min, SP).getTime()); // outubro/2026, dia 5 = segunda
let testDb: TestDb;
let db: Db;
let sla: typeof import("@/modules/sla");
let svc: typeof import("@/modules/tickets");
let req: SessionUser, agent: SessionUser;
let teamId: string;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_TIMEZONE = SP;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  sla = await import("@/modules/sla");
  svc = await import("@/modules/tickets");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.teamMember.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  await db.slaPolicy.deleteMany();
  await db.businessHours.deleteMany();
  await db.holiday.deleteMany();
  await db.slaPolicy.createMany({
    data: [
      { priority: "CRITICAL", firstResponseMinutes: 60, resolutionMinutes: 240 },
      { priority: "MEDIUM", firstResponseMinutes: 240, resolutionMinutes: 1440 },
    ],
  });
  await db.businessHours.createMany({ data: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 1080 })) });
  sla.invalidateCalendarCache();
  teamId = (await db.team.create({ data: { name: "T1" } })).id;
  const r = await db.user.create({ data: { name: "Req", email: "req@x.com", role: "REQUESTER" } });
  const a = await db.user.create({ data: { name: "Agente", email: "agente@x.com", role: "AGENT", teams: { create: [{ teamId }] } } });
  req = { id: r.id, name: r.name, email: r.email, role: "REQUESTER", teamIds: [] };
  agent = { id: a.id, name: a.name, email: a.email, role: "AGENT", teamIds: [teamId] };
});

async function ticketAt(createdAt: Date, priority: "MEDIUM" | "CRITICAL" | "LOW" = "MEDIUM") {
  const t = await db.ticket.create({ data: { title: "t", description: "d", requesterId: req.id, teamId, priority, createdAt } });
  await db.$transaction((tx) => sla.slaOnCreate(tx, t.id, createdAt));
  return t.id;
}
const row = (id: string) => db.ticket.findUniqueOrThrow({ where: { id } });
const status = (id: string, from: string, to: string, now: Date) =>
  db.$transaction(async (tx) => {
    await tx.ticket.update({ where: { id }, data: { status: to as never } });
    await sla.slaOnStatusChange(tx, id, from as never, to as never, now);
  });

describe("prazos", () => {
  it("MEDIUM criado segunda 9h: 1ª resposta segunda 13h, resolução quarta 13h", async () => {
    const t = await row(await ticketAt(sp(5, 9)));
    expect([t.slaFirstResponseMinutes, t.slaResolutionMinutes]).toEqual([240, 1440]);
    expect(t.firstResponseDue).toEqual(sp(5, 13));
    expect(t.resolutionDue).toEqual(sp(7, 13));
  });

  it("Pendente de segunda 10h a terça 10h soma 600 min e empurra a resolução para quinta 13h", async () => {
    const id = await ticketAt(sp(5, 9));
    await status(id, "NEW", "OPEN", sp(5, 9, 30));
    await status(id, "OPEN", "PENDING", sp(5, 10));
    expect((await row(id)).pausedAt).toEqual(sp(5, 10));
    await status(id, "PENDING", "OPEN", sp(6, 10));
    const t = await row(id);
    expect([t.pausedMinutes, t.pausedAt]).toEqual([600, null]);
    expect(t.resolutionDue).toEqual(sp(8, 13));
  });

  it("resolver grava o tempo real; reabrir conta o tempo resolvido como pausa e zera os alertas", async () => {
    const id = await ticketAt(sp(5, 9));
    await status(id, "NEW", "OPEN", sp(5, 9, 30));
    await status(id, "OPEN", "RESOLVED", sp(5, 12));
    expect((await row(id)).resolutionBusinessMinutes).toBe(180);
    await db.ticket.update({ where: { id }, data: { slaWarnedAt: new Date(), slaBreachedAt: new Date() } });
    await status(id, "RESOLVED", "OPEN", sp(6, 9));
    const t = await row(id);
    expect(t.pausedMinutes).toBe(420); // segunda 12h–18h + terça 8h–9h
    expect([t.slaWarnedAt, t.slaBreachedAt, t.pausedAt]).toEqual([null, null, null]);
  });

  it("mudar MEDIUM → CRITICAL recalcula para um prazo mais curto", async () => {
    const id = await ticketAt(sp(5, 9));
    await db.$transaction(async (tx) => {
      await tx.ticket.update({ where: { id }, data: { priority: "CRITICAL" } });
      await sla.slaOnPriorityChange(tx, id, sp(5, 9, 30));
    });
    const t = await row(id);
    expect(t.slaResolutionMinutes).toBe(240);
    expect(t.resolutionDue).toEqual(sp(5, 13));
  });

  it("1ª resposta: só comentário público de técnico, uma vez", async () => {
    const id = await ticketAt(sp(5, 9));
    const comment = (author: SessionUser, internal: boolean, now: Date) =>
      db.$transaction((tx) => sla.slaOnComment(tx, id, { id: author.id, role: author.role }, internal, now));
    await comment(agent, true, sp(5, 9, 30));
    await comment(req, false, sp(5, 9, 40));
    expect((await row(id)).firstRespondedAt).toBeNull();
    await comment(agent, false, sp(5, 10));
    await comment(agent, false, sp(5, 11));
    const t = await row(id);
    expect([t.firstRespondedAt, t.firstResponseBusinessMinutes]).toEqual([sp(5, 10), 60]);
  });

  it("sem política para a prioridade: sem prazos e sem erro", async () => {
    const t = await row(await ticketAt(sp(5, 9), "LOW"));
    expect([t.resolutionDue, t.firstResponseDue]).toEqual([null, null]);
  });

  it("operações reais: criar preenche o prazo; Pendente marca a pausa", async () => {
    const t = await svc.createTicket(req, { title: "Real", description: "d" });
    expect((await row(t.id)).resolutionDue).not.toBeNull();
    await db.ticket.update({ where: { id: t.id }, data: { teamId } });
    await svc.changeStatus(agent, t.id, "OPEN");
    await svc.changeStatus(agent, t.id, "PENDING");
    expect((await row(t.id)).pausedAt).not.toBeNull();
    await svc.addComment(agent, t.id, { body: "Olá", internal: false });
    expect((await row(t.id)).firstRespondedAt).not.toBeNull();
  });
});
