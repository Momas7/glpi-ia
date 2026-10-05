import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let sla: typeof import("@/modules/sla");
let session: typeof import("@/modules/auth/session");
let admin: SessionUser, agent: SessionUser;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = ORIGIN;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  sla = await import("@/modules/sla");
  session = await import("@/modules/auth/session");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.ticketEvent.deleteMany();
  await db.ticket.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.slaPolicy.deleteMany();
  await db.businessHours.deleteMany();
  await db.holiday.deleteMany();
  await db.slaPolicy.create({ data: { priority: "LOW", firstResponseMinutes: 480, resolutionMinutes: 2400 } });
  await db.businessHours.createMany({ data: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 1080 })) });
  sla.invalidateCalendarCache();
  const mk = async (name: string, role: SessionUser["role"]) => {
    const u = await db.user.create({ data: { name, email: `${name.toLowerCase()}@x.com`, role } });
    cookie[name] = `session=${await session.createSession(u.id)}`;
    return { id: u.id, name, email: u.email, role, teamIds: [] } as SessionUser;
  };
  admin = await mk("Admin", "ADMIN");
  agent = await mk("Agente", "AGENT");
});

const actions = async () => (await db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);

describe("políticas", () => {
  it("atualiza, audita e não mexe em chamado já aberto", async () => {
    const t = await (await import("@/modules/tickets")).createTicket(admin, { title: "Antigo", description: "d", priority: "LOW" });
    const before = (await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).resolutionDue;
    await sla.updatePolicies(admin, [{ priority: "LOW", firstResponseMinutes: 240, resolutionMinutes: 2880 }]);
    expect((await db.slaPolicy.findUniqueOrThrow({ where: { priority: "LOW" } })).resolutionMinutes).toBe(2880);
    expect((await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).resolutionDue).toEqual(before);
    expect(await actions()).toEqual(["sla.policy_update"]);
  });

  it("1ª resposta maior que a resolução ou fora da faixa → 400; não-admin → 403", async () => {
    await expect(sla.updatePolicies(admin, [{ priority: "LOW", firstResponseMinutes: 600, resolutionMinutes: 300 }])).rejects.toMatchObject({ status: 400 });
    await expect(sla.updatePolicies(admin, [{ priority: "LOW", firstResponseMinutes: 0, resolutionMinutes: 300 }])).rejects.toMatchObject({ status: 400 });
    await expect(sla.updatePolicies(agent, [{ priority: "LOW", firstResponseMinutes: 60, resolutionMinutes: 300 }])).rejects.toMatchObject({ status: 403 });
  });
});

describe("expediente", () => {
  it("substitui o expediente e o calendário enxerga na hora", async () => {
    await sla.loadCalendar(); // aquece o cache
    await sla.updateBusinessHours(admin, [{ weekday: 6, startMinute: 540, endMinute: 780 }]);
    const cal = await sla.loadCalendar();
    expect([...cal.hours.keys()]).toEqual([6]);
    expect(await actions()).toEqual(["sla.hours_update"]);
  });

  it("vazio, fim antes do início, fora do dia ou dia repetido → 400", async () => {
    for (const days of [
      [],
      [{ weekday: 1, startMinute: 600, endMinute: 600 }],
      [{ weekday: 1, startMinute: 600, endMinute: 1500 }],
      [{ weekday: 7, startMinute: 480, endMinute: 1080 }],
      [
        { weekday: 1, startMinute: 480, endMinute: 1080 },
        { weekday: 1, startMinute: 600, endMinute: 700 },
      ],
    ]) {
      await expect(sla.updateBusinessHours(admin, days)).rejects.toMatchObject({ status: 400 });
    }
    expect(await db.businessHours.count()).toBe(5);
  });
});

describe("feriados", () => {
  it("adiciona (repetido → 409), o calendário enxerga na hora, e remove", async () => {
    await sla.loadCalendar();
    const h = await sla.addHoliday(admin, { date: "2026-11-21", name: "Aniversário da cidade" });
    await expect(sla.addHoliday(admin, { date: "2026-11-21", name: "De novo" })).rejects.toMatchObject({ status: 409 });
    expect((await sla.loadCalendar()).holidays.has("2026-11-21")).toBe(true);
    await sla.removeHoliday(admin, h.id);
    expect((await sla.loadCalendar()).holidays.has("2026-11-21")).toBe(false);
    expect(await actions()).toEqual(["holiday.create", "holiday.delete"]);
  });
});

describe("configuração", () => {
  it("indica quando o SLA não está configurado (sem políticas ou sem expediente)", async () => {
    expect((await sla.getSlaSettings(admin)).configured).toBe(false); // só há política para LOW
    await sla.updatePolicies(admin, (["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((priority) => ({ priority, firstResponseMinutes: 60, resolutionMinutes: 240 })));
    expect((await sla.getSlaSettings(admin)).configured).toBe(true);
    await db.businessHours.deleteMany();
    expect((await sla.getSlaSettings(admin)).configured).toBe(false);
  });
});

describe("rotas", () => {
  async function call(mod: string, method: "PUT" | "POST" | "DELETE", c: string, body?: unknown, params: Record<string, string> = {}) {
    const m = await import(mod);
    const headers: Record<string, string> = { cookie: c, origin: ORIGIN };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = new Request(`${ORIGIN}/api/x`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return m[method](r, { params: Promise.resolve(params) }) as Promise<Response>;
  }

  it("não-admin → 403; admin salva políticas, expediente e feriado", async () => {
    const policies = { policies: [{ priority: "LOW", firstResponseMinutes: 240, resolutionMinutes: 2880 }] };
    expect((await call("@/app/api/admin/sla/policies/route", "PUT", cookie.Agente, policies)).status).toBe(403);
    expect((await call("@/app/api/admin/sla/policies/route", "PUT", cookie.Admin, policies)).status).toBe(200);
    expect((await call("@/app/api/admin/sla/hours/route", "PUT", cookie.Admin, { days: [{ weekday: 1, startMinute: 480, endMinute: 1080 }] })).status).toBe(200);
    const created = await call("@/app/api/admin/sla/holidays/route", "POST", cookie.Admin, { date: "2026-12-24", name: "Véspera de Natal" });
    expect(created.status).toBe(201);
    const { holiday } = await created.json();
    expect((await call("@/app/api/admin/sla/holidays/[id]/route", "DELETE", cookie.Admin, undefined, { id: holiday.id })).status).toBe(200);
    expect((await call("@/app/api/admin/sla/holidays/route", "POST", cookie.Admin, { date: "24/12/2026", name: "x" })).status).toBe(400);
  });
});
