import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let admin: typeof import("@/modules/admin");
let session: typeof import("@/modules/auth/session");
let ana: SessionUser, caio: SessionUser, duda: SessionUser, inativo: SessionUser;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = ORIGIN;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  admin = await import("@/modules/admin");
  session = await import("@/modules/auth/session");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.session.deleteMany();
  await db.teamMember.deleteMany();
  await db.category.deleteMany();
  await db.team.deleteMany();
  await db.user.deleteMany();
  const mk = async (name: string, role: SessionUser["role"], active = true) => {
    const u = await db.user.create({ data: { name, email: `${name.toLowerCase()}@x.com`, role, active } });
    cookie[name] = `session=${await session.createSession(u.id)}`;
    return { id: u.id, name, email: u.email, role, teamIds: [] } as SessionUser;
  };
  ana = await mk("Ana", "ADMIN");
  caio = await mk("Caio", "AGENT");
  duda = await mk("Duda", "REQUESTER");
  inativo = await mk("Inativo", "AGENT", false);
});

async function route(mod: string, method: "GET" | "POST" | "PATCH" | "DELETE", c: string, params: Record<string, string> = {}, body?: unknown) {
  const m = await import(mod);
  const headers: Record<string, string> = { cookie: c, "x-forwarded-for": "3.3.3.3" };
  if (method !== "GET") headers.origin = ORIGIN;
  if (body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${ORIGIN}/api/admin/x`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return m[method](req, { params: Promise.resolve(params) }) as Promise<Response>;
}

const actions = async () => (await db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);

describe("equipes e membros", () => {
  it("cria, renomeia (nome repetido → 409), adiciona e remove membro, com auditoria", async () => {
    const t = await admin.createTeam(ana, "Infraestrutura");
    await admin.createTeam(ana, "Sistemas");
    await expect(admin.renameTeam(ana, t.id, "Sistemas")).rejects.toMatchObject({ status: 409 });
    await expect(admin.createTeam(ana, "Sistemas")).rejects.toMatchObject({ status: 409 });
    await admin.renameTeam(ana, t.id, "Infra");
    await admin.addMember(ana, t.id, caio.id);
    await admin.addMember(ana, t.id, caio.id); // idempotente
    expect(await db.teamMember.count({ where: { teamId: t.id } })).toBe(1);
    const listed = await admin.listTeams(ana);
    expect(listed.find((x) => x.id === t.id)?.members.map((m) => m.name)).toEqual(["Caio"]);
    await admin.removeMember(ana, t.id, caio.id);
    expect(await db.teamMember.count({ where: { teamId: t.id } })).toBe(0);
    expect(await actions()).toEqual(["team.create", "team.create", "team.rename", "team.member_add", "team.member_remove"]);
  });

  it("recusa como membro um solicitante ou um usuário desativado (400)", async () => {
    const t = await admin.createTeam(ana, "Infraestrutura");
    await expect(admin.addMember(ana, t.id, duda.id)).rejects.toMatchObject({ status: 400 });
    await expect(admin.addMember(ana, t.id, inativo.id)).rejects.toMatchObject({ status: 400 });
    await expect(admin.addMember(ana, "nao-existe", caio.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("categorias", () => {
  it("cria e troca a equipe padrão; equipe ou pai inexistente → 400", async () => {
    const t1 = await admin.createTeam(ana, "Infraestrutura");
    const t2 = await admin.createTeam(ana, "Sistemas");
    const cat = await admin.createCategory(ana, { name: "Rede", defaultTeamId: t1.id });
    await expect(admin.createCategory(ana, { name: "X", defaultTeamId: "nao-existe" })).rejects.toMatchObject({ status: 400 });
    await expect(admin.createCategory(ana, { name: "Y", parentId: "nao-existe" })).rejects.toMatchObject({ status: 400 });
    await admin.updateCategory(ana, cat.id, { defaultTeamId: t2.id });
    expect((await admin.listCategories(ana)).find((c) => c.id === cat.id)?.defaultTeam?.name).toBe("Sistemas");
    await admin.updateCategory(ana, cat.id, { defaultTeamId: null });
    expect((await admin.listCategories(ana)).find((c) => c.id === cat.id)?.defaultTeam).toBeNull();
    expect((await actions()).filter((a) => a.startsWith("category."))).toEqual(["category.create", "category.update", "category.update"]);
  });
});

describe("rotas", () => {
  it("não-admin recebe 403 em todas", async () => {
    const t = await admin.createTeam(ana, "Infraestrutura");
    const c = cookie.Caio;
    expect((await route("@/app/api/admin/teams/route", "GET", c)).status).toBe(403);
    expect((await route("@/app/api/admin/teams/route", "POST", c, {}, { name: "Z" })).status).toBe(403);
    expect((await route("@/app/api/admin/teams/[id]/route", "PATCH", c, { id: t.id }, { name: "Z" })).status).toBe(403);
    expect((await route("@/app/api/admin/teams/[id]/members/route", "POST", c, { id: t.id }, { userId: caio.id })).status).toBe(403);
    expect((await route("@/app/api/admin/teams/[id]/members/[userId]/route", "DELETE", c, { id: t.id, userId: caio.id })).status).toBe(403);
    expect((await route("@/app/api/admin/categories/route", "GET", c)).status).toBe(403);
    expect((await route("@/app/api/admin/categories/route", "POST", c, {}, { name: "Z" })).status).toBe(403);
  });

  it("admin cria equipe, adiciona membro e cria categoria pelas rotas", async () => {
    const c = cookie.Ana;
    const created = await route("@/app/api/admin/teams/route", "POST", c, {}, { name: "Sistemas" });
    expect(created.status).toBe(201);
    const { team } = await created.json();
    expect((await route("@/app/api/admin/teams/[id]/members/route", "POST", c, { id: team.id }, { userId: caio.id })).status).toBe(200);
    const cat = await route("@/app/api/admin/categories/route", "POST", c, {}, { name: "Software", defaultTeamId: team.id });
    expect(cat.status).toBe(201);
    const { category } = await cat.json();
    expect((await route("@/app/api/admin/categories/[id]/route", "PATCH", c, { id: category.id }, { defaultTeamId: null })).status).toBe(200);
    expect((await route("@/app/api/admin/teams/route", "POST", c, {}, { name: "" })).status).toBe(400);
  });
});
