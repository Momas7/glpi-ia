import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/modules/auth/password";
import { hashToken } from "@/modules/auth/session";
import { startTestDb, type TestDb } from "./helpers/db";
import { queuedEvents } from "./helpers/queued-events";

const PASSWORD = "Tr0ca-Isto-Aqui!";
const NEW_PASSWORD = "Outra-Senha-Forte-9";
let testDb: TestDb;
let db: Db;
let invite: typeof import("@/modules/auth/invite");
let reset: typeof import("@/modules/auth/reset");
let auth: typeof import("@/modules/auth");
// Convite e reset agora saem como eventos para o n8n; o teste lê os corpos enfileirados.
const resetEvents = async () =>
  (await queuedEvents(db, "auth.password_reset_requested")).map((e) => e.data as { email: string; url: string });

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = "http://app.test";
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  invite = await import("@/modules/auth/invite");
  reset = await import("@/modules/auth/reset");
  auth = await import("@/modules/auth");
  process.env.N8N_WEBHOOK_URL = "http://n8n.invalid/webhook";
  process.env.N8N_WEBHOOK_SECRET = "s".repeat(32);
});

afterAll(async () => {
  await (await import("@/lib/queue")).stopQueue();
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.$executeRaw`DELETE FROM pgboss.job WHERE name = 'webhook.deliver'`.catch(() => {});
  await db.passwordReset.deleteMany();
  await db.auditLog.deleteMany();
  await db.invite.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
});

const mkUser = async (email: string, role: "ADMIN" | "AGENT" | "REQUESTER" = "AGENT") =>
  db.user.create({ data: { name: "U", email, role, passwordHash: await hashPassword(PASSWORD) } });

describe("convites", () => {
  it("devolve o token em claro uma vez e guarda só o hash", async () => {
    const admin = await mkUser("admin@x.com", "ADMIN");
    const { token } = await invite.createInvite({ email: "novo@x.com", role: "AGENT", createdById: admin.id });
    const row = await db.invite.findFirstOrThrow();
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toBe(token);
  });

  it("só ADMIN cria convite", async () => {
    const agent = await mkUser("agent@x.com", "AGENT");
    await expect(invite.createInvite({ email: "n@x.com", role: "AGENT", createdById: agent.id })).rejects.toThrow();
  });

  it("aceitar cria o usuário com o papel do convite e e-mail em minúsculas", async () => {
    const admin = await mkUser("admin@x.com", "ADMIN");
    const { token } = await invite.createInvite({ email: "Novo@X.com", role: "REQUESTER", createdById: admin.id });
    expect(await invite.acceptInvite({ token, name: "Novo", password: PASSWORD })).toEqual({ ok: true });
    const u = await db.user.findUniqueOrThrow({ where: { email: "novo@x.com" } });
    expect(u.role).toBe("REQUESTER");
    expect(await verifyPassword(u.passwordHash!, PASSWORD)).toBe(true);
  });

  it("convite usado duas vezes, expirado, inexistente ou com senha fraca falham de forma genérica", async () => {
    const admin = await mkUser("admin@x.com", "ADMIN");
    const { token } = await invite.createInvite({ email: "a@x.com", role: "AGENT", createdById: admin.id });

    expect(await invite.acceptInvite({ token, name: "A", password: "curta" })).toEqual({ ok: false });
    expect(await db.invite.count({ where: { usedAt: null } })).toBe(1); // senha fraca não consome o convite

    expect(await invite.acceptInvite({ token, name: "A", password: PASSWORD })).toEqual({ ok: true });
    expect(await invite.acceptInvite({ token, name: "A", password: PASSWORD })).toEqual({ ok: false });
    expect(await invite.acceptInvite({ token: "lixo", name: "A", password: PASSWORD })).toEqual({ ok: false });

    const second = await invite.createInvite({ email: "b@x.com", role: "AGENT", createdById: admin.id });
    await db.invite.updateMany({ where: { email: "b@x.com" }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await invite.acceptInvite({ token: second.token, name: "B", password: PASSWORD })).toEqual({ ok: false });
  });

  it("convite para e-mail já cadastrado falha sem criar duplicata", async () => {
    const admin = await mkUser("admin@x.com", "ADMIN");
    const { token } = await invite.createInvite({ email: "ADMIN@x.com", role: "AGENT", createdById: admin.id });
    expect(await invite.acceptInvite({ token, name: "X", password: PASSWORD })).toEqual({ ok: false });
    expect(await db.user.count()).toBe(1);
  });
});

describe("reset de senha", () => {
  it("responde igual para e-mail existente e inexistente, enviando só para o existente", async () => {
    await mkUser("ana@x.com");
    await expect(reset.requestReset("ana@x.com")).resolves.toBeUndefined();
    await expect(reset.requestReset("fantasma@x.com")).resolves.toBeUndefined();
    const events = await resetEvents();
    expect(events).toHaveLength(1);
    expect(events[0].email).toBe("ana@x.com");
    expect(events[0].url).toMatch(/^http:\/\/app\.test\/reset\?token=/);
    const row = await db.passwordReset.findFirstOrThrow();
    const token = new URL(events[0].url).searchParams.get("token")!;
    expect(row.tokenHash).toBe(hashToken(token));
  });

  async function startReset(email = "ana@x.com") {
    await reset.requestReset(email);
    return new URL((await resetEvents()).at(-1)!.url).searchParams.get("token")!;
  }

  it("senha fraca falha e não consome o token", async () => {
    await mkUser("ana@x.com");
    const token = await startReset();
    expect(await reset.resetPassword({ token, password: "curta" })).toEqual({ ok: false });
    expect(await reset.resetPassword({ token, password: NEW_PASSWORD })).toEqual({ ok: true });
  });

  it("troca a senha, marca como usado e revoga as sessões", async () => {
    const u = await mkUser("ana@x.com");
    const login = await auth.login({ email: "ana@x.com", password: PASSWORD, ip: "9.9.9.9" });
    if (!login.ok) throw new Error("login falhou");
    const token = await startReset();

    expect(await reset.resetPassword({ token, password: NEW_PASSWORD })).toEqual({ ok: true });

    expect(await auth.getSessionUser(login.sessionToken)).toBeNull();
    expect((await auth.login({ email: "ana@x.com", password: PASSWORD, ip: "9.9.9.9" })).ok).toBe(false);
    expect((await auth.login({ email: "ana@x.com", password: NEW_PASSWORD, ip: "9.9.9.9" })).ok).toBe(true);
    expect((await db.passwordReset.findFirstOrThrow({ where: { userId: u.id } })).usedAt).not.toBeNull();
  });

  it("token reutilizado, expirado ou inexistente falha", async () => {
    await mkUser("ana@x.com");
    const token = await startReset();
    expect(await reset.resetPassword({ token, password: NEW_PASSWORD })).toEqual({ ok: true });
    expect(await reset.resetPassword({ token, password: NEW_PASSWORD })).toEqual({ ok: false });
    expect(await reset.resetPassword({ token: "lixo", password: NEW_PASSWORD })).toEqual({ ok: false });

    const t2 = await startReset();
    await db.passwordReset.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await reset.resetPassword({ token: t2, password: NEW_PASSWORD })).toEqual({ ok: false });
  });

  it("dois resets simultâneos com o mesmo token: só um vence", async () => {
    await mkUser("ana@x.com");
    const token = await startReset();
    const results = await Promise.all([
      reset.resetPassword({ token, password: NEW_PASSWORD }),
      reset.resetPassword({ token, password: "Mais-Uma-Senha-Forte-1" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("forgot: limite por e-mail", () => {
  it("o mesmo e-mail não recebe mais de 3 resets por janela, mesmo trocando de IP", async () => {
    await mkUser("alvo@x.com");
    const { POST } = await import("@/app/api/auth/forgot/route");
    const hit = (i: number) =>
      POST(
        new Request("http://app.test/api/auth/forgot", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `8.8.8.${i}` },
          body: JSON.stringify({ email: "alvo@x.com" }),
        }),
      );
    const statuses: number[] = [];
    for (let i = 1; i <= 5; i++) statuses.push((await hit(i)).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect(await resetEvents()).toHaveLength(3);
  });
});

describe("avisos de convite e reset (n8n)", () => {
  it("createInvite enfileira auth.invite_created com o link que o aceite usa", async () => {
    const adminUser = await mkUser("chefe@x.com", "ADMIN");
    await auth.createInvite({ email: "Novo@X.com", role: "AGENT", createdById: adminUser.id });
    const [ev] = await queuedEvents(db, "auth.invite_created");
    expect(ev.data).toMatchObject({ email: "novo@x.com", role: "AGENT" });
    const token = new URL(ev.data.url as string).searchParams.get("token")!;
    expect(await invite.acceptInvite({ token, name: "Novo", password: PASSWORD })).toEqual({ ok: true });
  });

  it("e-mail inexistente não enfileira aviso", async () => {
    await reset.requestReset("ninguem@x.com");
    expect(await resetEvents()).toHaveLength(0);
  });
});

describe("rotas", () => {
  const call = async (path: string, body: unknown, cookie?: string) => {
    const mod = await import(`@/app/api/auth/${path}/route`);
    return mod.POST(
      new Request(`http://app.test/api/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": `7.7.${Math.floor(Math.random() * 250)}.1`, ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      }),
    );
  };

  it("POST /invite: 401 sem sessão, 403 para não-admin, 200 com link para admin", async () => {
    const admin = await mkUser("admin@x.com", "ADMIN");
    const agent = await mkUser("agent@x.com", "AGENT");
    expect((await call("invite", { email: "n@x.com", role: "AGENT" })).status).toBe(401);

    const agentToken = await (await import("@/modules/auth/session")).createSession(agent.id);
    expect((await call("invite", { email: "n@x.com", role: "AGENT" }, `session=${agentToken}`)).status).toBe(403);

    const adminToken = await (await import("@/modules/auth/session")).createSession(admin.id);
    const ok = await call("invite", { email: "n@x.com", role: "AGENT" }, `session=${adminToken}`);
    expect(ok.status).toBe(200);
    expect((await ok.json()).inviteUrl).toMatch(/^http:\/\/app\.test\/accept-invite\?token=/);
  });

  it("POST /forgot: 200 e mesma resposta para e-mail existente ou não", async () => {
    await mkUser("ana@x.com");
    const a = await call("forgot", { email: "ana@x.com" });
    const b = await call("forgot", { email: "fantasma@x.com" });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });

  it("POST /accept-invite e /reset: 400 para corpo inválido", async () => {
    expect((await call("accept-invite", { token: "x" })).status).toBe(400);
    expect((await call("reset", { token: "x" })).status).toBe(400);
  });
});
