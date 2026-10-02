import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { hashPassword } from "@/modules/auth/password";
import { startTestDb, type TestDb } from "./helpers/db";

const PASSWORD = "Tr0ca-Isto-Aqui!";
let testDb: TestDb;
let db: Db;
let auth: typeof import("@/modules/auth");
let ipCounter = 0;
const nextIp = () => `10.0.0.${++ipCounter}`;

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  auth = await import("@/modules/auth");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.session.deleteMany();
  await db.user.deleteMany();
});

async function makeUser(over: Partial<{ email: string; active: boolean }> = {}) {
  return db.user.create({
    data: {
      name: "Ana",
      email: over.email ?? "ana@x.com",
      role: "AGENT",
      active: over.active ?? true,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
}

describe("login", () => {
  it("cria sessão guardando só o hash do token e zera failedLogins", async () => {
    const u = await makeUser();
    await db.user.update({ where: { id: u.id }, data: { failedLogins: 3 } });
    const r = await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const sessions = await db.session.findMany({ where: { userId: u.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].tokenHash).not.toBe(r.sessionToken);
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).failedLogins).toBe(0);
  });

  it("encontra a conta ignorando a caixa do e-mail", async () => {
    await makeUser({ email: "ana@x.com" });
    const r = await auth.login({ email: "Ana@X.com", password: PASSWORD, ip: nextIp() });
    expect(r.ok).toBe(true);
  });

  it("bloqueia após 5 falhas, mesmo com a senha correta na 6ª tentativa", async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) {
      expect((await auth.login({ email: "ana@x.com", password: "errada-errada-1", ip: nextIp() })).ok).toBe(false);
    }
    const locked = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect((await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() })).ok).toBe(false);
  });

  it("retorna o mesmo resultado para usuário inexistente e senha errada", async () => {
    await makeUser();
    const a = await auth.login({ email: "naoexiste@x.com", password: PASSWORD, ip: nextIp() });
    const b = await auth.login({ email: "ana@x.com", password: "errada-errada-1", ip: nextIp() });
    expect(a).toEqual({ ok: false });
    expect(b).toEqual({ ok: false });
  });

  it("não loga usuário inativo", async () => {
    await makeUser({ active: false });
    expect((await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() })).ok).toBe(false);
  });

  it("rotaciona: cada login gera um token diferente", async () => {
    await makeUser();
    const a = await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() });
    const b = await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() });
    expect(a.ok && b.ok && a.sessionToken !== b.sessionToken).toBe(true);
  });
});

describe("sessão", () => {
  it("getSessionUser devolve o usuário com teamIds", async () => {
    const u = await makeUser();
    const team = await db.team.create({ data: { name: `T-${Date.now()}` } });
    await db.teamMember.create({ data: { userId: u.id, teamId: team.id } });
    const r = await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() });
    if (!r.ok) throw new Error("login falhou");
    const su = await auth.getSessionUser(r.sessionToken);
    expect(su).toMatchObject({ id: u.id, email: "ana@x.com", role: "AGENT", teamIds: [team.id] });
  });

  it("revokeSessions invalida os tokens do usuário", async () => {
    const u = await makeUser();
    const r = await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() });
    if (!r.ok) throw new Error("login falhou");
    await auth.revokeSessions(u.id);
    expect(await auth.getSessionUser(r.sessionToken)).toBeNull();
  });

  it("sessão expirada ou usuário desativado não autentica", async () => {
    const u = await makeUser();
    const r = await auth.login({ email: "ana@x.com", password: PASSWORD, ip: nextIp() });
    if (!r.ok) throw new Error("login falhou");
    await db.session.updateMany({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await auth.getSessionUser(r.sessionToken)).toBeNull();
    expect(await auth.getSessionUser("token-que-nao-existe")).toBeNull();
  });
});

describe("POST /api/auth/login", () => {
  async function post(body: unknown, ip: string) {
    const { POST } = await import("@/app/api/auth/login/route");
    return POST(
      new Request("http://localhost:3000/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify(body),
      }),
    );
  }

  it("define cookie HttpOnly, Secure e SameSite=Lax no sucesso", async () => {
    await makeUser();
    const res = await post({ email: "ana@x.com", password: PASSWORD }, nextIp());
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it("responde 401 com mensagem genérica em credenciais inválidas", async () => {
    const res = await post({ email: "x@x.com", password: "qualquer-coisa-123" }, nextIp());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "E-mail ou senha inválidos." });
  });

  it("responde 400 para corpo inválido", async () => {
    const res = await post({ email: "nao-e-email" }, nextIp());
    expect(res.status).toBe(400);
  });

  it("responde 429 quando um mesmo IP excede o limite", async () => {
    const ip = nextIp();
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await post({ email: `z${i}@x.com`, password: "qualquer-coisa-123" }, ip)).status;
    expect(last).toBe(429);
  });
});
