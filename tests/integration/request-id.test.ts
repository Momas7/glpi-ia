import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { startTestDb, type TestDb } from "./helpers/db";

const ORIGIN = "http://app.test";
let testDb: TestDb;
let db: Db;
let cookie: string;

beforeAll(async () => {
  testDb = await startTestDb();
  Object.assign(process.env, { DATABASE_URL: testDb.url, APP_URL: ORIGIN });
  delete (globalThis as { db?: unknown }).db;
  db = createDb(testDb.url);
});

afterAll(async () => {
  await db?.$disconnect();
  await testDb?.stop();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.session.deleteMany();
  await db.user.deleteMany();
  const u = await db.user.create({ data: { name: "u", email: "u@x.com", role: "ADMIN" } });
  const { createSession } = await import("@/modules/auth/session");
  cookie = `session=${await createSession(u.id)}`;
});

describe("X-Request-Id nas rotas", () => {
  it("rota com sessão devolve o id gerado; respeita um id seguro enviado pelo cliente", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    const a = await GET(new Request(`${ORIGIN}/api/tickets`, { headers: { cookie } }));
    expect(a.status).toBe(200);
    expect(a.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const b = await GET(new Request(`${ORIGIN}/api/tickets`, { headers: { cookie, "x-request-id": "meu-id-12345" } }));
    expect(b.headers.get("x-request-id")).toBe("meu-id-12345");
  });

  it("resposta 401 também leva o id", async () => {
    const { GET } = await import("@/app/api/tickets/route");
    const res = await GET(new Request(`${ORIGIN}/api/tickets`));
    expect(res.status).toBe(401);
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("erro interno vira 500 com id, é registrado como erro e a resposta não vaza o detalhe", async () => {
    const { withAuth } = await import("@/lib/http");
    const spy = vi.spyOn(logger, "error").mockImplementation(() => undefined as never);
    const handler = withAuth(async () => {
      throw new Error("detalhe interno do banco");
    });
    const res = await handler(new Request(`${ORIGIN}/api/qualquer?token=abc`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: JSON.stringify({ senha: "x" }) }));
    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(await res.text()).not.toContain("detalhe interno");
    const logged = JSON.stringify(spy.mock.calls.map((c) => c[0]));
    expect(logged).toContain("/api/qualquer");
    expect(logged).not.toMatch(/token=abc|"senha"/);
  });

  it("rota pública (withErrors) e rota de integração (withApiKey) também devolvem o id", async () => {
    const { withErrors } = await import("@/lib/http");
    const res = await withErrors(async () => new Response("ok"))(new Request(`${ORIGIN}/api/publica`));
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const { POST } = await import("@/app/api/v1/tickets/route");
    const unauthorized = await POST(new Request(`${ORIGIN}/api/v1/tickets`, { method: "POST", body: "{}" }));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("x-request-id")).toBeTruthy();
  });
});
