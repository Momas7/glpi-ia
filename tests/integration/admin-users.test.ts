import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
const PASSWORD = "Senha-Forte-Do-Teste-1";
let testDb: TestDb;
let db: Db;
let admin: typeof import("@/modules/admin");
let auth: typeof import("@/modules/auth");
let session: typeof import("@/modules/auth/session");

let adminA: SessionUser, adminB: SessionUser, agent: SessionUser, requester: SessionUser;
const cookieOf: Record<string, string> = {};

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = ORIGIN;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  admin = await import("@/modules/admin");
  auth = await import("@/modules/auth");
  session = await import("@/modules/auth/session");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.invite.deleteMany();
  await db.session.deleteMany();
  await db.teamMember.deleteMany();
  await db.user.deleteMany();
  await db.team.deleteMany();
  const team = await db.team.create({ data: { name: "Suporte N1" } });
  const mk = async (name: string, email: string, role: SessionUser["role"], teams: string[] = []) => {
    const u = await db.user.create({
      data: { name, email, role, passwordHash: await auth.hashPassword(PASSWORD), teams: { create: teams.map((teamId) => ({ teamId })) } },
    });
    cookieOf[email] = `session=${await session.createSession(u.id)}`;
    return { id: u.id, name, email, role, teamIds: teams } as SessionUser;
  };
  adminA = await mk("Ana Admin", "ana@x.com", "ADMIN");
  adminB = await mk("Beto Admin", "beto@x.com", "ADMIN");
  agent = await mk("Caio Técnico", "caio@x.com", "AGENT", [team.id]);
  requester = await mk("Duda", "duda@x.com", "REQUESTER");
});

async function route(mod: string, method: "GET" | "PATCH" | "DELETE", opts: { cookie?: string; body?: unknown; params?: Record<string, string>; query?: string } = {}) {
  const m = await import(mod);
  const headers: Record<string, string> = { "x-forwarded-for": "4.4.4.4" };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== "GET") headers.origin = ORIGIN;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${ORIGIN}/api/admin/x${opts.query ?? ""}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return m[method](req, { params: Promise.resolve(opts.params ?? {}) }) as Promise<Response>;
}

const USERS = "@/app/api/admin/users/route";
const USER = "@/app/api/admin/users/[id]/route";
const INVITES = "@/app/api/admin/invites/route";
const INVITE = "@/app/api/admin/invites/[id]/route";

describe("acesso", () => {
  it("só ADMIN usa o serviço e as rotas", async () => {
    await expect(admin.listUsers(agent, { page: 1, pageSize: 20 })).rejects.toMatchObject({ status: 403 });
    await expect(admin.changeRole(requester, agent.id, "ADMIN")).rejects.toMatchObject({ status: 403 });
    expect((await route(USERS, "GET")).status).toBe(401);
    expect((await route(USERS, "GET", { cookie: cookieOf["caio@x.com"] })).status).toBe(403);
    expect((await route(USERS, "GET", { cookie: cookieOf["ana@x.com"] })).status).toBe(200);
  });
});

describe("usuários", () => {
  it("lista com equipes e filtra por nome ou e-mail sem diferenciar maiúsculas", async () => {
    const all = await admin.listUsers(adminA, { page: 1, pageSize: 20 });
    expect(all.total).toBe(4);
    expect(all.items.find((u) => u.email === "caio@x.com")?.teams.map((t) => t.name)).toEqual(["Suporte N1"]);
    expect((await admin.listUsers(adminA, { page: 1, pageSize: 20, q: "ANA" })).items.map((u) => u.email)).toEqual(["ana@x.com"]);
    expect((await admin.listUsers(adminA, { page: 1, pageSize: 20, q: "duda@" })).items.map((u) => u.email)).toEqual(["duda@x.com"]);
  });

  it("muda o papel e registra auditoria com de/para", async () => {
    const row = await admin.changeRole(adminA, agent.id, "TEAM_LEAD");
    expect(row.role).toBe("TEAM_LEAD");
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.role_change", targetId: agent.id } });
    expect(audit.actorId).toBe(adminA.id);
    expect(audit.data).toEqual({ from: "AGENT", to: "TEAM_LEAD" });
  });

  it("admin não rebaixa nem desativa a si mesmo", async () => {
    await expect(admin.changeRole(adminA, adminA.id, "AGENT")).rejects.toMatchObject({ status: 400 });
    await expect(admin.setActive(adminA, adminA.id, false)).rejects.toMatchObject({ status: 400 });
  });

  it("dois admins desativando um ao outro ao mesmo tempo: um vence e resta um admin ativo", async () => {
    const results = await Promise.allSettled([
      admin.setActive(adminA, adminB.id, false),
      admin.setActive(adminB, adminA.id, false),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ status: 400, message: "É preciso manter ao menos um administrador ativo." });
    expect(await db.user.count({ where: { role: "ADMIN", active: true } })).toBe(1);
  });

  it("dois admins rebaixando um ao outro ao mesmo tempo: resta um admin ativo", async () => {
    const results = await Promise.allSettled([
      admin.changeRole(adminA, adminB.id, "AGENT"),
      admin.changeRole(adminB, adminA.id, "AGENT"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.user.count({ where: { role: "ADMIN", active: true } })).toBe(1);
  });

  it("desativar revoga as sessões na hora e reativar registra auditoria", async () => {
    const token = cookieOf["caio@x.com"].slice("session=".length);
    await admin.setActive(adminA, agent.id, false);
    expect(await session.getSessionUser(token)).toBeNull();
    const res = await (await import("@/app/api/tickets/route")).GET(
      new Request(`${ORIGIN}/api/tickets`, { headers: { cookie: cookieOf["caio@x.com"] } }),
    );
    expect(res.status).toBe(401);
    await admin.setActive(adminA, agent.id, true);
    const actions = (await db.auditLog.findMany({ where: { targetId: agent.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["user.deactivate", "user.activate"]);
  });

  it("rotas: PATCH com papel inválido → 400; usuário inexistente → 404; mudança válida → 200", async () => {
    const c = cookieOf["ana@x.com"];
    expect((await route(USER, "PATCH", { cookie: c, params: { id: agent.id }, body: { role: "CHEFE" } })).status).toBe(400);
    expect((await route(USER, "PATCH", { cookie: c, params: { id: "nao-existe" }, body: { active: false } })).status).toBe(404);
    expect((await route(USER, "PATCH", { cookie: c, params: { id: agent.id }, body: { role: "TEAM_LEAD" } })).status).toBe(200);
  });
});

describe("convites", () => {
  it("convidar de novo o mesmo e-mail invalida o link anterior; o novo funciona", async () => {
    const first = await auth.createInvite({ email: "Novo@x.com", role: "AGENT", createdById: adminA.id });
    const second = await auth.createInvite({ email: "novo@x.com", role: "REQUESTER", createdById: adminA.id });
    expect(await auth.acceptInvite({ token: first.token, name: "Novo", password: PASSWORD })).toEqual({ ok: false });
    expect(await auth.acceptInvite({ token: second.token, name: "Novo", password: PASSWORD })).toEqual({ ok: true });
    expect((await db.user.findUniqueOrThrow({ where: { email: "novo@x.com" } })).role).toBe("REQUESTER");
    expect(await db.auditLog.count({ where: { action: "user.invite" } })).toBe(2);
  });

  it("revogar faz o link falhar e lista de pendentes ignora usados, revogados e expirados", async () => {
    const used = await auth.createInvite({ email: "usado@x.com", role: "AGENT", createdById: adminA.id });
    await auth.acceptInvite({ token: used.token, name: "Usado", password: PASSWORD });
    const revoked = await auth.createInvite({ email: "revogado@x.com", role: "AGENT", createdById: adminA.id });
    await auth.createInvite({ email: "expirado@x.com", role: "AGENT", createdById: adminA.id });
    await db.invite.updateMany({ where: { email: "expirado@x.com" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await auth.createInvite({ email: "pendente@x.com", role: "AGENT", createdById: adminA.id });

    const revokedRow = await db.invite.findFirstOrThrow({ where: { email: "revogado@x.com" } });
    await admin.revokeInvite(adminA, revokedRow.id);
    expect(await auth.acceptInvite({ token: revoked.token, name: "R", password: PASSWORD })).toEqual({ ok: false });

    expect((await admin.listPendingInvites(adminA)).map((i) => i.email)).toEqual(["pendente@x.com"]);
    expect(await db.auditLog.count({ where: { action: "invite.revoke", targetId: revokedRow.id } })).toBe(1);
  });

  it("rotas de convites: GET lista pendentes e DELETE revoga; não-admin → 403", async () => {
    await auth.createInvite({ email: "p@x.com", role: "AGENT", createdById: adminA.id });
    const inv = await db.invite.findFirstOrThrow();
    expect((await route(INVITES, "GET", { cookie: cookieOf["caio@x.com"] })).status).toBe(403);
    const list = await route(INVITES, "GET", { cookie: cookieOf["ana@x.com"] });
    expect((await list.json()).invites).toHaveLength(1);
    expect((await route(INVITE, "DELETE", { cookie: cookieOf["ana@x.com"], params: { id: inv.id } })).status).toBe(200);
    expect((await admin.listPendingInvites(adminA))).toHaveLength(0);
  });
});
