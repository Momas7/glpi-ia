import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { stopQueue } from "@/lib/queue";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

let testDb: TestDb;
let db: Db;
let svc: typeof import("@/modules/tickets");
let requester: SessionUser, other: SessionUser, agent: SessionUser, lead: SessionUser, admin: SessionUser;
let teamId: string;

const session = (u: { id: string; name: string; email: string }, role: SessionUser["role"], teamIds: string[] = []): SessionUser => ({
  id: u.id, name: u.name, email: u.email, role, teamIds,
});

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, AI_ENABLED: "true" });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  svc = await import("@/modules/tickets");
});

afterAll(async () => {
  await stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.$executeRawUnsafe(`DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job WHERE name = 'ai.index_ticket'; END IF; END $$`);
  await db.ticketRating.deleteMany();
  await db.comment.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  teamId = (await db.team.create({ data: { name: "T1" } })).id;
  const mk = (name: string, role: SessionUser["role"], teams: string[] = []) =>
    db.user.create({ data: { name, email: `${name}@x.com`, role, teams: { create: teams.map((t) => ({ teamId: t })) } } });
  requester = session(await mk("req", "REQUESTER"), "REQUESTER");
  other = session(await mk("other", "REQUESTER"), "REQUESTER");
  agent = session(await mk("agent", "AGENT", [teamId]), "AGENT", [teamId]);
  lead = session(await mk("lead", "TEAM_LEAD", [teamId]), "TEAM_LEAD", [teamId]);
  admin = session(await mk("admin", "ADMIN"), "ADMIN");
});

const jobs = async () => {
  const exists = await db.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('pgboss.job') IS NOT NULL AS ok`;
  if (!exists[0].ok) return [];
  return db.$queryRaw<{ data: { ticketId: string } }[]>`SELECT data FROM pgboss.job WHERE name = 'ai.index_ticket'`;
};

const ticketIn = (status: "RESOLVED" | "CLOSED" | "OPEN", extra: Record<string, unknown> = {}) =>
  db.ticket.create({
    data: {
      title: "Impressora", description: "d", requesterId: requester.id, teamId, status,
      resolution: status === "OPEN" ? null : "Reiniciei o serviço de impressão.",
      resolvedAt: status === "OPEN" ? null : new Date(),
      closedAt: status === "CLOSED" ? new Date() : null,
      ...extra,
    },
  });

describe("rateTicket", () => {
  it("o solicitante avalia um chamado Resolvido ou Fechado e a nota é gravada com evento e indexação", async () => {
    const a = await ticketIn("RESOLVED");
    const b = await ticketIn("CLOSED");
    const r = await svc.rateTicket(requester, a.id, { stars: 5, comment: "Atendimento excelente" });
    expect(r).toMatchObject({ stars: 5, comment: "Atendimento excelente", raterId: requester.id });
    await svc.rateTicket(requester, b.id, { stars: 3 });
    const ev = await db.ticketEvent.findFirstOrThrow({ where: { ticketId: a.id, type: "RATED" } });
    expect(ev.data).toEqual({ stars: 5 }); // o comentário não vai no evento
    expect((await jobs()).map((j) => j.data.ticketId).sort()).toEqual([a.id, b.id].sort());
  });

  it("chamado em andamento não pode ser avaliado (403)", async () => {
    const t = await ticketIn("OPEN");
    await expect(svc.rateTicket(requester, t.id, { stars: 5 })).rejects.toMatchObject({ status: 403 });
  });

  it("fechado há mais de 30 dias: 409; há 29 dias: ok", async () => {
    const day = 24 * 3600 * 1000;
    const old = await ticketIn("CLOSED", { closedAt: new Date(Date.now() - 31 * day) });
    const recent = await ticketIn("CLOSED", { closedAt: new Date(Date.now() - 29 * day) });
    await expect(svc.rateTicket(requester, old.id, { stars: 4 })).rejects.toMatchObject({ status: 409 });
    await expect(svc.rateTicket(requester, recent.id, { stars: 4 })).resolves.toMatchObject({ stars: 4 });
  });

  it("a segunda nota do mesmo chamado é recusada (409) e a primeira permanece", async () => {
    const t = await ticketIn("RESOLVED");
    await svc.rateTicket(requester, t.id, { stars: 5 });
    await expect(svc.rateTicket(requester, t.id, { stars: 1 })).rejects.toMatchObject({ status: 409 });
    expect((await db.ticketRating.findUniqueOrThrow({ where: { ticketId: t.id } })).stars).toBe(5);
  });

  it("nota fora de 1 a 5, quebrada ou comentário longo: 400", async () => {
    const t = await ticketIn("RESOLVED");
    for (const stars of [0, 6, 1.5, -1]) {
      await expect(svc.rateTicket(requester, t.id, { stars })).rejects.toThrow();
    }
    await expect(svc.rateTicket(requester, t.id, { stars: 4, comment: "x".repeat(1001) })).rejects.toThrow();
    expect(await db.ticketRating.count()).toBe(0);
  });

  it("técnico, líder e admin não avaliam (403); outro solicitante recebe 404", async () => {
    const t = await ticketIn("RESOLVED");
    for (const who of [agent, lead, admin]) {
      await expect(svc.rateTicket(who, t.id, { stars: 5 })).rejects.toMatchObject({ status: 403 });
    }
    await expect(svc.rateTicket(other, t.id, { stars: 5 })).rejects.toMatchObject({ status: 404 });
    expect(await db.ticketRating.count()).toBe(0);
  });

  it("o comentário é guardado como texto, sem alteração", async () => {
    const t = await ticketIn("RESOLVED");
    const r = await svc.rateTicket(requester, t.id, { stars: 2, comment: "<script>alert(1)</script> ruim" });
    expect(r.comment).toBe("<script>alert(1)</script> ruim");
  });
});

describe("getRating", () => {
  it("solicitante e equipe com acesso leem a nota; quem não vê o chamado recebe 404", async () => {
    const t = await ticketIn("RESOLVED");
    await svc.rateTicket(requester, t.id, { stars: 4, comment: "ok" });
    expect(await svc.getRating(requester, t.id)).toMatchObject({ stars: 4 });
    expect(await svc.getRating(agent, t.id)).toMatchObject({ stars: 4 });
    expect(await svc.getRating(lead, t.id)).toMatchObject({ stars: 4 });
    await expect(svc.getRating(other, t.id)).rejects.toMatchObject({ status: 404 });
  });

  it("sem avaliação devolve null", async () => {
    const t = await ticketIn("RESOLVED");
    expect(await svc.getRating(requester, t.id)).toBeNull();
  });
});

describe("confirmTicket com avaliação", () => {
  it("confirma e grava a nota na mesma operação", async () => {
    const t = await ticketIn("RESOLVED");
    await svc.confirmTicket(requester, t.id, { stars: 5, comment: "Muito bom" });
    expect(await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "CLOSED" });
    expect(await db.ticketRating.findUniqueOrThrow({ where: { ticketId: t.id } })).toMatchObject({ stars: 5, comment: "Muito bom" });
  });

  it("nota inválida: a confirmação inteira falha e o chamado continua Resolvido", async () => {
    const t = await ticketIn("RESOLVED");
    await expect(svc.confirmTicket(requester, t.id, { stars: 9 })).rejects.toThrow();
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("RESOLVED");
    expect(await db.ticketRating.count()).toBe(0);
  });

  it("sem nota funciona como antes", async () => {
    const t = await ticketIn("RESOLVED");
    await svc.confirmTicket(requester, t.id);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("CLOSED");
    expect(await db.ticketRating.count()).toBe(0);
  });

  it("chamado já avaliado: a confirmação com nota é recusada sem fechar", async () => {
    const t = await ticketIn("RESOLVED");
    await svc.rateTicket(requester, t.id, { stars: 4 });
    await expect(svc.confirmTicket(requester, t.id, { stars: 5 })).rejects.toMatchObject({ status: 409 });
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("RESOLVED");
  });
});
