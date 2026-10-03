import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../prisma/seed";
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

describe("seed fictício: usuários e chamados demo", () => {
  it("sem SEED_DEMO_PASSWORD não cria usuários nem chamados", async () => {
    delete process.env.SEED_DEMO_PASSWORD;
    await seed(db);
    expect(await db.user.count()).toBe(0);
  });

  it("com a senha demo cria admin/agente/solicitante e ~30 chamados, de forma idempotente", async () => {
    process.env.SEED_DEMO_PASSWORD = "Demo-Fict1cia-Senha";
    await seed(db);
    await seed(db);
    const users = await db.user.findMany({ orderBy: { email: "asc" } });
    expect(users.map((u) => [u.email, u.role])).toEqual([
      ["admin@demo.test", "ADMIN"],
      ["agente@demo.test", "AGENT"],
      ["solicitante@demo.test", "REQUESTER"],
    ]);
    expect(users.every((u) => u.passwordHash?.startsWith("$argon2id$"))).toBe(true);
    const tickets = await db.ticket.count({ where: { NOT: { title: { startsWith: "Histórico " } } } });
    expect(tickets).toBeGreaterThanOrEqual(25);
    expect(tickets).toBeLessThanOrEqual(35);
    const agent = users.find((u) => u.role === "AGENT")!;
    expect(await db.teamMember.count({ where: { userId: agent.id } })).toBeGreaterThan(0);
    delete process.env.SEED_DEMO_PASSWORD;
  });
});

describe("seed fictício: histórico de 6 meses para o dashboard", () => {
  it("cria ~180 chamados resolvidos espalhados em 6 meses, coerentes e idempotentes", async () => {
    process.env.SEED_DEMO_PASSWORD = "Demo-Fict1cia-Senha";
    await seed(db);
    const history = async () => db.ticket.findMany({ where: { title: { startsWith: "Histórico " } } });
    const first = await history();
    expect(first.length).toBeGreaterThanOrEqual(150);
    expect(first.length).toBeLessThanOrEqual(220);

    const months = new Set(first.map((t) => t.createdAt.toISOString().slice(0, 7)));
    expect(months.size).toBeGreaterThanOrEqual(6);

    expect(first.every((t) => t.status === "RESOLVED" || t.status === "CLOSED")).toBe(true);
    expect(first.every((t) => t.resolvedAt && t.resolvedAt >= t.createdAt)).toBe(true);
    expect(first.every((t) => t.resolutionDue && t.firstRespondedAt && t.resolutionBusinessMinutes && t.firstResponseBusinessMinutes)).toBe(true);
    expect(first.every((t) => t.firstRespondedAt! <= t.resolvedAt!)).toBe(true);

    const inTime = first.filter((t) => t.resolvedAt! <= t.resolutionDue!).length / first.length;
    expect(inTime).toBeGreaterThanOrEqual(0.7);
    expect(inTime).toBeLessThanOrEqual(0.9);

    await seed(db);
    expect((await history()).length).toBe(first.length);
    delete process.env.SEED_DEMO_PASSWORD;
  });
});

describe("seed: SLA", () => {
  it("políticas, expediente e feriados, de forma idempotente", async () => {
    await seed(db);
    await seed(db);
    const policies = await db.slaPolicy.findMany({ orderBy: { resolutionMinutes: "asc" } });
    expect(policies.map((p) => [p.priority, p.firstResponseMinutes, p.resolutionMinutes])).toEqual([
      ["CRITICAL", 60, 240],
      ["HIGH", 120, 480],
      ["MEDIUM", 240, 1440],
      ["LOW", 480, 2400],
    ]);
    const hours = await db.businessHours.findMany({ orderBy: { weekday: "asc" } });
    expect(hours.map((h) => [h.weekday, h.startMinute, h.endMinute])).toEqual([1, 2, 3, 4, 5].map((d) => [d, 480, 1080]));
    const year = new Date().getFullYear();
    const holidays = await db.holiday.findMany();
    expect(holidays.length).toBe(39);
    expect(holidays.some((h) => h.date.toISOString().startsWith(`${year}-12-25`))).toBe(true);
  });
});

describe("seed fictício", () => {
  it("é idempotente: rodar duas vezes não duplica equipes nem categorias", async () => {
    await seed(db);
    await seed(db);

    const teams = await db.team.findMany({ orderBy: { name: "asc" } });
    expect(teams.map((t) => t.name)).toEqual(["Infraestrutura", "Sistemas", "Suporte N1"]);

    const roots = await db.category.findMany({ where: { parentId: null }, orderBy: { name: "asc" } });
    expect(roots.map((c) => c.name)).toEqual(["Acessos", "Hardware", "Rede", "Software"]);
  });

  it("associa a equipe padrão de cada categoria", async () => {
    const rede = await db.category.findFirstOrThrow({
      where: { name: "Rede", parentId: null },
      include: { defaultTeam: true },
    });
    expect(rede.defaultTeam?.name).toBe("Infraestrutura");
  });
});
