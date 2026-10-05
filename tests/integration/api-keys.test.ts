import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "@/lib/db";
import type { SessionUser } from "@/modules/auth";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let keys: typeof import("@/modules/integrations");
let session: typeof import("@/modules/auth/session");
let admin: SessionUser;
const cookie: Record<string, string> = {};

beforeAll(async () => {
  testDb = await startTestDb();
  process.env.DATABASE_URL = testDb.url;
  process.env.APP_URL = ORIGIN;
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
  keys = await import("@/modules/integrations");
  session = await import("@/modules/auth/session");
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  await db.auditLog.deleteMany();
  await db.apiKey.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  const mk = async (name: string, role: SessionUser["role"]) => {
    const u = await db.user.create({ data: { name, email: `${name.toLowerCase()}@x.com`, role } });
    cookie[name] = `session=${await session.createSession(u.id)}`;
    return { id: u.id, name, email: u.email, role, teamIds: [] } as SessionUser;
  };
  admin = await mk("Admin", "ADMIN");
  await mk("Agente", "AGENT");
});

async function route(mod: string, method: "GET" | "POST" | "DELETE", c: string, params: Record<string, string> = {}, body?: unknown) {
  const m = await import(mod);
  const headers: Record<string, string> = { cookie: c };
  if (method !== "GET") headers.origin = ORIGIN;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = new Request(`${ORIGIN}/api/x`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return m[method](r, { params: Promise.resolve(params) }) as Promise<Response>;
}

describe("chaves de API", () => {
  it("autentica com o escopo concedido, 403 com outro e preenche lastUsedAt", async () => {
    const { key, id } = await keys.createApiKey(admin, { name: "n8n e-mail", scopes: ["tickets:create"] });
    expect(key).toMatch(/^gk_[0-9a-f]{8}_/);
    await expect(keys.authenticateApiKey(`Bearer ${key}`, "tickets:create")).resolves.toMatchObject({ id, name: "n8n e-mail" });
    await expect(keys.authenticateApiKey(`Bearer ${key}`, "comments:create")).rejects.toMatchObject({ status: 403 });
    expect((await db.apiKey.findUniqueOrThrow({ where: { id } })).lastUsedAt).not.toBeNull();
  });

  it("revogar faz a próxima autenticação falhar com 401", async () => {
    const { key, id } = await keys.createApiKey(admin, { name: "k", scopes: ["tickets:create"] });
    await keys.revokeApiKey(admin, id);
    await expect(keys.authenticateApiKey(`Bearer ${key}`, "tickets:create")).rejects.toMatchObject({ status: 401 });
  });

  it("cabeçalho ausente, sem Bearer ou com segredo errado: 401 com a mesma mensagem", async () => {
    const { key } = await keys.createApiKey(admin, { name: "k", scopes: ["tickets:create"] });
    const wrong = key.slice(0, -4) + (key.endsWith("aaaa") ? "bbbb" : "aaaa");
    const messages = new Set<string>();
    for (const header of [null, key, `Basic ${key}`, `Bearer ${wrong}`, "Bearer gk_00000000_abc"]) {
      const err = await keys.authenticateApiKey(header, "tickets:create").catch((e) => e);
      expect(err).toMatchObject({ status: 401 });
      messages.add(err.message);
    }
    expect(messages.size).toBe(1);
  });

  it("listagem e rota GET nunca expõem o segredo nem o hash", async () => {
    const { key, id } = await keys.createApiKey(admin, { name: "k", scopes: ["tickets:create"] });
    const hash = (await db.apiKey.findUniqueOrThrow({ where: { id } })).keyHash;
    const listed = JSON.stringify(await keys.listApiKeys(admin));
    const res = await route("@/app/api/admin/api-keys/route", "GET", cookie.Admin);
    const body = await res.text();
    for (const text of [listed, body]) {
      expect(text).not.toContain(key);
      expect(text).not.toContain(hash);
    }
    expect(JSON.parse(body).keys[0]).toMatchObject({ id, name: "k", scopes: ["tickets:create"] });
  });

  it("rotas: não-admin 403; criar devolve o segredo uma vez (201); revogar; auditoria", async () => {
    expect((await route("@/app/api/admin/api-keys/route", "POST", cookie.Agente, {}, { name: "x", scopes: ["tickets:create"] })).status).toBe(403);
    const created = await route("@/app/api/admin/api-keys/route", "POST", cookie.Admin, {}, { name: "n8n", scopes: ["tickets:create", "comments:create"] });
    expect(created.status).toBe(201);
    const { key, id } = await created.json();
    expect(key).toMatch(/^gk_/);
    expect((await route("@/app/api/admin/api-keys/route", "POST", cookie.Admin, {}, { name: "x", scopes: ["admin"] })).status).toBe(400);
    expect((await route("@/app/api/admin/api-keys/[id]/route", "DELETE", cookie.Admin, { id })).status).toBe(200);
    const actions = (await db.auditLog.findMany({ orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["apikey.create", "apikey.revoke"]);
  });
});
